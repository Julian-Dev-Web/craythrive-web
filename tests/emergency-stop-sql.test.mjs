import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await fs.readFile('supabase/migrations/20261019140000_latched_emergency_stop.sql','utf8');
const owner='11111111-1111-4111-8111-111111111111', tank='22222222-2222-4222-8222-222222222222';
async function fixture() {
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('qa.actor',true),'')::uuid $$;
 CREATE TABLE tanks(id uuid PRIMARY KEY,user_id uuid);
 CREATE TABLE iot_devices(device_uid text,user_id uuid,tank_id uuid,device_type text,is_claimed boolean);
 CREATE TABLE tank_automation_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tank_id uuid UNIQUE,user_id uuid,device_uid text,
 auto_water_enabled boolean DEFAULT true,auto_feeding_enabled boolean DEFAULT true,auto_feed_hour integer DEFAULT 19,auto_feed_minute integer DEFAULT 0,auto_feed_cycles integer DEFAULT 2);
 CREATE TABLE device_commands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id text,device_uid text,
 command_type text,command_value text,duration_ms integer,command_status text CHECK(command_status IN ('pending','running','done','failed','rejected')),
 status text,result_message text,created_at timestamptz DEFAULT now(),executed_at timestamptz);
 GRANT SELECT,INSERT,UPDATE ON tanks,iot_devices,tank_automation_settings,device_commands TO authenticated;
 GRANT DELETE ON tank_automation_settings TO authenticated;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
 INSERT INTO tanks VALUES('${tank}','${owner}');
 INSERT INTO iot_devices VALUES('actuator-a','${owner}','${tank}','actuator_hub',true);
 INSERT INTO tank_automation_settings(tank_id,user_id,device_uid,auto_water_enabled,auto_feed_hour) VALUES('${tank}','${owner}','actuator-a',false,21);`);
 await db.exec(migration);
 await db.exec(`SET ROLE authenticated; SET qa.actor='${owner}';`);
 return db;
}
const queue=async(db,action)=>(await db.query('SELECT request_tank_emergency_control($1,$2,$3) state',[tank,'actuator-a',action])).rows[0].state;
const state=async db=>(await db.query('SELECT get_tank_actuator_control_state($1,$2,NULL) state',[tank,'actuator-a'])).rows[0].state;
const normal=async(db,type='FEED_ONCE')=>(await db.query("INSERT INTO device_commands(user_id,tank_id,device_uid,command_type,command_status) VALUES($1,$2,'actuator-a',$3,'pending') RETURNING id",[owner,tank,type])).rows[0].id;
const ack=async(db,id,message)=>db.query("UPDATE device_commands SET command_status='done',status='done',result_message=$2,executed_at=now() WHERE id=$1",[id,message]);

test('STOP_ALL queues once, cancels queued feed, latches persistently and rejects client bypasses without changing other settings',async()=>{
 const db=await fixture();try{
 const feed=await normal(db);const stopped=await queue(db,'STOP_ALL');
 await assert.rejects(db.query("UPDATE device_commands SET tank_id='33333333-3333-4333-8333-333333333333' WHERE id=$1",[feed]),/scope are immutable/);
 assert.equal(stopped.emergency_stop_active,true);assert.equal(stopped.stop_command.command_status,'pending');
 assert.equal((await db.query('SELECT command_status,result_message FROM device_commands WHERE id=$1',[feed])).rows[0].command_status,'rejected');
 assert.match((await db.query('SELECT result_message FROM device_commands WHERE id=$1',[feed])).rows[0].result_message,/Cancelled because Emergency Stop/);
 assert.equal((await queue(db,'STOP_ALL')).stop_command.id,stopped.stop_command.id);
 await assert.rejects(normal(db),/Emergency stop is active/);
 await assert.rejects(db.query('UPDATE tank_automation_settings SET emergency_stop_active=false WHERE tank_id=$1',[tank]),/emergency control command flow/);
 await assert.rejects(queue(db,'RESUME_CONTROLS'),/Wait for confirmed stop/);
 await ack(db,stopped.stop_command.id,'Emergency stop applied. Pumps and feeder are stopped.');
 const confirmed=await state(db);assert.equal(confirmed.emergency_stop_active,true);assert.ok(confirmed.applied_at);
 const resume=await queue(db,'RESUME_CONTROLS');assert.equal(resume.emergency_stop_active,true);
 await ack(db,resume.resume_command.id,'Controls resumed. Outputs remain off until a new safe action.');
 assert.equal((await state(db)).emergency_stop_active,false);await normal(db);
 assert.deepEqual((await db.query('SELECT auto_water_enabled,auto_feed_hour FROM tank_automation_settings')).rows,[{auto_water_enabled:false,auto_feed_hour:21}]);
 }finally{await db.close();}
});

test('running pump must report its interrupted result before resume; stop completion never completes the pump',async()=>{
 const db=await fixture();try{
 const pump=await normal(db,'REFILL_FOR');await db.query("UPDATE device_commands SET command_status='running' WHERE id=$1",[pump]);
 const stop=await queue(db,'STOP_ALL');await ack(db,stop.stop_command.id,'Emergency stop applied. Pumps and feeder are stopped.');
 await assert.rejects(queue(db,'RESUME_CONTROLS'),/Wait for confirmed stop/);
 assert.equal((await db.query('SELECT command_status FROM device_commands WHERE id=$1',[pump])).rows[0].command_status,'running');
 await db.query("UPDATE device_commands SET command_status='failed',result_message='Interrupted by STOP_ALL.' WHERE id=$1",[pump]);
 assert.ok((await queue(db,'RESUME_CONTROLS')).resume_command.id);
 }finally{await db.close();}
});

test('offline timeout records actual failure without execution timestamp and keeps the latch until a new confirmed stop',async()=>{
 const db=await fixture();try{
 const stop=await queue(db,'STOP_ALL');await db.query("UPDATE device_commands SET created_at=now()-interval '121 seconds' WHERE id=$1",[stop.stop_command.id]);
 const expired=await state(db);assert.equal(expired.stop_command.command_status,'failed');assert.match(expired.stop_command.result_message,/timed out/);
 assert.equal(expired.stop_command.executed_at,null);assert.equal(expired.emergency_stop_active,true);assert.equal(expired.active_commands.length,0);
 await assert.rejects(ack(db,stop.stop_command.id,'Emergency stop applied. Pumps and feeder are stopped.'),/already terminal/);
 assert.notEqual((await queue(db,'STOP_ALL')).stop_command.id,stop.stop_command.id);
 }finally{await db.close();}
});

test('foreign users/anonymous cannot request controls; ordinary queue attempts serialize; completion needs exact hardware contract',async()=>{
 const db=await fixture();try{
 const feed=await normal(db);await assert.rejects(normal(db,'DRAIN_FOR'),/Another actuator action/);
 await db.query("UPDATE device_commands SET command_status='rejected',result_message='Already fed today' WHERE id=$1",[feed]);
 await normal(db,'DRAIN_FOR');const stop=await queue(db,'STOP_ALL');
 await assert.rejects(ack(db,stop.stop_command.id,'Request received'),/hardware acknowledgement/);
 await db.exec("SET qa.actor='33333333-3333-4333-8333-333333333333'");await assert.rejects(state(db),/Owned paired actuator/);
 await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(queue(db,'STOP_ALL'),/permission denied/);
 }finally{await db.close();}
});

test('remote maintenance reset preserves feed history, is cancelled/blocked by Stop and times out truthfully without acknowledgement',async()=>{
 const db=await fixture();try{
 const feed=await normal(db);await ack(db,feed,'FEED_ONCE completed.');
 const reset=await normal(db,'RESET_FEED_LOCK');await assert.rejects(normal(db,'DRAIN_FOR'),/Another actuator action/);
 await db.query("UPDATE device_commands SET created_at=now()-interval '121 seconds' WHERE id=$1",[reset]);
 const expired=await state(db);const command=expired.terminal_commands.find(row=>row.id===reset);
 assert.equal(command.command_status,'failed');assert.equal(command.executed_at,null);assert.match(command.result_message,/could not be confirmed/);
 assert.equal((await db.query('SELECT command_status FROM device_commands WHERE id=$1',[feed])).rows[0].command_status,'done');
 const retry=await normal(db,'RESET_FEED_LOCK');await queue(db,'STOP_ALL');assert.equal((await db.query('SELECT command_status FROM device_commands WHERE id=$1',[retry])).rows[0].command_status,'rejected');
 await assert.rejects(normal(db,'RESET_FEED_LOCK'),/Emergency stop is active/);
 await assert.rejects(db.query('DELETE FROM tank_automation_settings WHERE tank_id=$1',[tank]),/Resume controls/);
 }finally{await db.close();}
});

test('direct Resume cannot bypass the explicit flow, and a newer Stop supersedes a pending Resume',async()=>{
 const db=await fixture();try{
 const stopped=await queue(db,'STOP_ALL');await ack(db,stopped.stop_command.id,'Emergency stop applied. Pumps and feeder are stopped.');
 await assert.rejects(normal(db,'RESUME_CONTROLS'),/explicit resume/);
 const resumed=await queue(db,'RESUME_CONTROLS');const newer=await queue(db,'STOP_ALL');
 assert.notEqual(newer.stop_command.id,stopped.stop_command.id);assert.equal(newer.emergency_stop_active,true);
 assert.equal((await db.query('SELECT command_status FROM device_commands WHERE id=$1',[resumed.resume_command.id])).rows[0].command_status,'rejected');
 await assert.rejects(ack(db,resumed.resume_command.id,'Controls resumed. Outputs remain off until a new safe action.'),/already terminal/);
 }finally{await db.close();}
});

test('both migrations coexist with the existing alert trigger: Stop cancels once, schedule inserts notify once, feeding settings remain editable',async()=>{
 const db=await fixture();try{
 await db.exec(`RESET ROLE; CREATE ROLE service_role;
 CREATE TABLE alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,device_uid text,type text,title text,message text,severity text,source text,command_id uuid,metadata jsonb DEFAULT '{}',created_at timestamptz);
 ALTER TABLE device_commands ADD COLUMN updated_at timestamptz;`);
 await db.exec(await fs.readFile('tests/fixtures/pump-alert-functions-before.sql','utf8'));
 await db.exec(await fs.readFile('supabase/migrations/20261010170000_pump_alert_wording.sql','utf8'));
 await db.exec('CREATE TRIGGER trg_create_actuator_alert_from_command AFTER UPDATE OF command_status ON device_commands FOR EACH ROW EXECUTE FUNCTION create_actuator_alert_from_command();');
 await db.exec(await fs.readFile('supabase/migrations/20261019150000_scheduled_feeding_activity_alerts.sql','utf8'));
 await db.exec(`SET ROLE authenticated;SET qa.actor='${owner}';`);
 const pending=await normal(db);const stopped=await queue(db,'STOP_ALL');await ack(db,stopped.stop_command.id,'Emergency stop applied. Pumps and feeder are stopped.');
 await db.query('UPDATE tank_automation_settings SET auto_feed_hour=20 WHERE tank_id=$1',[tank]);
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int n FROM alerts WHERE command_id=$1',[pending])).rows[0].n,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM alerts WHERE command_id=$1',[stopped.stop_command.id])).rows[0].n,1);
 const scheduled=(await db.query("INSERT INTO device_commands(user_id,tank_id,device_uid,command_type,command_status,status,command_value,command_source) VALUES($1,$2,'actuator-a','FEED_ONCE','done','done','2','schedule') RETURNING id",[owner,tank])).rows[0].id;
 await db.query("UPDATE device_commands SET command_status='done',status='done' WHERE id=$1",[scheduled]);
 const alerts=(await db.query('SELECT title FROM alerts WHERE command_id=$1',[scheduled])).rows;assert.deepEqual(alerts,[{title:'Automatic Feeding Completed'}]);
 assert.equal((await db.query('SELECT emergency_stop_active,auto_feed_hour FROM tank_automation_settings')).rows[0].emergency_stop_active,true);
 }finally{await db.close();}
});

test('a first Stop settings row does not opt an unconfigured tank into automatic feeding',async()=>{
 const db=await fixture();try{
 await db.query('DELETE FROM tank_automation_settings WHERE tank_id=$1',[tank]);
 const stopped=await queue(db,'STOP_ALL');assert.equal(stopped.emergency_stop_active,true);
 const settings=(await db.query('SELECT user_id,tank_id,device_uid,auto_feeding_enabled FROM tank_automation_settings')).rows[0];
 assert.deepEqual(settings,{user_id:owner,tank_id:tank,device_uid:'actuator-a',auto_feeding_enabled:false});
 }finally{await db.close();}
});

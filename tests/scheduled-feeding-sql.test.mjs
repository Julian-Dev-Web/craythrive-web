import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {buildTankActivity} from '../supabase/functions/_shared/tankActivity.js';
import {feedingExecutionSource,formatRecordedFeedingAction} from '../supabase/functions/_shared/feederControl.js';
const db=new PGlite();after(()=>db.close());
const owner='11111111-1111-4111-8111-111111111111',tank='22222222-2222-4222-8222-222222222222';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE tanks(id uuid PRIMARY KEY,user_id uuid,tank_name text);
 CREATE TABLE alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,device_uid text,type text,title text,message text,severity text,source text,command_id uuid,metadata jsonb DEFAULT '{}',created_at timestamptz);
 CREATE TABLE device_commands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id text,device_uid text,command_type text,command_status text,status text,duration_ms integer,result_message text,command_value text,created_at timestamptz DEFAULT now(),executed_at timestamptz);
 CREATE TABLE control_logs(id uuid,user_id uuid,tank_id uuid,action_type text,action_status text,notes text,metadata jsonb);
 CREATE FUNCTION create_alert_if_enabled(uuid,uuid,text,text,text,text,text,jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
 INSERT INTO tanks VALUES('${tank}','${owner}','Tank A');`);
await db.exec(await fs.readFile('tests/fixtures/pump-alert-functions-before.sql','utf8'));
// This fixture starts at the existing deployed pump wording revision.
await db.exec(await fs.readFile('supabase/migrations/20261010170000_pump_alert_wording.sql','utf8'));
await db.exec('CREATE TRIGGER trg_create_actuator_alert_from_command AFTER UPDATE OF command_status ON device_commands FOR EACH ROW EXECUTE FUNCTION create_actuator_alert_from_command();');
await db.exec(await fs.readFile('supabase/migrations/20261019150000_scheduled_feeding_activity_alerts.sql','utf8'));
const insert=async(status='done',source='schedule')=>(await db.query(`INSERT INTO device_commands(user_id,tank_id,device_uid,command_type,command_status,status,command_value,command_source,created_at,executed_at)
 VALUES($1,$2,'actuator-a','FEED_ONCE',$3,'pending','2',$4,'2026-10-19T03:44:00Z','2026-10-19T03:45:00Z') RETURNING *`,[owner,tank,status,source])).rows[0];
const alerts=async id=>(await db.query('SELECT * FROM alerts WHERE command_id=$1',[id])).rows;

test('completed scheduled INSERT creates exactly one durable alert, real cycles and Manila execution time without a browser',async()=>{
 const row=await insert();let result=await alerts(row.id);assert.equal(result.length,1);assert.equal(result[0].title,'Automatic Feeding Completed');
 assert.match(result[0].message,/Tank A.*2 dispense cycles/);assert.match(result[0].message,/Oct 19, 2026 11:45 AM/);assert.match(result[0].message,/not sensor-verified/);
 await db.query("UPDATE device_commands SET command_status='done',status='done',command_source='schedule' WHERE id=$1",[row.id]);
 assert.equal((await alerts(row.id)).length,1);
 const sources={device_commands:[row],alerts:result};const events=buildTankActivity({tank:{id:tank,user_id:owner,name:'Tank A'},userId:owner,sources});
 assert.equal(events.length,1);assert.equal(events[0].title,'Automatic Feeding');assert.equal(events[0].executionSource,'Automatic schedule');assert.equal(events[0].dispenseCycles,2);assert.match(events[0].timestampLabel,/11:45/);
 assert.deepEqual(buildTankActivity({tank:{id:tank,user_id:owner},userId:owner,sources}).map(x=>x.id),events.map(x=>x.id));
});

test('pending/running/rejected/failed schedules never generate success; pending to done uses same trigger and command id',async()=>{
 for(const status of ['pending','running','rejected','failed']) {
  const row=await insert(status);assert.ok((await alerts(row.id)).every(a=>a.title!=='Automatic Feeding Completed'));
  if(status==='pending'){await db.query("UPDATE device_commands SET command_status='done' WHERE id=$1",[row.id]);assert.equal((await alerts(row.id))[0].title,'Automatic Feeding Completed');}
 }
 const manual=await insert('done','manual');assert.equal((await alerts(manual.id))[0].title,'Feeding completed');
 const legacyPending=await insert('pending');await db.query("UPDATE device_commands SET status='done' WHERE id=$1",[legacyPending.id]);assert.equal((await alerts(legacyPending.id)).length,0);
});

test('human result prose never establishes schedule origin; reset is maintenance, not a feed or daily accounting event',()=>{
 const row={command_type:'FEED_ONCE',command_status:'done',result_message:'Scheduled/Automatic feeding completed successfully.'};
 assert.equal(feedingExecutionSource(row),null);assert.equal(feedingExecutionSource({...row,command_source:'manual'}),'manual');
 assert.equal(formatRecordedFeedingAction({command_type:'RESET_FEED_LOCK',command_status:'done'},'Completed'),null);
 const base={tank_id:tank,user_id:owner,created_at:'2026-10-19T03:45:00Z'};
 const events=buildTankActivity({tank:{id:tank,user_id:owner},userId:owner,sources:{device_commands:[{...base,id:'manual',...row,command_source:'manual'},{...base,id:'unknown',...row},{...base,id:'reset',command_type:'RESET_FEED_LOCK',command_status:'done'}]}});
 assert.equal(events.find(x=>x.id.endsWith(':manual')).title,'Manual Feeding');assert.equal(events.find(x=>x.id.endsWith(':unknown')).executionSource,'Source not recorded');assert.equal(events.find(x=>x.id.endsWith(':reset')).category,'device');
});

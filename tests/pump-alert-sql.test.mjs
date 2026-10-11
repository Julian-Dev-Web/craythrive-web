import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { formatPumpAction, formatPumpAlert } from '../supabase/functions/_shared/pumpActionWording.js';

const db=new PGlite();after(()=>db.close());
const original=await fs.readFile(new URL('./fixtures/pump-alert-functions-before.sql',import.meta.url),'utf8');
const migration=await fs.readFile(new URL('../supabase/migrations/20261010170000_pump_alert_wording.sql',import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111';
const tank='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await db.exec(`CREATE ROLE service_role;
 CREATE ROLE authenticated; CREATE ROLE anon;
 CREATE TABLE alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,device_uid text,
  type text,title text,message text,severity text,source text,command_id uuid,metadata jsonb DEFAULT '{}',
  status text DEFAULT 'active',is_read boolean DEFAULT false,created_at timestamptz DEFAULT now());
 CREATE TABLE device_commands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id text,device_uid text,
  command_type text,command_status text,status text,duration_ms integer,result_message text);
 CREATE TABLE control_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,
  action_type text,action_status text,notes text,metadata jsonb DEFAULT '{}');
 CREATE FUNCTION create_alert_if_enabled(p_user_id uuid,p_tank_id uuid,p_category text,p_type text,p_title text,p_message text,p_severity text,p_metadata jsonb)
 RETURNS void LANGUAGE sql AS $$ INSERT INTO alerts(user_id,tank_id,type,title,message,severity,metadata)
 VALUES(p_user_id,p_tank_id,p_type,p_title,p_message,p_severity,p_metadata) $$;`);
await db.exec(original);
await db.exec(`REVOKE ALL ON FUNCTION craythrive_pump_action_wording(jsonb) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION craythrive_pump_action_wording(jsonb) TO service_role;
 CREATE TRIGGER command_alert AFTER UPDATE OF command_status ON device_commands FOR EACH ROW EXECUTE FUNCTION create_actuator_alert_from_command();
 CREATE TRIGGER control_alert AFTER INSERT ON control_logs FOR EACH ROW EXECUTE FUNCTION create_alert_from_control_log();
 INSERT INTO alerts(title,message,metadata) VALUES('Drain completed','The drain pump ran for 10 seconds.','{"duration_ms":10000}');`);
const catalog=async()=>(await db.query("SELECT proname,prosecdef,proconfig,proacl FROM pg_proc WHERE proname IN ('craythrive_pump_action_wording','create_actuator_alert_from_command','create_alert_from_control_log') ORDER BY proname")).rows;
const oldCatalog=await catalog();
const history=(await db.query('SELECT * FROM alerts')).rows;
await db.exec(migration);
const migratedHistory=(await db.query('SELECT * FROM alerts')).rows;
beforeEach(()=>db.exec('TRUNCATE alerts,device_commands,control_logs;'));
const wording=async row=>(await db.query('SELECT craythrive_pump_action_wording($1) AS wording',[row])).rows[0].wording;
const alerts=async()=>(await db.query('SELECT * FROM alerts')).rows;
async function complete(type,status='done',result='') {
 const id=(await db.query("INSERT INTO device_commands(user_id,tank_id,command_type,command_status,status,duration_ms,result_message) VALUES($1,$2,$3,'pending','pending',10000,'queued') RETURNING id",[owner,tank,type])).rows[0].id;
 await db.query('UPDATE device_commands SET command_status=$1,status=$1,result_message=$2 WHERE id=$3',[status,result,id]);
 return (await db.query('SELECT * FROM device_commands WHERE id=$1',[id])).rows[0];
}

test('wording migration preserves all historical rows, function security/grants and execution triggers',async()=>{
 assert.deepEqual(migratedHistory,history);assert.deepEqual(await catalog(),oldCatalog);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal")).rows[0].n,2);
});

test('manual drain completion, rejection and failure generate correct text without duration/status changes',async()=>{
 for(const [status,title,message] of [['done','Drain completed','The drain pump was activated.'],
  ['rejected','Drain rejected','The drain action was blocked by a safety rule.'],
  ['failed','Drain failed','The drain action could not be completed.']]) {
  const row=await complete('DRAIN_FOR',status,'DRAIN safety micro-pulse completed for 250 ms.');
  const alert=(await alerts()).find(a=>a.command_id===row.id);
  assert.equal(alert.title,title);assert.equal(alert.message,message);
  assert.equal(row.command_status,status);assert.equal(row.duration_ms,10000);
  assert.equal(alert.metadata.duration_ms,10000);assert.doesNotMatch(alert.message,/\d|seconds|flow/);
  await db.query('UPDATE device_commands SET command_status=$1 WHERE id=$2',[status,row.id]);
  assert.equal((await alerts()).filter(a=>a.command_id===row.id).length,1);
 }
});

test('refill acknowledgement preserves requested duration and propagates actual runtime to mobile push metadata',async()=>{
 for(const ms of [1000,2000,250]) {
  const result=`REFILL relay command completed for ${ms} ms. Physical pump flow is not electronically sensed.`;
  const row=await complete('REFILL_FOR','done',result);const alert=(await alerts()).find(a=>a.command_id===row.id);
  assert.equal(alert.title,'Add Water completed');assert.equal(alert.message,formatPumpAction(row).message);
  assert.equal(alert.metadata.actual_duration_ms,ms);assert.equal(alert.metadata.duration_ms,10000);
  assert.equal(formatPumpAlert(alert).message,alert.message);assert.equal(row.result_message,result);
 }
 const unknown=await complete('REFILL_FOR','done','Completed successfully.');
 assert.equal((await alerts()).find(a=>a.command_id===unknown.id).message,'The refill pump was activated.');
});

test('automatic/control-log drain and refill share wording while preserving raw notes, duration and outcome',async()=>{
 for(const [type,status,metadata,message] of [
  ['AUTO_DRAIN','done',{duration_seconds:10,pulse_ms:250},'The drain pump was activated.'],
  ['AUTO_DRAIN','blocked',{duration_seconds:10},'The drain action was blocked by a safety rule.'],
  ['AUTO_DRAIN','failed',{duration_seconds:10},'The drain action could not be completed.'],
  ['AUTO_REFILL','done',{duration_seconds:10,actual_duration_ms:2000},'The refill pump ran for 2 seconds.'],
  ['AUTO_REFILL','done',{duration_seconds:10},'The refill pump was activated.'],
 ]) {
  const notes='Raw actuator diagnostic retained for audit.';
  const row=(await db.query('INSERT INTO control_logs(user_id,tank_id,action_type,action_status,notes,metadata) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[owner,tank,type,status,notes,metadata])).rows[0];
  const alert=(await alerts()).find(a=>a.metadata.control_log_id===row.id);
  assert.equal(alert.message,message);assert.equal(row.action_status,status);
  assert.equal(row.notes,notes);assert.deepEqual(row.metadata,metadata);
  assert.equal(formatPumpAlert(alert).message,message);
 }
});

test('SQL and portable Web/mobile formatter agree for outcomes, actual durations, historical alerts and recommendation-only text',async()=>{
 for(const row of [
  {command_type:'DRAIN_FOR',command_status:'done',duration_ms:10000},
  {action_type:'AUTO_DRAIN',action_status:'failed'},
  {title:'Drain completed',status:'resolved',metadata:{command_type:'DRAIN_FOR',command_status:'rejected'}},
  {title:'Refill completed',message:'The refill pump ran for 10 seconds.'},
  {action_type:'AUTO_REFILL',action_status:'done',metadata:{actual_duration_seconds:2}},
  {command_type:'REFILL_FOR',command_status:'done',result_message:'REFILL relay command completed for 1000 ms.'},
  {command_type:'REFILL_FOR',command_status:'done',result_message:'REFILL_FOR completed for 1000 ms. Safety check passed.'},
  {command_type:'REFILL_FOR',command_status:'done',metadata:{actual_duration_ms:250}},
  {command_type:'DRAIN_FOR',command_status:'pending'},
  {command_type:'FEED_ONCE',command_status:'done'},
  {title:'Add water needed',message:'Recommendation only.'},
 ]) {
  const sql=await wording(row),js=formatPumpAction(row);
  assert.equal(sql?.title,js?.title);assert.equal(sql?.message,js?.message);
 }
});

test('deployment guard refuses to overwrite an already changed generator',async()=>{
 const before=await catalog();await assert.rejects(db.exec(migration),/preflight changed/);
 await db.exec('ROLLBACK');assert.deepEqual(await catalog(),before);
});

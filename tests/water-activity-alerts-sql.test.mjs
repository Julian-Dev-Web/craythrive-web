import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await fs.readFile('supabase/migrations/20261019170000_water_automation_activity_alerts.sql', 'utf8');
const owner = '11111111-1111-4111-8111-111111111111', tank = '22222222-2222-4222-8222-222222222222';
const other = '99999999-9999-4999-8999-999999999999';
const instant = '2026-10-19T02:00:00Z';
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('qa.actor',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE tanks(id uuid PRIMARY KEY,user_id uuid,tank_name text);
    CREATE TABLE alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,tank_id uuid,device_uid text,type text,
      title text,message text,severity text,is_read boolean DEFAULT false,status text DEFAULT 'active',source text DEFAULT 'actuator',command_id uuid,
      metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
    CREATE TABLE notification_preferences(user_id uuid PRIMARY KEY,pump_alerts boolean DEFAULT true,tank_alerts boolean DEFAULT true,
      marketplace_alerts boolean DEFAULT true,feeding_alerts boolean DEFAULT true);
    CREATE TABLE device_commands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id text,device_uid text,command_type text,
      command_value text,command_status text,status text,duration_ms integer,result_message text,created_at timestamptz,executed_at timestamptz);
    CREATE TABLE control_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,action_type text,action_status text,
      notes text,metadata jsonb DEFAULT '{}');
    CREATE TABLE tank_automation_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid NOT NULL,device_uid text,
      action_type text NOT NULL,action_status text DEFAULT 'done',reason text,water_status text,ph_status text,turbidity_status text,
      ammonia_status text,temperature_status text,stable_reading_count integer,duration_seconds integer,created_at timestamptz DEFAULT now());
    INSERT INTO tanks VALUES('${tank}','${owner}','Tank A');
    INSERT INTO notification_preferences(user_id) VALUES('${owner}');`);
  await db.exec(await fs.readFile('tests/fixtures/sensor-alert-preferences.sql', 'utf8'));
  await db.exec(await fs.readFile('tests/fixtures/pump-alert-functions-before.sql', 'utf8'));
  await db.exec(await fs.readFile('tests/fixtures/automation-mirror-before.sql', 'utf8'));
  await db.exec(`CREATE TRIGGER mirror AFTER INSERT ON tank_automation_logs FOR EACH ROW EXECUTE FUNCTION mirror_tank_automation_log_to_device_commands();
    CREATE TRIGGER control_alert AFTER INSERT ON control_logs FOR EACH ROW EXECUTE FUNCTION create_alert_from_control_log();
    CREATE TRIGGER trg_create_actuator_alert_from_command AFTER UPDATE OF command_status ON device_commands FOR EACH ROW EXECUTE FUNCTION create_actuator_alert_from_command();`);
  // Both pipelines coexist, including deployments with completed-INSERT command alerts.
  await db.exec(await fs.readFile('supabase/migrations/20261019150000_scheduled_feeding_activity_alerts.sql', 'utf8'));
  return db;
}
const insert = async (db, status = 'done', type = 'AUTO_REFILL', user = owner) => (await db.query(`INSERT INTO tank_automation_logs
  (user_id,tank_id,device_uid,action_type,action_status,reason,water_status,stable_reading_count,duration_seconds,created_at)
  VALUES($1,$2,'actuator-a',$3,$4,'Relay pulse executed. Water depth before=2.96 cm, after=3.70 cm, delta=0.74 cm.','LOW_WARNING',3,5,$5) RETURNING *`,
  [user, tank, type, status, instant])).rows[0];
const alerts = async (db, id) => (await db.query("SELECT * FROM alerts WHERE metadata->>'tank_automation_log_id'=$1", [id])).rows;
const definitions = async db => (await db.query(`SELECT proname,md5(pg_get_functiondef(oid)) hash,proacl,proconfig FROM pg_proc
  WHERE proname IN ('mirror_tank_automation_log_to_device_commands','create_actuator_alert_from_command','create_alert_from_control_log','create_alert_if_enabled') ORDER BY proname`)).rows;

test('existing saved rows are readable after migration; no history/backfill or actuator function rewrite; owner RPC is enforced', async () => {
  const db = await fixture();
  try {
    const existing = await insert(db), before = await definitions(db);
    const beforeData = (await db.query('SELECT * FROM alerts')).rows;
    await db.exec(migration); await db.exec(migration);
    await db.exec(await fs.readFile('docs/sql/20261019_water_activity_alerts_preflight.sql', 'utf8'));
    assert.deepEqual(await definitions(db), before);
    assert.deepEqual((await db.query('SELECT * FROM alerts')).rows, beforeData);
    assert.deepEqual((await db.query('SELECT * FROM tank_automation_logs')).rows, [existing]);
    assert.equal((await db.query('SELECT count(*)::int n FROM device_commands')).rows[0].n, 1);
    await db.exec(`SET ROLE authenticated; SET qa.actor='${owner}';`);
    assert.equal((await db.query('SELECT * FROM get_tank_automation_history($1)', [tank])).rows[0].id, existing.id);
    assert.equal((await db.query("SELECT * FROM get_tank_automation_history($1,'2026-10-18T16:00:00Z','2026-10-19T16:00:00Z')", [tank])).rows.length, 1);
    await assert.rejects(db.query('SELECT * FROM get_tank_automation_history($1,NULL,NULL,0,101)', [tank]), /Invalid history/);
    await db.exec(`SET qa.actor='${other}';`);
    await assert.rejects(db.query('SELECT * FROM get_tank_automation_history($1)', [tank]), /ownership/);
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(db.query('SELECT * FROM get_tank_automation_history($1)', [tank]), /permission denied/);
  } finally { await db.close(); }
});
test('each real pulse creates one persistent correct alert despite direct, command and control mirrors and repeat updates', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    for (const type of ['AUTO_REFILL', 'AUTO_REFILL', 'AUTO_DRAIN', 'AUTO_DRAIN']) {
      const log = await insert(db, 'done', type);
      let result = await alerts(db, log.id);
      assert.equal(result.length, 1);
      assert.equal(result[0].title, type === 'AUTO_REFILL' ? 'Automatic Water Refill Completed' : 'Automatic Water Drain Completed');
      assert.match(result[0].message, /Tank A automatically/); assert.match(result[0].message, /before=2.96 cm/);
      assert.equal(result[0].source, 'tank_automation_logs'); assert.equal(result[0].severity, 'normal');
      assert.equal(result[0].created_at.toISOString(), instant.replace('Z', '.000Z'));
      assert.equal(result[0].metadata.duration_seconds, 5);
      await db.query("UPDATE tank_automation_logs SET action_status='done' WHERE id=$1", [log.id]);
      await db.query(`INSERT INTO control_logs(user_id,tank_id,action_type,action_status,notes,metadata)
        VALUES($1,$2,$3,'done','Independent mirror with saved source id',$4)`, [owner, tank, type, { tank_automation_log_id: log.id }]);
      const command = (await db.query("SELECT id FROM device_commands WHERE result_message LIKE $1", [`%Auto log id: ${log.id}`])).rows[0];
      await db.query("UPDATE device_commands SET command_status='done' WHERE id=$1", [command.id]);
      result = await alerts(db, log.id); assert.equal(result.length, 1);
    }
    assert.equal((await db.query('SELECT count(*)::int n FROM alerts')).rows[0].n, 4);
  } finally { await db.close(); }
});
test('source action_status overrides legacy completed mirrors; failed/blocked never produce success; rechecking waits for real completion', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    for (const [state, suffix, severity] of [['failed', 'Failed', 'critical'], ['blocked', 'Blocked', 'warning'], ['rejected', 'Blocked', 'warning']]) {
      const log = await insert(db, state), result = await alerts(db, log.id);
      assert.equal(result.length, 1); assert.equal(result[0].title, `Automatic Water Refill ${suffix}`);
      assert.equal(result[0].severity, severity); assert.doesNotMatch(result[0].message, /automatically added water/);
      assert.match(result[0].message, /Relay pulse executed/);
    }
    const rechecking = await insert(db, 'rechecking');
    assert.equal((await alerts(db, rechecking.id)).length, 0);
    // The unchanged mirror maps unfamiliar states to done; the alert guard must
    // still refuse success because the actual source log is rechecking.
    await db.query("UPDATE tank_automation_logs SET action_status='done' WHERE id=$1", [rechecking.id]);
    assert.equal((await alerts(db, rechecking.id))[0].title, 'Automatic Water Refill Completed');
    const before = (await alerts(db, rechecking.id))[0];
    await db.query("UPDATE alerts SET is_read=true,status='resolved' WHERE id=$1", [before.id]);
    await db.query("UPDATE tank_automation_logs SET action_status='failed' WHERE id=$1", [rechecking.id]);
    const after = await alerts(db, rechecking.id); assert.equal(after.length, 1);
    assert.equal(after[0].id, before.id); assert.equal(after[0].is_read, true); assert.equal(after[0].status, 'resolved');
    assert.equal(after[0].title, 'Automatic Water Refill Failed');
  } finally { await db.close(); }
});
test('pump preferences, null owner inheritance, unrelated alerts and foreign-owner isolation remain intact', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.query('UPDATE notification_preferences SET pump_alerts=false WHERE user_id=$1', [owner]);
    await insert(db); assert.equal((await db.query('SELECT count(*)::int n FROM alerts')).rows[0].n, 0);
    await db.query('UPDATE notification_preferences SET pump_alerts=true WHERE user_id=$1', [owner]);
    const log = await insert(db, 'done', 'AUTO_DRAIN', null);
    assert.equal((await alerts(db, log.id)).length, 1);
    await db.exec(`SET ROLE authenticated; SET qa.actor='${owner}';`);
    assert.equal((await db.query('SELECT * FROM get_tank_automation_history($1)', [tank])).rows.length, 2);
    await db.exec('RESET ROLE;');
    await db.query(`INSERT INTO alerts(user_id,tank_id,type,title,message,metadata) VALUES($1,$2,'sensor_reading','Low pH','Independent sensor event',$3)`,
      [owner, tank, { tank_automation_log_id: log.id }]);
    assert.equal((await db.query("SELECT count(*)::int n FROM alerts WHERE type='sensor_reading' AND title='Low pH'")).rows[0].n, 1);
    await insert(db, 'done', 'AUTO_REFILL', other);
    await db.exec(`SET ROLE authenticated; SET qa.actor='${owner}';`);
    assert.equal((await db.query('SELECT * FROM get_tank_automation_history($1)', [tank])).rows.length, 2);
  } finally { await db.close(); }
});
test('notification delivery failure does not roll back a valid automation history row', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec("CREATE OR REPLACE FUNCTION create_alert_if_enabled(p_user_id uuid,p_tank_id uuid,p_category text,p_type text,p_title text,p_message text,p_severity text,p_metadata jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Notification subsystem unavailable'; END $$;");
    const row = await insert(db);
    assert.equal((await db.query('SELECT id FROM tank_automation_logs WHERE id=$1', [row.id])).rows[0].id, row.id);
    assert.equal((await db.query('SELECT count(*)::int n FROM device_commands')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('source-only logging creates a durable notification with no browser or command mirror required', async () => {
  const db = await fixture();
  try {
    await db.exec(migration); await db.exec('DROP TRIGGER mirror ON tank_automation_logs;');
    const row = await insert(db);
    assert.equal((await alerts(db, row.id)).length, 1);
    assert.equal((await db.query('SELECT count(*)::int n FROM device_commands')).rows[0].n, 0);
  } finally { await db.close(); }
});
test('a later real status update adopts a previously saved command alert instead of duplicating it', async () => {
  const db = await fixture();
  try {
    const log = await insert(db);
    const original = (await db.query('SELECT * FROM alerts')).rows[0];
    assert.equal(original.metadata.tank_automation_log_id, undefined);
    await db.exec(migration);
    await db.query("UPDATE tank_automation_logs SET action_status='done' WHERE id=$1", [log.id]);
    const result = await alerts(db, log.id);
    assert.equal(result.length, 1); assert.equal(result[0].id, original.id);
    assert.equal(result[0].title, 'Automatic Water Refill Completed');
    assert.equal((await db.query('SELECT count(*)::int n FROM alerts')).rows[0].n, 1);
  } finally { await db.close(); }
});

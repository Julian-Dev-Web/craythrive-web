import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const repair = await fs.readFile('supabase/migrations/20261019160000_actuator_command_source_compatibility.sql', 'utf8');
const alertsMigration = await fs.readFile('supabase/migrations/20261019150000_scheduled_feeding_activity_alerts.sql', 'utf8');
const owner = '11111111-1111-4111-8111-111111111111', tank = '22222222-2222-4222-8222-222222222222';
const revision = async db => (await db.query("SELECT md5(pg_get_functiondef('create_actuator_alert_from_command()'::regprocedure)) hash")).rows[0].hash;
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE tanks(id uuid PRIMARY KEY,user_id uuid,tank_name text);
    CREATE TABLE tank_automation_settings(tank_id uuid PRIMARY KEY,auto_feeding_enabled boolean,emergency_stop_active boolean);
    CREATE TABLE alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,device_uid text,type text,title text,message text,severity text,source text,command_id uuid,metadata jsonb DEFAULT '{}',created_at timestamptz);
    CREATE TABLE device_commands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id text,device_uid text,command_type text,command_status text,status text,duration_ms integer,result_message text,command_value text,created_at timestamptz DEFAULT now(),executed_at timestamptz);
    CREATE TABLE control_logs(id uuid,user_id uuid,tank_id uuid,action_type text,action_status text,notes text,metadata jsonb);
    CREATE FUNCTION create_alert_if_enabled(uuid,uuid,text,text,text,text,text,jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    INSERT INTO tanks VALUES('${tank}','${owner}','Tank A');
    INSERT INTO tank_automation_settings VALUES('${tank}',true,true);`);
  // This is the older function actually supplied in the production diagnostic.
  // Do not silently install an unrelated pump-wording migration to pass the guard.
  await db.exec(await fs.readFile('tests/fixtures/pump-alert-functions-before.sql', 'utf8'));
  await db.exec('CREATE TRIGGER trg_create_actuator_alert_from_command AFTER UPDATE OF command_status ON device_commands FOR EACH ROW EXECUTE FUNCTION create_actuator_alert_from_command();');
  assert.equal(await revision(db), '64cff69aa4deda3bd7afd5d73c7c7860');
  return db;
}

test('additive repair is repeatable and changes no functions, safety settings or execution history', async () => {
  const db = await fixture();
  try {
    const before = await revision(db);
    await db.exec(repair); await db.exec(repair);
    assert.equal(await revision(db), before);
    assert.deepEqual((await db.query('SELECT * FROM tank_automation_settings')).rows,
      [{ tank_id: tank, auto_feeding_enabled: true, emergency_stop_active: true }]);
    assert.equal((await db.query('SELECT count(*)::int count FROM device_commands')).rows[0].count, 0);
    assert.equal((await db.query('SELECT count(*)::int count FROM alerts')).rows[0].count, 0);
    const column = (await db.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='device_commands' AND column_name='command_source'")).rows[0];
    assert.deepEqual(column, { data_type: 'text', is_nullable: 'YES' });
    // The reviewed alert migration may follow the compatibility repair.
    await db.exec(alertsMigration);
    const row = (await db.query(`INSERT INTO device_commands(user_id,tank_id,device_uid,command_type,command_status,status,command_source,command_value,executed_at)
      VALUES($1,$2,'actuator-a','FEED_ONCE','done','pending','schedule','2',now()) RETURNING id`, [owner, tank])).rows[0];
    assert.equal((await db.query('SELECT title FROM alerts WHERE command_id=$1', [row.id])).rows[0].title, 'Automatic Feeding Completed');
  } finally { await db.close(); }
});
test('reviewed production revision upgrades directly, preserves legacy pending inserts and deduplicates real scheduled completion', async () => {
  const db = await fixture();
  try {
    await db.exec(alertsMigration); await db.exec(repair);
    const row = (await db.query(`INSERT INTO device_commands(user_id,tank_id,device_uid,command_type,command_status,status,command_value)
      VALUES($1,$2,'actuator-a','FEED_ONCE','pending','pending','2') RETURNING id`, [owner, tank])).rows[0];
    assert.equal((await db.query('SELECT count(*)::int count FROM alerts')).rows[0].count, 0);
    await db.query("UPDATE device_commands SET command_status='rejected' WHERE id=$1", [row.id]);
    assert.equal((await db.query('SELECT severity FROM alerts WHERE command_id=$1', [row.id])).rows[0].severity, 'warning');
    const scheduled = (await db.query(`INSERT INTO device_commands(user_id,tank_id,device_uid,command_type,command_status,status,command_source,command_value,executed_at)
      VALUES($1,$2,'actuator-a','FEED_ONCE','done','pending','schedule','3',now()) RETURNING id`, [owner, tank])).rows[0];
    await db.query("UPDATE device_commands SET command_status='done' WHERE id=$1", [scheduled.id]);
    const alerts = (await db.query('SELECT * FROM alerts WHERE command_id=$1', [scheduled.id])).rows;
    assert.equal(alerts.length, 1); assert.equal(alerts[0].title, 'Automatic Feeding Completed');
    assert.match(alerts[0].message, /3 dispense cycles.*not sensor-verified/);
  } finally { await db.close(); }
});
test('an unreviewed production alert definition still aborts the migration atomically', async () => {
  const db = await fixture();
  try {
    await db.exec("CREATE OR REPLACE FUNCTION create_actuator_alert_from_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;");
    const before = await revision(db);
    await assert.rejects(db.exec(alertsMigration), /Existing command alert function changed/);
    await db.exec('ROLLBACK;');
    assert.equal(await revision(db), before);
    assert.equal((await db.query("SELECT count(*)::int count FROM information_schema.columns WHERE table_name='device_commands' AND column_name='command_source'")).rows[0].count, 0);
  } finally { await db.close(); }
});

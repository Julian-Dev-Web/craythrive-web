import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { formatPumpAction } from '../supabase/functions/_shared/pumpActionWording.js';

const read = name => fs.readFile(new URL(name, import.meta.url), 'utf8');
const oldFunctions = await read('./fixtures/pump-alert-functions-before.sql');
const mirror = await read('./fixtures/automation-mirror-before.sql');
const oldMigration = await read('../supabase/migrations/20261010170000_pump_alert_wording.sql');
const migration = await read('../supabase/migrations/20261019120000_water_automation_rechecking.sql');
const owner = '11111111-1111-4111-8111-111111111111';
const tank = '22222222-2222-4222-8222-222222222222';

async function setup(kind = 'text') {
  const db = new PGlite();
  await db.exec(`CREATE ROLE service_role; CREATE ROLE authenticated; CREATE ROLE anon;
    ${kind === 'enum' ? "CREATE TYPE automation_status AS ENUM ('done','failed','blocked','skipped','pending','unknown');" : ''}
    CREATE TABLE tanks(id uuid,user_id uuid);
    CREATE TABLE alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,tank_id uuid,device_uid text,
      type text,title text,message text,severity text,source text,command_id uuid,metadata jsonb DEFAULT '{}',
      status text DEFAULT 'active',is_read boolean DEFAULT false,created_at timestamptz DEFAULT now());
    CREATE TABLE device_commands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id text,device_uid text,
      command_type text,command_value text,command_status text CHECK(command_status IN ('pending','done','failed','rejected')),
      status text,duration_ms integer,result_message text,created_at timestamptz,executed_at timestamptz);
    CREATE TABLE control_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,
      action_type text,action_status text,notes text,metadata jsonb DEFAULT '{}');
    CREATE TABLE tank_automation_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,device_uid text,
      action_type text,action_status ${kind === 'enum' ? 'automation_status' : 'text'} DEFAULT 'done'
      ${kind === 'check' ? "CHECK(action_status IN ('done','failed','blocked','skipped','pending','unknown','legacy'))" : ''},
      reason text,water_status text,stable_reading_count integer,duration_seconds integer,created_at timestamptz DEFAULT now());
    CREATE FUNCTION create_alert_if_enabled(p_user_id uuid,p_tank_id uuid,p_category text,p_type text,p_title text,p_message text,p_severity text,p_metadata jsonb)
      RETURNS void LANGUAGE sql AS $$ INSERT INTO alerts(user_id,tank_id,type,title,message,severity,metadata)
        VALUES(p_user_id,p_tank_id,p_type,p_title,p_message,p_severity,p_metadata) $$;`);
  await db.exec(oldFunctions);
  await db.exec(oldMigration);
  await db.exec(mirror);
  await db.exec(`CREATE TRIGGER mirror AFTER INSERT ON tank_automation_logs FOR EACH ROW EXECUTE FUNCTION mirror_tank_automation_log_to_device_commands();
    CREATE TRIGGER control_alert AFTER INSERT ON control_logs FOR EACH ROW EXECUTE FUNCTION create_alert_from_control_log();
    INSERT INTO tank_automation_logs(user_id,tank_id,action_type,action_status,reason) VALUES('${owner}','${tank}','AUTO_REFILL','failed','No sensor movement confirmed.');`);
  return db;
}

for (const kind of ['text', 'check', 'enum']) {
  test(`migration supports rechecking for ${kind}, preserves history/security, is idempotent and keeps mirror compatible`, async () => {
    const db = await setup(kind);
    try {
      const oldRows = (await db.query('SELECT * FROM tank_automation_logs')).rows;
      const commands = (await db.query('SELECT * FROM device_commands')).rows;
      const securityQuery = "SELECT proname,prosecdef,proconfig,proacl FROM pg_proc WHERE proname IN ('craythrive_pump_action_wording','mirror_tank_automation_log_to_device_commands') ORDER BY proname";
      const security = (await db.query(securityQuery)).rows;
      await db.exec(migration);
      await db.exec(migration);
      assert.deepEqual((await db.query('SELECT * FROM tank_automation_logs')).rows, oldRows);
      assert.deepEqual((await db.query('SELECT * FROM device_commands')).rows, commands);
      assert.deepEqual((await db.query(securityQuery)).rows, security);
      await db.query("INSERT INTO tank_automation_logs(user_id,tank_id,action_type,action_status,reason) VALUES($1,$2,'AUTO_REFILL','rechecking','Before: 1.80 cm; latest: 1.51 cm')", [owner, tank]);
      const mirrored = (await db.query('SELECT * FROM device_commands ORDER BY created_at DESC LIMIT 1')).rows[0];
      assert.equal(mirrored.command_status, 'done'); // history mirror must never become an executable pending request
      assert.match(mirrored.result_message, /Auto action status: rechecking.*Auto log id:/);
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid='tank_automation_logs'::regclass AND contype='c'")).rows[0].n, kind === 'check' ? 1 : 0);
      if (kind === 'check') {
        await assert.rejects(db.query("INSERT INTO tank_automation_logs(action_status) VALUES('invalid')"), /check constraint/);
        await db.query("INSERT INTO tank_automation_logs(action_status) VALUES('legacy')");
      }
      for (const action_type of ['AUTO_REFILL', 'AUTO_DRAIN']) {
        const row = { action_type, action_status: 'rechecking' };
        const sql = (await db.query('SELECT craythrive_pump_action_wording($1) AS result', [row])).rows[0].result;
        assert.match(sql.title, /Executed – Rechecking/);
        assert.match(sql.message, /activated successfully.*Fresh sensor readings/);
        await db.query("INSERT INTO control_logs(user_id,tank_id,action_type,action_status,notes) VALUES($1,$2,$3,'rechecking','Ultrasonic settling')", [owner, tank, action_type]);
      }
      for (const row of [
        { action_type: 'AUTO_REFILL', action_status: 'rechecking', command_status: 'done' },
        { command_type: 'REFILL_FOR', command_value: 'auto', command_status: 'done', result_message: mirrored.result_message },
        { action_type: 'AUTO_REFILL', action_status: 'failed', reason: 'Sensor movement could not be confirmed.' },
        { action_type: 'AUTO_DRAIN', action_status: 'failed', reason: 'STOP_ALL interrupted the action.' },
        { action_type: 'AUTO_DRAIN', action_status: 'skipped' },
        { action_type: 'AUTO_REFILL', action_status: 'done' },
        { action_type: 'AUTO_DRAIN', action_status: 'blocked' },
      ]) {
        const sql = (await db.query('SELECT craythrive_pump_action_wording($1) AS result', [row])).rows[0].result;
        // This historical migration's notification text is tested separately
        // from the current Web renderer, which now trusts saved status fields.
        if (row.action_status === 'rechecking' || row.result_message) {
          assert.match(sql.title, /Executed – Rechecking/);
        } else if (row.action_status === 'failed' && row.reason.startsWith('Sensor')) {
          assert.match(sql.title, /Pending Verification/);
          assert.equal(formatPumpAction(row).status, 'failed');
        } else {
          const web = formatPumpAction(row);
          assert.deepEqual(sql, { title: web.title, message: web.message });
        }
      }
      const alerts = (await db.query('SELECT * FROM alerts')).rows;
      assert.equal(alerts.length, 2);
      assert.ok(alerts.every(row => row.severity === 'info' && row.title.includes('Executed – Rechecking')));
    } finally { await db.close(); }
  });
}

test('migration aborts rather than broadening a composite safety constraint', async () => {
  const db = await setup();
  try {
    await db.exec("ALTER TABLE tank_automation_logs ADD CONSTRAINT composite_safety CHECK(action_status <> 'failed' OR duration_seconds IS NULL)");
    await assert.rejects(db.exec(migration), /Review composite automation constraint/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_constraint WHERE conname='composite_safety'")).rows[0].n, 1);
  } finally { await db.close(); }
});

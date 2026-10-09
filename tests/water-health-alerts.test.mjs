import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Entirely local PostgreSQL. Never connects to Supabase or sends a push.
const db = new PGlite();
after(() => db.close());
await db.exec(`
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, tank_alerts boolean);
  CREATE TABLE public.alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tank_id uuid,
    type text, title text, message text, severity text, is_read boolean DEFAULT false,
    metadata jsonb DEFAULT '{}', status text DEFAULT 'active', resolved_at timestamptz,
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE public.sensor_readings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tank_id uuid,
    temperature_status text, ph_status text, turbidity_status text, water_status text,
    temperature_c numeric, ph_value numeric, turbidity_voltage numeric,
    water_depth_cm numeric, water_level numeric, raw_payload jsonb,
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE push_events (alert_id uuid);
  CREATE FUNCTION test_enqueue_push() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO push_events VALUES (new.id); RETURN new; END;
  $$;
  CREATE TRIGGER test_push AFTER INSERT ON public.alerts FOR EACH ROW EXECUTE FUNCTION test_enqueue_push();
`);
await db.exec(await fs.readFile(new URL('./fixtures/sensor-alert-preferences.sql', import.meta.url), 'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/patches/water_sensor_error_lifecycle.sql', import.meta.url), 'utf8'));
await db.exec('CREATE TRIGGER test_sensor_alert AFTER INSERT ON public.sensor_readings FOR EACH ROW EXECUTE FUNCTION public.create_alert_from_sensor_reading()');

const owner = '11111111-1111-4111-8111-111111111111';
const tank = '22222222-2222-4222-8222-222222222222';
let sequence = 0;
beforeEach(async () => { await db.exec('TRUNCATE sensor_readings, alerts, notification_preferences, push_events'); sequence = 0; });
async function reading(status, metadata = {}, userId = owner, tankId = tank) {
  await db.query(`INSERT INTO sensor_readings (user_id,tank_id,temperature_status,ph_status,turbidity_status,water_status,temperature_c,ph_value,turbidity_voltage,water_depth_cm,water_level,raw_payload,created_at)
    VALUES ($1,$2,'SAFE_IDEAL','IDEAL_PH_LEVEL','CLEAR',$3,26.3,7.2,2.8,$4,$4,$5,$6)`,
  [userId, tankId, status, ['SENSOR_ERROR', 'NO_READING'].includes(status) ? null : 4.02, metadata,
    new Date(Date.UTC(2026, 9, 9) + sequence++ * 1000).toISOString()]);
}
const errorAlerts = async () => (await db.query("SELECT * FROM alerts WHERE title = 'Water level sensor error' ORDER BY created_at,id")).rows;
const pushes = async () => Number((await db.query('SELECT count(*) AS count FROM push_events')).rows[0].count);

test('valid, startup waiting, and one/two transient failures never send a water sensor error', async () => {
  await reading('NO_READING', { water_measurement_fresh: false });
  await reading('NO_READING', { water_measurement_fresh: false });
  await reading('SAFE_IDEAL', { water_measurement_fresh: true });
  await reading('SENSOR_STALE', { water_value_source: 'last_good', water_measurement_fresh: false });
  await reading('SAFE_IDEAL', { water_measurement_fresh: true });
  await reading('SENSOR_STALE', { water_value_source: 'last_good' });
  await reading('SENSOR_STALE', { water_value_source: 'last_good' });
  await reading('SAFE_IDEAL');
  assert.equal((await errorAlerts()).length, 0);
  assert.equal(await pushes(), 0);
});

test('confirmed failure sends one active alert; continued failures do not reset read state or send duplicates', async () => {
  await reading('SAFE_IDEAL');
  await reading('SENSOR_ERROR');
  await db.exec("UPDATE alerts SET is_read=true WHERE title='Water level sensor error'");
  for (let i = 0; i < 20; i++) await reading('SENSOR_ERROR');
  const alerts = await errorAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 'active');
  assert.equal(alerts[0].is_read, true);
  assert.equal(alerts[0].metadata.dedupe_key, `${tank}:water_level:SENSOR_ERROR`);
  assert.equal(await pushes(), 1);
});

test('only fresh recovery closes the active error; a later confirmed failure sends a new alert', async () => {
  await reading('SENSOR_ERROR');
  await reading('SENSOR_STALE');
  await reading('SAFE_IDEAL', { water_value_source: 'last_good', water_measurement_fresh: false });
  assert.equal((await errorAlerts())[0].status, 'active');
  await reading('SENSOR_ERROR');
  assert.equal(await pushes(), 1);
  await reading('SAFE_IDEAL', { water_value_source: 'fresh', water_measurement_fresh: true });
  assert.equal((await errorAlerts())[0].status, 'resolved');
  assert.ok((await errorAlerts())[0].resolved_at);
  await reading('SENSOR_STALE');
  await reading('SENSOR_ERROR');
  assert.equal((await errorAlerts()).length, 2);
  assert.equal((await errorAlerts()).filter(row => row.status === 'active').length, 1);
  assert.equal(await pushes(), 2);
});

test('legacy active error alerts are reused and resolved without deleting history', async () => {
  await db.query("INSERT INTO alerts(user_id,tank_id,type,title,severity,metadata) VALUES($1,$2,'sensor_reading','Water level sensor error','critical','{}')", [owner, tank]);
  await reading('SENSOR_ERROR');
  assert.equal((await errorAlerts()).length, 1);
  assert.equal(await pushes(), 1);
  await reading('SAFE_IDEAL');
  assert.equal((await errorAlerts())[0].status, 'resolved');
});

test('alert episodes are scoped by owner/tank and respect existing notification preferences', async () => {
  const otherTank = '33333333-3333-4333-8333-333333333333';
  await db.query('INSERT INTO notification_preferences VALUES($1,false)', [owner]);
  await reading('SENSOR_ERROR');
  assert.equal(await pushes(), 0);
  await db.exec('UPDATE notification_preferences SET tank_alerts=true');
  await reading('SENSOR_ERROR');
  await reading('SENSOR_ERROR', {}, owner, otherTank);
  assert.equal(await pushes(), 2);
  await reading('SAFE_IDEAL', {}, owner, otherTank);
  const alerts = await errorAlerts();
  assert.equal(alerts.find(row => row.tank_id === tank).status, 'active');
  assert.equal(alerts.find(row => row.tank_id === otherTank).status, 'resolved');
});

test('stale metadata suppresses physical water warnings; other parameter alert rules remain intact', async () => {
  await reading('CRITICAL_LOW', { water_value_source: 'last_good', water_measurement_fresh: false });
  assert.equal(await pushes(), 0);
  await reading('SAFE_IDEAL');
  await reading('CRITICAL_LOW', { water_measurement_fresh: true });
  assert.equal((await db.query("SELECT title FROM alerts WHERE title='Critical low water level'")).rows.length, 1);
  await db.exec(`INSERT INTO sensor_readings(user_id,tank_id,temperature_status,ph_status,turbidity_status,water_status,temperature_c,ph_value,turbidity_voltage,water_depth_cm,water_level,created_at)
    VALUES('${owner}','${tank}','HOT_WARNING','LOW_ACIDIC','SLIGHTLY_CLOUDY','SAFE_IDEAL',30.02,6.37,2.184,4.02,4.02,'2026-10-10')`);
  const titles = (await db.query('SELECT title FROM alerts')).rows.map(row => row.title);
  for (const title of ['High temperature warning', 'Low pH warning', 'Water slightly cloudy']) assert.ok(titles.includes(title));
});

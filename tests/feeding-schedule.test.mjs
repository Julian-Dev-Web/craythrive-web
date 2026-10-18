import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_FEEDING_SCHEDULE as defaults, feedingTimeLabel, feedingTimeInput, parseFeedingTime, nextFeedingSchedule, normalizeFeedingSchedule, validFeedingSchedule } from '../supabase/functions/_shared/feedingSchedule.js';
import { loadFeedingSchedule, saveFeedingSchedule } from '../src/services/feedingScheduleService.js';

const migration = fs.readFileSync('supabase/migrations/20261018100000_tank_feeding_schedule.sql', 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const tank = '33333333-3333-4333-8333-333333333333';
const tankB = '44444444-4444-4444-8444-444444444444';
async function fixture(existingFields = false, invalidValues = false) {
  const pg = new PGlite();
  await pg.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('qa.actor',true),'')::uuid $$;
    CREATE TABLE tanks(id uuid PRIMARY KEY,user_id uuid,actuator_device_uid text);
    CREATE TABLE iot_devices(device_uid text,user_id uuid,tank_id uuid,device_type text,is_claimed boolean);
    CREATE TABLE tank_automation_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,tank_id uuid,device_uid text,
      auto_water_enabled boolean DEFAULT true,auto_ph_enabled boolean DEFAULT false,drain_seconds integer DEFAULT 2,
      auto_water_level_enabled boolean DEFAULT true,auto_water_quality_enabled boolean DEFAULT true,require_stable_readings boolean DEFAULT true);
    INSERT INTO tanks VALUES('${tank}','${owner}',null),('${tankB}','${other}',null);
    INSERT INTO iot_devices VALUES('actuator-a','${owner}','${tank}','actuator_hub',true);
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT,UPDATE ON tanks TO authenticated;
    GRANT SELECT ON iot_devices TO authenticated; GRANT SELECT,INSERT,UPDATE ON tank_automation_settings TO authenticated;
    ALTER TABLE tank_automation_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY owner_only ON tank_automation_settings TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    SELECT set_config('qa.actor','${owner}',false);`);
  if (existingFields) await pg.exec(`ALTER TABLE tank_automation_settings ADD auto_feeding_enabled boolean DEFAULT true,ADD auto_feed_hour integer DEFAULT 19,ADD auto_feed_minute integer DEFAULT 0,ADD auto_feed_cycles integer DEFAULT 2;`);
  if (invalidValues) {
    await pg.exec(`INSERT INTO tank_automation_settings(user_id,tank_id,auto_feed_cycles,auto_water_enabled) VALUES('${owner}','${tank}',4,false);`);
    await assert.rejects(pg.exec(migration), /Review invalid existing feeding settings/);
    await pg.exec('ROLLBACK');
    assert.deepEqual((await pg.query('SELECT auto_feed_cycles,auto_water_enabled FROM tank_automation_settings')).rows, [{ auto_feed_cycles: 4, auto_water_enabled: false }]);
    return pg;
  }
  await pg.exec(migration);
  return pg;
}

test('schedule defaults, strict validation, every-minute input and Manila labels are independent of local timezone', () => {
  assert.equal(validFeedingSchedule(defaults), true);
  assert.equal(feedingTimeLabel(defaults), '7:00 PM');
  for (const [time, label] of [['00:00','12:00 AM'], ['06:30','6:30 AM'], ['19:30','7:30 PM'], ['20:30','8:30 PM'], ['21:15','9:15 PM'], ['23:58','11:58 PM']]) {
    const value = { ...defaults, ...parseFeedingTime(time) };
    assert.equal(feedingTimeInput(value), time); assert.equal(feedingTimeLabel(value), label);
  }
  for (const patch of [{ auto_feeding_enabled: 1 }, { auto_feed_hour: 24 }, { auto_feed_minute: -1 }, { auto_feed_cycles: 4 }, { auto_feed_cycles: null }, { auto_feed_cycles: '2' }, { auto_feed_hour: 2.5 }]) assert.equal(validFeedingSchedule({ ...defaults, ...patch }), false);
  assert.deepEqual(parseFeedingTime('24:60'), { auto_feed_hour: null, auto_feed_minute: null });
  assert.deepEqual(parseFeedingTime(''), { auto_feed_hour: null, auto_feed_minute: null });
  assert.deepEqual(normalizeFeedingSchedule({}), defaults);
});

test('nominal next time uses trusted Manila day boundaries and never fabricates execution', () => {
  assert.equal(nextFeedingSchedule(defaults, '2026-10-18T10:00:00Z'), '2026-10-18T11:00:00.000Z');
  assert.equal(nextFeedingSchedule(defaults, '2026-10-18T12:00:00Z'), '2026-10-19T11:00:00.000Z');
  assert.equal(nextFeedingSchedule(defaults, '2026-10-18T10:00:00Z', true), '2026-10-19T11:00:00.000Z');
  assert.equal(nextFeedingSchedule({ ...defaults, auto_feed_hour: 23, auto_feed_minute: 58 }, '2026-10-18T16:01:00Z'), '2026-10-19T15:58:00.000Z');
  assert.equal(nextFeedingSchedule(defaults, null), null);
  assert.equal(nextFeedingSchedule({ ...defaults, auto_feeding_enabled: false }, '2026-10-18T10:00:00Z'), null);
});

test('migration reuses existing fields, reads without insertion, saves one tank and preserves water values without a tank unique constraint', async () => {
  const pg = await fixture(true);
  try {
    await pg.exec('SET ROLE authenticated');
    const before = (await pg.query(`SELECT get_tank_feeding_schedule('${tank}') AS value`)).rows[0].value;
    assert.equal(before.exists, false); assert.equal(before.can_save, true);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM tank_automation_settings')).rows[0].n, 0);
    await pg.query(`SELECT save_tank_feeding_schedule('${tank}',true,20,30,3)`);
    await pg.exec(`UPDATE tank_automation_settings SET auto_water_enabled=false,drain_seconds=9,auto_ph_enabled=true WHERE tank_id='${tank}'`);
    const waterBefore = (await pg.query('SELECT auto_water_enabled,auto_ph_enabled,drain_seconds,auto_water_level_enabled,auto_water_quality_enabled,require_stable_readings FROM tank_automation_settings')).rows;
    await pg.query(`SELECT save_tank_feeding_schedule('${tank}',false,20,30,3)`);
    const saved = (await pg.query(`SELECT get_tank_feeding_schedule('${tank}') AS value`)).rows[0].value;
    assert.deepEqual(saved.settings, { auto_feeding_enabled: false, auto_feed_hour: 20, auto_feed_minute: 30, auto_feed_cycles: 3 });
    assert.deepEqual((await pg.query('SELECT auto_water_enabled,auto_ph_enabled,drain_seconds,auto_water_level_enabled,auto_water_quality_enabled,require_stable_readings FROM tank_automation_settings')).rows, waterBefore);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM tank_automation_settings')).rows[0].n, 1);
    await assert.rejects(pg.query(`SELECT get_tank_feeding_schedule('${tankB}')`), /ownership/);
    await assert.rejects(pg.query(`SELECT save_tank_feeding_schedule('${tankB}',true,19,0,2)`), /ownership/);
    for (const args of ['true,24,0,2', 'true,19,60,2', 'true,19,0,0', 'null,19,0,2']) await assert.rejects(pg.query(`SELECT save_tank_feeding_schedule('${tank}',${args})`), /Invalid/);
    await pg.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(pg.query(`SELECT get_tank_feeding_schedule('${tank}')`), /permission denied/);
  } finally { await pg.close(); }
});

test('migration adds missing fields safely and rejects duplicate settings and unpaired creation', async () => {
  const pg = await fixture();
  try {
    await pg.exec(`INSERT INTO tank_automation_settings(user_id,tank_id) VALUES('${owner}','${tank}'),('${owner}','${tank}'); SET ROLE authenticated;`);
    await assert.rejects(pg.query(`SELECT get_tank_feeding_schedule('${tank}')`), /Ambiguous/);
    await assert.rejects(pg.query(`SELECT save_tank_feeding_schedule('${tank}',true,19,0,2)`), /Ambiguous/);
    await pg.exec(`RESET ROLE; DELETE FROM tank_automation_settings; DELETE FROM iot_devices; SET ROLE authenticated;`);
    await assert.rejects(pg.query(`SELECT save_tank_feeding_schedule('${tank}',true,19,0,2)`), /Pair an actuator/);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM tank_automation_settings')).rows[0].n, 0);
  } finally { await pg.close(); }
});

test('invalid existing feeding rows stop the migration without rewriting feeding or water values', async () => {
  const pg = await fixture(true, true);
  await pg.close();
});

test('service uses only scoped RPC arguments, validates saves and rejects cross-tank responses', async () => {
  const calls = [];
  const fake = { rpc: async (name,args) => { calls.push({ name,args }); return { data: { tank_id: tank, exists: name.startsWith('save'), can_save: true, settings: name.startsWith('save') ? defaults : null } }; } };
  assert.deepEqual((await loadFeedingSchedule(fake, tank)).settings, defaults);
  assert.equal(calls.length, 1);
  await saveFeedingSchedule(fake, tank, defaults);
  assert.deepEqual(calls[1].args, { p_tank_id: tank, p_enabled: true, p_hour: 19, p_minute: 0, p_cycles: 2 });
  await assert.rejects(saveFeedingSchedule(fake, tank, { ...defaults, auto_feed_cycles: 4 }), /Invalid/);
  await assert.rejects(loadFeedingSchedule(fake, tankB), /Unverified/);
  assert.equal(calls.some(call => /device_commands/.test(call.name)), false);
});

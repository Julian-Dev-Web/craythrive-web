import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFeedingSchedule, saveFeedingSchedule } from '../src/services/feedingScheduleService.js';
import { DEFAULT_FEEDING_SCHEDULE as defaults } from '../supabase/functions/_shared/feedingSchedule.js';

const tankId = '33333333-3333-4333-8333-333333333333';
const userId = '11111111-1111-4111-8111-111111111111';
const settings = { id: 'settings-a', tank_id: tankId, user_id: userId, device_uid: 'actuator-a',
  ...defaults, auto_water_enabled: false, drain_seconds: 7, require_stable_readings: true };
function fixture({ exists = true, paired = true } = {}) {
  const state = { calls: [], authenticated: true, data: {
    tanks: [{ id: tankId, user_id: userId }], tank_automation_settings: exists ? [structuredClone(settings)] : [],
    iot_devices: paired ? [{ user_id: userId, tank_id: tankId, device_uid: 'actuator-a', device_type: 'actuator_hub', is_claimed: true }] : [],
  } };
  const client = { auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: userId } : null } }) },
    from(table) {
      const call = { table, operation: 'read', filters: [] }; state.calls.push(call);
      let signal;
      const run = async singular => {
        if (signal?.aborted) throw new Error('Request aborted');
        if (state.foreignResponse && table === 'tank_automation_settings' && call.operation === 'read') return { data: { ...settings, tank_id: 'another-tank' } };
        if (state.denied && call.operation !== 'read') return { error: { code: '42501' } };
        const matching = () => state.data[table].filter(row => call.filters.every(([key, value]) => row[key] === value));
        let rows = matching();
        if (call.operation === 'update') {
          state.beforeUpdate?.();
          rows = matching();
          rows.forEach(row => Object.assign(row, call.body));
        } else if (call.operation === 'insert') {
          if (state.concurrentCreate) {
            state.concurrentCreate = false;
            state.data[table].push({ ...settings, device_uid: 'existing-device', drain_seconds: 11 });
            return { error: { code: '23505' } };
          }
          if (state.data[table].some(row => row.tank_id === call.body.tank_id)) return { error: { code: '23505' } };
          rows = [{ id: 'created', ...call.body }]; state.data[table].push(rows[0]);
        }
        if (singular && rows.length !== 1) return rows.length === 0 && singular === 'maybe' ? { data: null } : { error: { code: 'PGRST116' } };
        return { data: structuredClone(singular ? rows[0] : rows) };
      };
      const query = {
        select: () => query, eq: (key, value) => { call.filters.push([key, value]); return query; },
        abortSignal: value => { signal = value; return query; },
        update: body => { call.operation = 'update'; call.body = structuredClone(body); return query; },
        insert: body => { call.operation = 'insert'; call.body = structuredClone(body); return query; },
        maybeSingle: () => run('maybe'), single: () => run('single'),
        then: (resolve, reject) => run(false).then(resolve, reject),
      };
      return query;
    } };
  return { state, client };
}

test('direct table service loads without writes and patches only the four feed fields under owner/tank filters', async () => {
  const { client, state } = fixture();
  assert.deepEqual((await loadFeedingSchedule(client, tankId)).settings, defaults);
  assert.ok(state.calls.every(call => call.operation === 'read'));
  state.beforeUpdate = () => { state.data.tank_automation_settings[0].drain_seconds = 13; };
  const chosen = { ...defaults, auto_feed_hour: 21, auto_feed_minute: 15, auto_feed_cycles: 3 };
  await saveFeedingSchedule(client, tankId, { ...chosen, drain_seconds: 0, device_uid: 'stale-device' });
  const update = state.calls.find(call => call.operation === 'update');
  assert.deepEqual(update.body, chosen);
  assert.deepEqual(update.filters, [['user_id', userId], ['tank_id', tankId]]);
  assert.equal(state.data.tank_automation_settings[0].drain_seconds, 13);
  assert.equal(state.data.tank_automation_settings[0].auto_water_enabled, false);
  assert.equal(state.data.tank_automation_settings[0].device_uid, 'actuator-a');
  assert.ok(state.calls.every(call => ['tanks', 'iot_devices', 'tank_automation_settings'].includes(call.table)));
});

test('first save creates one settings row with owner, selected tank and available actuator; read never inserts defaults', async () => {
  const { client, state } = fixture({ exists: false });
  const loaded = await loadFeedingSchedule(client, tankId);
  assert.equal(loaded.exists, false); assert.deepEqual(loaded.settings, defaults);
  assert.equal(state.data.tank_automation_settings.length, 0);
  await saveFeedingSchedule(client, tankId, defaults);
  const insert = state.calls.find(call => call.operation === 'insert');
  assert.deepEqual(insert.body, { user_id: userId, tank_id: tankId, ...defaults, device_uid: 'actuator-a' });
  await saveFeedingSchedule(client, tankId, { ...defaults, auto_feeding_enabled: false });
  assert.equal(state.data.tank_automation_settings.length, 1);
});

test('an unpaired tank can configure a schedule without a fabricated device UID', async () => {
  const { client, state } = fixture({ exists: false, paired: false });
  await saveFeedingSchedule(client, tankId, defaults);
  assert.equal(Object.hasOwn(state.calls.find(call => call.operation === 'insert').body, 'device_uid'), false);
});

test('unique-tank insert races retry a narrow update without overwriting the winning row water/device fields', async () => {
  const { client, state } = fixture({ exists: false }); state.concurrentCreate = true;
  await saveFeedingSchedule(client, tankId, { ...defaults, auto_feed_hour: 8 });
  assert.equal(state.data.tank_automation_settings.length, 1);
  assert.equal(state.data.tank_automation_settings[0].drain_seconds, 11);
  assert.equal(state.data.tank_automation_settings[0].device_uid, 'existing-device');
  assert.equal(state.data.tank_automation_settings[0].auto_feed_hour, 8);
});

test('unauthenticated, foreign, invalid, denied and aborted requests never claim a successful save', async () => {
  const { client, state } = fixture();
  for (const patch of [{ auto_feed_hour: 24 }, { auto_feed_minute: -1 }, { auto_feed_cycles: 4 }]) {
    await assert.rejects(saveFeedingSchedule(client, tankId, { ...defaults, ...patch }), /Invalid/);
  }
  assert.equal(state.calls.length, 0);
  state.authenticated = false;
  await assert.rejects(loadFeedingSchedule(client, tankId), { code: '42501' });
  state.authenticated = true;
  await assert.rejects(saveFeedingSchedule(client, 'other-tank', defaults), { code: '42501' });
  state.foreignResponse = true;
  await assert.rejects(loadFeedingSchedule(client, tankId), { code: '42501' });
  state.foreignResponse = false; state.denied = true;
  await assert.rejects(saveFeedingSchedule(client, tankId, defaults), { code: '42501' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(saveFeedingSchedule(client, tankId, defaults, controller.signal), /aborted/);
  assert.deepEqual(state.data.tank_automation_settings, [settings]);
});

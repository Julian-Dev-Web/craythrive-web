import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { buildSensorRecommendations, LIVE_RECOMMENDATION_MAX_AGE_MS } from '../supabase/functions/_shared/sensorRecommendations.js';
import { thresholdBundle } from '../supabase/functions/_shared/thresholdResolution.js';

const server = await createServer({ server: { middlewareMode: true, hmr: false }, define: {
  'import.meta.env.VITE_SUPABASE_URL': 'undefined', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
  'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
} });
after(() => server.close());
const { loadTankRecommendationContext, recommendationInputs, explainSensorRecommendations } = await server.ssrLoadModule('/src/services/sensorRecommendationService.js');
const { buildMonitoringRecords, getCurrentTankSnapshot } = await server.ssrLoadModule('/src/utils/monitoringRecords.js');
const date = '2026-10-11T02:00:00Z';
const now = new Date(date).getTime();
const tank = { id: 'a', user_id: 'owner', name: 'Tank A' };
const water = { tank_id: 'a', user_id: 'owner', created_at: date,
  temperature_c: 26.3, ph_value: 7.2, turbidity_voltage: 2.8, water_depth_cm: 5 };
function context(overrides = {}, limits = {}, scan = 0.1) {
  const thresholds = thresholdBundle([{ user_id: 'owner', tank_id: 'a', thresholds: limits }]);
  const records = buildMonitoringRecords([{ ...water, ...overrides }],
    scan === null ? [] : [{ tank_id: 'a', user_id: 'owner', created_at: date, ammonia_mg_l: scan }], [tank], thresholds);
  return { tank, records, thresholds, snapshot: getCurrentTankSnapshot(records, tank, thresholds) };
}
const generate = ctx => buildSensorRecommendations(recommendationInputs(ctx, now));

test('all five recommendations preserve tank, reading, units, effective limits and Philippine observation time', () => {
  const ctx = context({}, { temperatureMin: 22, temperatureMax: 29, phMin: 6.8, phMax: 8.1,
    waterLevelMin: 3.75, turbidityMax: 2.7, ammoniaMax: 0.42 });
  const before = JSON.stringify(ctx);
  const items = generate(ctx);
  assert.equal(items.length, 5);
  for (const item of items) {
    assert.equal(item.tankName, 'Tank A');
    assert.equal(item.tankId, 'a');
    assert.ok(item.latestValue && item.safeRange && item.reason && item.action && item.status);
    assert.match(item.timestampLabel, /10:00 AM/);
    assert.equal(item.timestamp, date);
  }
  assert.equal(items.find(r => r.parameter === 'waterLevel').safeRange, 'Safe Limit: ≥ 3.75 cm');
  assert.equal(items.find(r => r.parameter === 'temperature').safeRange, 'Safe Range: 22–29 °C');
  assert.equal(items.find(r => r.parameter === 'ammonia').unit, 'mg/L');
  assert.equal(JSON.stringify(ctx), before);
});

test('uses existing evaluated severity, ordered Critical then Warning then unavailable then Normal', () => {
  const items = generate(context({ temperature_c: 30.1, ph_value: 6.4, ph_status: 'LOW_ACIDIC' }));
  assert.deepEqual(items.map(item => item.severity), ['critical', 'warning', 'no-data', 'normal', 'normal']);
  assert.match(items[0].reason, /above the configured maximum \(30 °C\)/);
  assert.match(items[0].action, /^Check this tank now/);
  assert.match(items[1].reason, /below the configured minimum \(6.5\)/);
});

test('water rounding matches evaluation and device critical reports do not invent an upper limit', () => {
  const rounded = generate(context({ water_depth_cm: 3.99 }, { waterLevelMin: 4 })).find(r => r.parameter === 'waterLevel');
  assert.equal(rounded.severity, 'normal');
  assert.match(rounded.reason, /within the configured limits/);
  const device = generate(context({ water_depth_cm: 6, water_status: 'CRITICAL_HIGH' })).find(r => r.parameter === 'waterLevel');
  assert.equal(device.severity, 'critical');
  assert.match(device.reason, /monitoring device reports/i);
  assert.match(device.reason, /No matching numeric critical boundary/);
  assert.equal(device.safeRange, 'Safe Limit: ≥ 4.5 cm');
});

test('threshold changes alter only the supplied tank recommendation without modifying readings', () => {
  const a = context({ water_depth_cm: 4 }, { waterLevelMin: 4.5 });
  const b = context({ water_depth_cm: 4 }, { waterLevelMin: 3 });
  assert.equal(generate(a).find(r => r.parameter === 'waterLevel').severity, 'warning');
  assert.equal(generate(b).find(r => r.parameter === 'waterLevel').severity, 'normal');
  assert.equal(a.snapshot.waterRecord.reading.water_depth_cm, 4);
});

test('old, carried, unknown and future observations cannot receive Normal recommendations', () => {
  for (const overrides of [ { created_at: '2025-01-01T00:00:00Z' }, { created_at: null },
    { created_at: '2026-10-12T02:00:00Z' } ]) {
    assert.ok(generate(context(overrides)).every(item => item.severity === 'no-data'));
  }
  const ctx = context({ water_status: 'SAFE_IDEAL', raw_payload: { water_value_source: 'last_good', water_measurement_fresh: false } });
  const carried = generate(ctx).find(r => r.parameter === 'waterLevel');
  assert.equal(carried.status, 'Stale');
  assert.equal(carried.severity, 'no-data');
  assert.match(carried.action, /fresh measurement/);
  assert.ok(buildSensorRecommendations(recommendationInputs(context(), null)).every(item => item.severity === 'no-data'));
});

test('invalid readings, explicit sensor errors and unavailable thresholds are neutral', () => {
  const inputs = recommendationInputs(context(), now);
  inputs.readings.ph.value = 15;
  inputs.readings.turbidity.value = -1;
  inputs.readings.waterLevel.value = null;
  inputs.readings.temperature.status = 'SENSOR_ERROR';
  assert.ok(buildSensorRecommendations(inputs).every(item => item.severity === 'no-data'));
  inputs.thresholds = null;
  assert.ok(buildSensorRecommendations(inputs).every(item => item.safeRange === 'Safe limits unavailable' && /could not be verified/.test(item.reason)));
});

test('ammonia stays a dated manual result without an invented scan-age policy; valid zero is retained', () => {
  const inputs = recommendationInputs(context({}, {}, 0), now);
  const item = buildSensorRecommendations(inputs).find(r => r.parameter === 'ammonia');
  assert.equal(item.latestValue, '0.00 mg/L');
  assert.equal(item.severity, 'no-data');
  assert.equal(item.recordedSeverity, 'normal');
  assert.match(item.reason, /No scan-validity period is configured/);
  assert.equal(item.measurementType, 'manual_scan');
  // Explicit caller-provided policy is supported without becoming a default.
  const configured = buildSensorRecommendations({ ...inputs, ammoniaMaxAgeMs: 3600000 }).find(r => r.parameter === 'ammonia');
  assert.equal(configured.severity, 'normal');
  inputs.readings.ammonia.timestamp = '2025-01-01T00:00:00Z';
  assert.equal(buildSensorRecommendations({ ...inputs, ammoniaMaxAgeMs: 3600000 }).find(r => r.parameter === 'ammonia').status, 'Stale');
  assert.equal(generate(context({}, {}, null)).find(r => r.parameter === 'ammonia').value, null);
});

test('recommendations expire using the existing five-minute Web freshness policy', () => {
  const ctx = context();
  const atLimit = buildSensorRecommendations(recommendationInputs(ctx, now + LIVE_RECOMMENDATION_MAX_AGE_MS));
  const expired = buildSensorRecommendations(recommendationInputs(ctx, now + LIVE_RECOMMENDATION_MAX_AGE_MS + 1));
  assert.equal(atLimit.find(r => r.parameter === 'temperature').severity, 'normal');
  assert.equal(expired.find(r => r.parameter === 'temperature').status, 'Stale');
});

function clientMock(options = {}) {
  const calls = [];
  const client = {
    calls,
    auth: { async getUser() { return { data: { user: options.signedOut ? null : { id: 'owner' } } }; } },
    async rpc(name) {
      calls.push({ rpc: name });
      return options.thresholdFailure ? { error: { code: '42501' } } : { data: [{ user_id: 'owner', thresholds: {} }] };
    },
    from(table) {
      const filters = [];
      calls.push({ table, filters });
      return {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
        order() { return this; },
        async maybeSingle() { return { data: options.foreignTank ? { ...tank, user_id: 'other' } : tank }; },
        async limit() { return options.readFailure ? { error: { message: 'private error must not surface' } }
          : { data: table === 'sensor_readings' ? [{ ...water, ...(options.foreignReading ? { tank_id: 'b' } : {}) }] : [] }; },
      };
    },
    functions: { async invoke(name, request) {
      calls.push({ function: name, body: request.body });
      if (options.rejection) throw new Error('private provider detail');
      return options.aiResponse || { data: { message: 'Verify the measurement.', severity: 'normal', action_type: 'suggest_fill', threshold_suggestion: { waterLevelMin: 99 } } };
    } },
  };
  return client;
}

test('evidence loading verifies owner, scopes both readings, and never calls an action writer', async () => {
  const client = clientMock();
  const result = await loadTankRecommendationContext(client, 'a');
  assert.equal(result.snapshot.tankName, 'Tank A');
  for (const table of ['sensor_readings', 'ammonia_readings']) {
    assert.deepEqual(client.calls.find(call => call.table === table).filters, [['tank_id', 'a'], ['user_id', 'owner']]);
  }
  assert.deepEqual(client.calls.filter(call => call.rpc).map(call => call.rpc), ['get_tank_threshold_settings']);
  await assert.rejects(loadTankRecommendationContext(clientMock({ signedOut: true }), 'a'), /Sign in again/);
  await assert.rejects(loadTankRecommendationContext(clientMock({ foreignTank: true }), 'a'), /could not be verified/);
  for (const option of ['foreignReading', 'readFailure', 'thresholdFailure']) {
    await assert.rejects(loadTankRecommendationContext(clientMock({ [option]: true }), 'a'), /could not be verified/);
  }
});

test('optional AI uses the existing Edge contract and returns only text, never action or severity objects', async () => {
  const ctx = context();
  const recs = generate(ctx);
  const before = JSON.stringify({ ctx, recs });
  const client = clientMock();
  assert.equal(await explainSensorRecommendations(client, ctx, recs), 'Verify the measurement.');
  const request = client.calls[0];
  assert.equal(request.function, 'craythrive-ai-guide');
  assert.equal(request.body.context.tank.id, 'a');
  assert.deepEqual(request.body.context.rule_based_result.recommendations, recs);
  assert.equal(request.body.context.capabilities.automatic_actions, false);
  assert.equal(JSON.stringify({ ctx, recs }), before);
  await assert.rejects(explainSensorRecommendations(clientMock({ aiResponse: { error: { context: { status: 429 } } } }), ctx, recs), /Please wait/);
  await assert.rejects(explainSensorRecommendations(clientMock({ aiResponse: { error: { context: { status: 403 } } } }), ctx, recs), /verify access/);
  await assert.rejects(explainSensorRecommendations(clientMock({ aiResponse: { data: {} } }), ctx, recs), /no explanation/);
  await assert.rejects(explainSensorRecommendations(clientMock({ rejection: true }), ctx, recs), /AI Guide is unavailable/);
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { sensorValues, compareSensorRowsNewestFirst, currentSensorSafety, sensorObservationHealth,
  sensorRowBelongsToTank, LIVE_SENSOR_MAX_AGE_MS } from '../supabase/functions/_shared/sensorReadingContract.js';

const server = await createServer({ server: { middlewareMode: true, hmr: false }, define: {
  'import.meta.env.VITE_SUPABASE_URL': 'undefined', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
  'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
} });
after(() => server.close());
const { loadCurrentTankRows, readLatestTankObservation, loadSensorHistory } = await server.ssrLoadModule('/src/services/tankSnapshotService.js');
const { normalizeSensorReading } = await server.ssrLoadModule('/src/utils/sensorReadingUtils.js');
const { buildMonitoringRecords, getCurrentTankSnapshot } = await server.ssrLoadModule('/src/utils/monitoringRecords.js');
const { getSafetySeverity } = await server.ssrLoadModule('/src/utils/statusHelpers.js');
const { thresholdBundle } = await server.ssrLoadModule('/src/services/tankThresholdService.js');
const tank = { id: 'a', user_id: 'owner', device_uid: 'reused-device' };
const row = { id: 'b', tank_id: 'a', user_id: 'owner', device_uid: 'original-device',
  created_at: '2026-10-11T02:00:00.000001Z', temperature_c: 26.3, ph_value: 7.2, turbidity_voltage: 2.8, water_depth_cm: 5 };
const now = Date.parse(row.created_at) + 1000;

function clientFor(data, error = null) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, filters: {}, order: [] }; calls.push(call);
    const query = { select() { return query; }, eq(k, v) { call.filters[k] = v; return query; },
      order(k, v) { call.order.push([k, v]); return query; }, limit(n) { call.limit = n; return query; },
      range(a, b) { call.range = [a, b]; return query; },
      then(resolve, reject) { return Promise.resolve({ data, error }).then(resolve, reject); } };
    return query;
  } };
}

test('canonical calibrated values win; ADC, voltage pH, inches and distance never masquerade as engineering units', () => {
  assert.deepEqual(sensorValues({ ...row, ph: 4, ph_voltage: 1, raw_ph_value: 2000,
    turbidity: 1, raw_turbidity_value: 3000, water_level: 1, water_distance_cm: 20, water_depth_in: 9 }),
  { temperature: 26.3, ph: 7.2, turbidityVoltage: 2.8, waterDepth: 5 });
  assert.deepEqual(sensorValues({ ph_voltage: 3, raw_ph_value: 2000, raw_turbidity_value: 3000,
    water_distance_cm: 10, water_depth_in: 5 }), { temperature: null, ph: null, turbidityVoltage: null, waterDepth: null });
  assert.equal(sensorValues({ ph_value: 15, turbidity_voltage: -1, water_depth_cm: -1 }).ph, null);
  assert.equal(sensorValues({ temperature_c: 0, ph_value: 0, turbidity_voltage: 0, water_depth_cm: 0 }).waterDepth, 0);
});

test('created_at microseconds then unique ID provide deterministic ordering; metadata edits never move a reading', () => {
  const rows = [{ ...row, id: 'z', created_at: '2026-10-11T02:00:00.000001Z' },
    { ...row, id: 'b', created_at: '2026-10-11T02:00:00.000002Z' },
    { ...row, id: 'a', created_at: '2026-10-11T02:00:00.000002Z' },
    { ...row, id: 'undated', created_at: null, updated_at: '2027-01-01T00:00:00Z' }];
  assert.deepEqual(rows.sort(compareSensorRowsNewestFirst).map(r => r.id), ['b', 'a', 'z', 'undated']);
});

test('current snapshot selects one complete latest row, preserving holes instead of mixing old values/timestamps', () => {
  const records = buildMonitoringRecords([row, { ...row, id: 'new', ph_value: null,
    created_at: '2026-10-11T02:00:01Z' }], [], [tank]);
  const snapshot = getCurrentTankSnapshot(records, tank);
  assert.equal(snapshot.waterRecord.reading.id, 'new');
  assert.equal(snapshot.waterRecord.normalized.phValue, null);
  assert.equal(snapshot.waterRecord.date, '2026-10-11T02:00:01Z');
});

test('explicit observation ownership and tank binding survive device replacement without reassignment', () => {
  assert.equal(sensorRowBelongsToTank(row, tank), true);
  for (const other of [{ ...row, tank_id: 'b', device_uid: tank.device_uid },
    { ...row, tank_id: null, device_uid: tank.device_uid }, { ...row, user_id: 'other' }]) {
    assert.equal(sensorRowBelongsToTank(other, tank), false);
    assert.equal(getCurrentTankSnapshot(buildMonitoringRecords([other], [], [tank]), tank).waterRecord, null);
  }
});

test('latest and history queries use owner/tank plus created_at/id ordering, including null timestamp placement', async () => {
  const client = clientFor([row]);
  await readLatestTankObservation(client, 'sensor_readings', tank, 'owner');
  await loadSensorHistory({ id: 'owner' }, { tankId: 'a', limit: 10 }, client);
  for (const call of client.calls) {
    assert.deepEqual(call.filters, { tank_id: 'a', user_id: 'owner' });
    assert.deepEqual(call.order, [['created_at', { ascending: false, nullsFirst: false }], ['id', { ascending: false }]]);
  }
  assert.equal(client.calls[0].limit, 1);
  assert.deepEqual(client.calls[1].range, [0, 9]);
});

test('failed current queries never substitute stale cached/history rows; foreign results are rejected', async () => {
  const failed = await loadCurrentTankRows([tank], { id: 'owner' }, { sensor: [row], ammonia: [row] }, clientFor(null, { code: 'offline' }));
  assert.deepEqual(failed.sensor, []); assert.deepEqual(failed.ammonia, []); assert.equal(failed.errors.length, 2);
  await assert.rejects(readLatestTankObservation(clientFor([{ ...row, tank_id: 'b' }]), 'sensor_readings', tank, 'owner'));
});

test('fresh current cards reuse evaluation; stale/future/unknown times cannot show Normal and do not rewrite history', () => {
  const normalized = normalizeSensorReading(row);
  const before = JSON.stringify(normalized.safety);
  assert.equal(getSafetySeverity(currentSensorSafety(normalized.safety, row, now)), 'normal');
  for (const [reading, clock] of [[row, now + LIVE_SENSOR_MAX_AGE_MS], [row, null],
    [{ ...row, created_at: null, updated_at: row.created_at }, now], [{ ...row, created_at: '2027-01-01T00:00:00Z' }, now]]) {
    const current = currentSensorSafety(normalized.safety, reading, clock);
    assert.equal(getSafetySeverity(current), 'no-data');
    assert.ok(Object.values(current.parameters).every(p => p.severity === 'no-data'));
    assert.equal(current.parameters.waterLevel.measurementFresh, false);
  }
  assert.equal(JSON.stringify(normalized.safety), before);
  assert.equal(sensorObservationHealth(row, Date.parse(row.created_at) + LIVE_SENSOR_MAX_AGE_MS), 'fresh');
});

test('missing or error parameters stay neutral and old ammonia remains a separate dated manual result', () => {
  const records = buildMonitoringRecords([{ ...row, ph_value: null, temperature_status: 'SENSOR_ERROR' }],
    [{ id: 'scan', user_id: 'owner', tank_id: 'a', ammonia_level: 0.7, created_at: '2025-01-01T00:00:00Z' }], [tank]);
  const current = getCurrentTankSnapshot(records, tank, undefined, { nowMs: now, verified: true });
  assert.equal(current.safety.parameters.ph.severity, 'no-data');
  assert.equal(current.safety.parameters.temperature.severity, 'no-data');
  assert.equal(current.safety.parameters.ammonia.severity, 'no-data');
  assert.equal(current.safety.parameters.ammonia.recordedSeverity, 'critical');
  assert.equal(current.ammoniaRecord.ammoniaValue, 0.7);
  assert.equal(current.ammoniaRecord.date, '2025-01-01T00:00:00Z');
});

test('live threshold reevaluation stays tank-specific and uses the unchanged classifier', () => {
  const tanks = [tank, { ...tank, id: 'b' }];
  const thresholds = thresholdBundle([{ tank_id: null, thresholds: { waterLevelMin: 4.5 } },
    { tank_id: 'a', thresholds: { waterLevelMin: 6 } }]);
  const records = buildMonitoringRecords([row, { ...row, tank_id: 'b' }], [], tanks, thresholds);
  const levels = tanks.map(t => getCurrentTankSnapshot(records, t, thresholds, { nowMs: now, verified: true }).safety.parameters.waterLevel.severity);
  assert.deepEqual(levels, ['warning', 'normal']);
});

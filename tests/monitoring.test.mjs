import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { downloadCsv, printReport } from '../src/utils/exportPrintUtils.js';

// Load the real Vite modules, with Supabase disabled. No database requests.
const server = await createServer({ server: { middlewareMode: true }, define: {
  'import.meta.env.VITE_SUPABASE_URL': 'undefined',
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
  'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
} });
after(() => server.close());
const { normalizeSensorReading, toNumberOrNull } = await server.ssrLoadModule('/src/utils/sensorReadingUtils.js');
const { evaluateReadingSafety, normalizeThresholds, DEFAULT_THRESHOLDS } = await server.ssrLoadModule('/src/utils/thresholdEvaluation.js');
const { getSafetySeverity, getSafetyStatusLabel } = await server.ssrLoadModule('/src/utils/statusHelpers.js');
const { buildMonitoringRecords, buildTankHistoryExportRows, buildTankSnapshotExportRows, getCurrentTankSnapshot, getLatestAmmoniaForTank, evaluateCurrentTankSafety, recordMatchesMonitoringTank } = await server.ssrLoadModule('/src/utils/monitoringRecords.js');
const { buildMonitoringAIContext } = await server.ssrLoadModule('/src/utils/monitoringAIContext.js');
const { loadAmmoniaHistory, loadCurrentTankRows } = await server.ssrLoadModule('/src/services/tankSnapshotService.js');
const tanks = [{ id: 'tank-a', name: 'Tank A', device_uid: 'device-a' }, { id: 'tank-b', name: 'Tank B', device_uid: 'device-b' }];
const normal = { temperature_c: 26.3, ph_value: 7.2, turbidity_voltage: 2.8, water_depth_cm: 5 };

test('scan edits do not move scan history dates or override a newer scan', () => {
  const scans = [
    { id: 'old', tank_id: 'tank-a', ammonia: 0.7, created_at: '2025-01-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' },
    { id: 'new', tank_id: 'tank-a', ammonia: 0.1, created_at: '2025-02-01T00:00:00Z' },
    { id: 'undated', tank_id: 'tank-a', ammonia: 0.8, updated_at: '2026-10-06T00:00:00Z' },
  ];
  assert.equal(getLatestAmmoniaForTank(tanks[0], scans).id, 'new');
  const records = buildMonitoringRecords([], scans, tanks);
  assert.equal(records.find(r => r.reading.id === 'old').date, scans[0].created_at);
  assert.equal(records.find(r => r.reading.id === 'undated').date, null);
  assert.equal(recordMatchesMonitoringTank({ tank_id: 'unknown', device_uid: 'device-a' }, tanks[0]), false);
  assert.equal(getLatestAmmoniaForTank(tanks[0], [{ device_uid: 'device-a', ammonia: 9 }]), null);
  assert.equal(buildMonitoringRecords([], [{ device_uid: 'device-a', ammonia: 9 }], tanks)[0].tankName, 'Unmatched tank');
});

test('old critical scan contributes only to the current same-tank snapshot', () => {
  const water = [{ ...normal, id: 'water', tank_id: 'tank-a', ammonia: 99, created_at: '2026-10-05T00:00:00Z' }];
  const scans = [{ id: 'scan', tank_id: 'tank-a', ammonia: 0.7, ammonia_status: 'Normal', created_at: '2025-01-01T00:00:00Z' }];
  const before = JSON.stringify({ water, scans });
  const records = buildMonitoringRecords(water, scans, tanks);
  const snapshot = getCurrentTankSnapshot(records, tanks[0]);
  assert.equal(getSafetySeverity(snapshot.safety), 'critical');
  assert.equal(snapshot.waterRecord.status, 'normal');
  assert.equal(snapshot.waterRecord.ammoniaValue, null);
  const row = buildTankSnapshotExportRows([snapshot])[0];
  assert.equal(row['Sensor Date'], water[0].created_at);
  assert.equal(row['Ammonia Scan Date'], scans[0].created_at);
  assert.equal(row['Ammonia Condition'], 'Critical');
  assert.equal('Date' in row, false);
  const history = buildTankHistoryExportRows(records.filter(r => r.date.startsWith('2026')));
  assert.equal(history.length, 1);
  assert.equal(history[0].Ammonia, '');
  assert.equal(history[0]['Overall Condition'], 'Normal');
  assert.equal(JSON.stringify({ water, scans }), before);
});

test('missing scan is unknown while an actual zero scan is valid', () => {
  const water = [{ ...normal, tank_id: 'tank-a' }];
  for (const ammonia of [null, '', false, 'invalid']) {
    const snapshot = getCurrentTankSnapshot(buildMonitoringRecords(water, [{ tank_id: 'tank-a', ammonia }], tanks), tanks[0]);
    assert.equal(getSafetySeverity(snapshot.safety), 'normal');
    assert.equal(buildTankSnapshotExportRows([snapshot])[0]['Ammonia Condition'], 'No Scan');
  }
  const empty = getCurrentTankSnapshot([], tanks[0]);
  assert.equal(getSafetySeverity(empty.safety), 'no-data');
  const zero = getCurrentTankSnapshot(buildMonitoringRecords([], [{ tank_id: 'tank-a', ammonia: 0 }], tanks), tanks[0]);
  assert.equal(zero.ammoniaRecord.ammoniaValue, 0);
  assert.equal(buildTankSnapshotExportRows([zero])[0]['Ammonia Condition'], 'Normal');
});

test('latest per-tank fetch finds scans outside a bounded global history', async () => {
  const requests = [];
  const old = { id: 'quiet-scan', tank_id: 'tank-a', user_id: 'farmer', ammonia: 0.7, created_at: '2025-01-01T00:00:00Z' };
  const client = { from(table) {
    const filters = {};
    const query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; },
      order(key, options) { assert.equal(key, 'created_at'); assert.equal(options.ascending, false); return query; },
      async limit(value) { requests.push({ table, filters, limit: value }); return { data: table === 'ammonia_readings' ? [old] : [], error: null }; } };
    return query;
  } };
  const rows = await loadCurrentTankRows([tanks[0]], { id: 'farmer', isAdmin: false }, { sensor: [], ammonia: [] }, client);
  assert.equal(rows.ammonia[0].id, old.id);
  assert.deepEqual(requests.map(r => r.table).sort(), ['ammonia_readings', 'sensor_readings']);
  for (const request of requests) { assert.deepEqual(request.filters, { tank_id: 'tank-a', user_id: 'farmer' }); assert.equal(request.limit, 1); }
});

test('AI context keeps independent measurements and histories separate', () => {
  const records = buildMonitoringRecords([{ ...normal, tank_id: 'tank-a', created_at: '2026-10-05T00:00:00Z' }],
    [{ tank_id: 'tank-a', ammonia: 0.7, created_at: '2025-01-01T00:00:00Z' }, { tank_id: 'tank-b', ammonia: 9, created_at: '2026-10-06T00:00:00Z' }], tanks);
  const context = buildMonitoringAIContext({ records, tank: tanks[0] });
  assert.equal(context.latest_ammonia.value, 0.7);
  assert.equal(context.latest_ammonia.timestamp, '2025-01-01T00:00:00Z');
  assert.equal(context.latest_ammonia.condition, 'Critical');
  assert.equal('ammonia' in context.latest_sensor, false);
  assert.equal(context.recent_sensor_readings.length, 1);
  assert.equal(context.recent_ammonia_scans.length, 1);
  assert.match(context.instructions, /Mention the ammonia scan timestamp/);
  assert.equal(buildMonitoringAIContext({ records, tank: tanks[0], thresholds: { ...DEFAULT_THRESHOLDS, ammoniaMax: 0.8 } }).latest_ammonia.condition, 'Normal');
  assert.equal(buildMonitoringAIContext({ records: [], tank: tanks[0] }).latest_ammonia, null);
});

test('manual scan history pages past an API row limit without repeating events', async () => {
  const scans = Array.from({ length: 1003 }, (_, id) => ({ id, tank_id: 'tank-a', ammonia: 0.1 }));
  const pages = [];
  const client = { from(table) {
    assert.equal(table, 'ammonia_readings');
    const query = { select() { return query; }, eq(key, value) { assert.equal(key, 'user_id'); assert.equal(value, 'farmer'); return query; },
      order(key) { assert.equal(key, 'created_at'); return query; },
      async range(start, end) { pages.push(start); return { data: scans.slice(start, end + 1), count: scans.length }; } };
    return query;
  } };
  const result = await loadAmmoniaHistory({ id: 'farmer' }, client);
  assert.equal(result.error, false);
  assert.deepEqual(pages, [0, 1000]);
  assert.equal(result.rows.length, 1003);
  assert.equal(new Set(result.rows.map(r => r.id)).size, 1003);
});

test('numeric field priority and valid legacy fallbacks', () => {
  const r = normalizeSensorReading({ ...normal, temperature: 99, ph: 4.8, water_level: 0.6, water_distance_cm: 88 });
  assert.equal(r.temperatureValue, 26.3);
  assert.equal(r.phValue, 7.2);
  assert.equal(r.waterValue, 5);
  assert.equal(normalizeSensorReading({ temperature_c: 'invalid', temperature: 25 }).temperatureValue, 25);
  assert.equal(normalizeSensorReading({ ph_value: 'invalid', ph: 7 }).phValue, 7);
  assert.equal(normalizeSensorReading({ water_depth_cm: 'invalid', water_level: 5 }).waterValue, 5);
  assert.equal(normalizeSensorReading({ water_distance_cm: 5 }).waterValue, null);
  assert.equal(normalizeSensorReading({ waterValue: 4.6 }).waterValue, 4.6);
});

test('missing and invalid readings remain neutral, never numeric zero', () => {
  for (const value of [null, undefined, '', ' ', 'invalid', Infinity, NaN, false, true, [], {}]) {
    assert.equal(toNumberOrNull(value), null, `invalid numeric input: ${String(value)}`);
    const r = normalizeSensorReading({ temperature_c: value, ph_value: value, water_depth_cm: value, turbidity_voltage: value });
    assert.equal(getSafetySeverity(r.safety), 'no-data');
  }
  assert.equal(toNumberOrNull(0), 0);
  assert.equal(getSafetySeverity(normalizeSensorReading(null).safety), 'no-data');
  assert.equal(normalizeSensorReading(null).safety.hasData, false);
});

test('current thresholds override stale raw statuses without altering raw readings', () => {
  const raw = { ...normal, water_depth_cm: 0.6, temperature_status: 'Critical', ph_status: 'Safe Ideal', water_status: 'Safe Ideal' };
  const before = JSON.stringify(raw);
  const r = normalizeSensorReading(raw, { ...DEFAULT_THRESHOLDS, waterLevelMin: 4.5 });
  assert.equal(r.waterValue, 0.6);
  assert.equal(r.safety.parameters.waterLevel.severity, 'critical');
  assert.equal(r.safety.parameters.temperature.severity, 'normal');
  assert.equal(getSafetySeverity(r.safety), 'critical');
  assert.equal(JSON.stringify(raw), before);
  assert.equal(normalizeSensorReading(raw, { ...DEFAULT_THRESHOLDS, waterLevelMin: 0.5 }).safety.parameters.waterLevel.severity, 'normal');
});

test('pH 4.8 is critical and configured temperature is normal', () => {
  const result = evaluateReadingSafety({ ph: 4.8, temperature: 26.3 }, DEFAULT_THRESHOLDS);
  assert.equal(result.parameters.ph.severity, 'critical');
  assert.equal(result.parameters.temperature.severity, 'normal');
  assert.equal(getSafetyStatusLabel(result.parameters.ph.severity), 'Critical');
});

test('threshold aliases and incomplete settings retain valid fallbacks', () => {
  const snake = { temperature_min: 21, temperature_max: 29, ph_min: 6, ph_max: 8, turbidity_max: 2.4, water_level_min: 5, ammonia_max: 0.2 };
  const expected = { temperatureMin: 21, temperatureMax: 29, phMin: 6, phMax: 8, turbidityMax: 2.4, waterLevelMin: 5, ammoniaMax: 0.2 };
  assert.deepEqual(normalizeThresholds(snake), expected);
  assert.deepEqual(normalizeThresholds({ thresholds: expected }), expected);
  assert.deepEqual(normalizeThresholds({ temperatureMin: '', phMin: false, waterLevelMin: null }), DEFAULT_THRESHOLDS);
});

test('only Normal Warning Critical are primary safety labels; missing data is neutral', () => {
  for (const [severity, label] of Object.entries({ safe: 'Normal', normal: 'Normal', warning: 'Warning', critical: 'Critical', danger: 'Critical', unsafe: 'Critical', neutral: 'No Data' })) {
    assert.equal(getSafetyStatusLabel(severity), label);
  }
  assert.equal(getSafetySeverity({ hasData: true, isSafe: false, issues: [], parameters: { ph: { severity: 'warning' } } }), 'warning');
});

test('ammonia stays matched to its tank, with an independent timestamp', () => {
  const water = [{ ...normal, id: 'w-a', tank_id: 'tank-a', created_at: '2026-10-04T10:00:00Z' }];
  const scans = [{ id: 'a-a', tank_id: 'tank-a', ammonia: 0.25, created_at: '2026-10-03T09:00:00Z' }, { id: 'a-b', tank_id: 'tank-b', device_uid: 'device-a', ammonia: 0.7, created_at: '2026-10-05T09:00:00Z' }];
  const records = buildMonitoringRecords(water, scans, tanks, DEFAULT_THRESHOLDS);
  assert.equal(getLatestAmmoniaForTank(tanks[0], scans).id, 'a-a');
  const wr = records.find(r => r.type === 'Water Reading');
  const ar = records.find(r => r.reading.id === 'a-a');
  assert.equal(wr.ammoniaValue, null);
  assert.equal(wr.normalized.safety.parameters.ammonia.hasValue, false);
  assert.equal(ar.date, scans[0].created_at);
  assert.equal(getSafetySeverity(evaluateCurrentTankSafety(wr, ar, DEFAULT_THRESHOLDS)), 'normal');
  assert.equal(getSafetySeverity(evaluateCurrentTankSafety(wr, records[0], DEFAULT_THRESHOLDS)), 'normal');
  assert.equal(evaluateReadingSafety({ ammonia: 0.26 }, DEFAULT_THRESHOLDS).parameters.ammonia.severity, 'critical');
  assert.equal(evaluateReadingSafety({ ammonia: null }, DEFAULT_THRESHOLDS).parameters.ammonia.hasValue, false);
});

test('tank CSV records keep ammonia separate and include all required columns', () => {
  const records = buildMonitoringRecords([{ ...normal, id: 'w', tank_id: 'tank-a', water_depth_cm: 0.6 }], [{ id: 'a', tank_id: 'tank-a', ammonia: 0.7, created_at: '2026-10-03T09:00:00Z' }], tanks);
  const rows = buildTankHistoryExportRows(records);
  const water = rows.find(r => r.Type === 'Water Reading');
  const ammonia = rows.find(r => r.Type === 'Ammonia Reading');
  assert.deepEqual(Object.keys(water), ['Type', 'Tank', 'Temperature', 'Temperature Condition', 'pH', 'pH Condition', 'Water Clarity', 'Water Clarity Condition', 'Water Level', 'Water Level Condition', 'Ammonia', 'Ammonia Condition', 'Overall Condition', 'Date']);
  assert.equal(water.Ammonia, '');
  assert.equal(water['Water Level Condition'], 'Critical');
  assert.equal(ammonia.Temperature, '');
  assert.equal(ammonia['Ammonia Condition'], 'Critical');
  assert.equal(ammonia.Date, '2026-10-03T09:00:00Z');
});

test('actual CSV generation preserves commas, quotes, and newlines safely', async () => {
  const oldDocument = globalThis.document;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  let blob;
  try {
    globalThis.document = { createElement: () => ({ click() {}, remove() {}, style: {}, setAttribute() {} }), body: { appendChild() {}, removeChild() {} } };
    URL.createObjectURL = value => { blob = value; return 'blob:qa'; };
    URL.revokeObjectURL = () => {};
    downloadCsv('qa.csv', [{ Tank: 'Tank, "A"\nSecond line', Value: 0.6 }]);
    assert.match(await blob.text(), /"Tank, ""A""\nSecond line",0.6/);
  } finally { globalThis.document = oldDocument; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; }
});

test('print preparation includes separate ammonia rows and escapes user content', () => {
  const previous = globalThis.window;
  let html = '';
  try {
    globalThis.window = { open: () => ({ document: { write: value => { html += value; }, close() {} } }) };
    const records = buildMonitoringRecords([{ ...normal, id: 'w', tank_id: 'tank-a', water_depth_cm: 0.6 }], [{ id: 'a', tank_id: 'tank-a', ammonia: 0.7 }], tanks);
    printReport({ title: 'QA <script>alert(1)</script>', sections: [
      { title: 'Tank Reports', rows: buildTankHistoryExportRows(records) },
      { title: 'Marketplace Reports', rows: [{ Title: '<img src=x onerror=alert(1)>', Status: 'Pending' }] },
    ] });
    assert.match(html, /Ammonia Scans/);
    assert.match(html, /0\.70 mg\/L/);
    assert.match(html, /condition critical/);
    assert.match(html, /Marketplace Reports/);
    assert.match(html, /Pending/);
    assert.match(html, /&lt;img/);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
  } finally { globalThis.window = previous; }
});

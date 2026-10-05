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
const { buildMonitoringRecords, buildTankHistoryExportRows, getLatestAmmoniaForTank, evaluateCurrentTankSafety } = await server.ssrLoadModule('/src/utils/monitoringRecords.js');
const tanks = [{ id: 'tank-a', name: 'Tank A', device_uid: 'device-a' }, { id: 'tank-b', name: 'Tank B', device_uid: 'device-b' }];
const normal = { temperature_c: 26.3, ph_value: 7.2, turbidity_voltage: 2.8, water_depth_cm: 5 };

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
    assert.match(html, /Ammonia Reading/);
    assert.match(html, /0\.70 mg\/L/);
    assert.match(html, /condition critical/);
    assert.match(html, /Marketplace Reports/);
    assert.match(html, /Pending/);
    assert.match(html, /&lt;img/);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
  } finally { globalThis.window = previous; }
});

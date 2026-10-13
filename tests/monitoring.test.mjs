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
const { evaluateReadingSafety, normalizeThresholds, DEFAULT_THRESHOLDS, resolveTankThresholds, getLocalThresholds } = await server.ssrLoadModule('/src/utils/thresholdEvaluation.js');
const { thresholdBundle, cacheThresholdBundle, readThresholdCache, thresholdChanges, suggestionPatch, applyTankThresholds } = await server.ssrLoadModule('/src/services/tankThresholdService.js');
const { getSafetySeverity, getSafetyStatusLabel, getParameterExplanation, getSafetyLabelSeverity } = await server.ssrLoadModule('/src/utils/statusHelpers.js');
const { getWaterReadingHealth } = await server.ssrLoadModule('/src/utils/waterReadingHealth.js');
const { buildMonitoringRecords, buildTankHistoryExportRows, buildTankSnapshotExportRows, getCurrentTankSnapshot, getLatestAmmoniaForTank, evaluateCurrentTankSafety, recordMatchesMonitoringTank } = await server.ssrLoadModule('/src/utils/monitoringRecords.js');
const { buildMonitoringAIContext } = await server.ssrLoadModule('/src/utils/monitoringAIContext.js');
const { loadAmmoniaHistory, loadCurrentTankRows } = await server.ssrLoadModule('/src/services/tankSnapshotService.js');
const tanks = [{ id: 'tank-a', name: 'Tank A', device_uid: 'device-a' }, { id: 'tank-b', name: 'Tank B', device_uid: 'device-b' }];
const normal = { temperature_c: 26.3, ph_value: 7.2, turbidity_voltage: 2.8, water_depth_cm: 5 };

test('selected tank without readings retains its own limits and neutral status', () => {
  const bundle = thresholdBundle([{ tank_id: null, thresholds: { waterLevelMin: 4.5 } },
    { tank_id: 'tank-b', thresholds: { waterLevelMin: 3.2, ammoniaMax: 0.4 } }]);
  const records = buildMonitoringRecords([{ ...normal, tank_id: 'tank-a' }], [], tanks, bundle);
  const snapshot = getCurrentTankSnapshot(records, tanks[1], bundle);
  assert.equal(snapshot.waterRecord, null);
  assert.equal(snapshot.ammoniaRecord, null);
  assert.equal(snapshot.safety.activeThresholds.waterLevelMin, 3.2);
  assert.equal(snapshot.safety.activeThresholds.ammoniaMax, 0.4);
  assert.equal(getSafetySeverity(snapshot.safety), 'no-data');
  assert.ok(Object.values(snapshot.safety.parameters).every(parameter => !parameter.hasValue));
});

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
      order(key, options) { assert.ok(['created_at', 'id'].includes(key)); assert.equal(options.ascending, false); return query; },
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
      order(key) { assert.ok(['created_at', 'id'].includes(key)); return query; },
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
  assert.equal(r.safety.parameters.waterLevel.severity, 'warning');
  assert.equal(r.safety.parameters.temperature.severity, 'normal');
  assert.equal(getSafetySeverity(r.safety), 'warning');
  assert.equal(JSON.stringify(raw), before);
  assert.equal(normalizeSensorReading(raw, { ...DEFAULT_THRESHOLDS, waterLevelMin: 0.5 }).safety.parameters.waterLevel.severity, 'normal');
});

test('pH 4.8 is critical and configured temperature is normal', () => {
  const result = evaluateReadingSafety({ ph: 4.8, temperature: 26.3 }, DEFAULT_THRESHOLDS);
  assert.equal(result.parameters.ph.severity, 'critical');
  assert.equal(result.parameters.temperature.severity, 'normal');
  assert.equal(getSafetyStatusLabel(result.parameters.ph.severity), 'Critical');
});

test('only valid firmware water codes provide the missing warning/critical tiers', () => {
  for (const [water_status, severity] of Object.entries({ SAFE_IDEAL: 'normal', LOW_WARNING: 'warning', HIGH_WARNING: 'warning', CRITICAL_LOW: 'critical', CRITICAL_HIGH: 'critical' })) {
    const raw = { ...normal, water_depth_cm: water_status === 'SAFE_IDEAL' ? 4.6 : 4, water_status };
    const before = JSON.stringify(raw);
    const reading = normalizeSensorReading(raw);
    const result = reading.safety;
    assert.equal(result.parameters.waterLevel.severity, severity);
    assert.equal(result.parameters.waterLevel.source, 'firmware');
    assert.equal(getSafetySeverity(result), severity);
    assert.equal(result.isSafe, severity === 'normal');
    assert.equal(result.issues.length, severity === 'normal' ? 0 : 1);
    assert.equal(getSafetyLabelSeverity([reading.waterStatus]), severity);
    assert.equal(JSON.stringify(raw), before);
    const withoutDepth = normalizeSensorReading({ water_status });
    assert.equal(withoutDepth.safety.parameters.waterLevel.severity, 'no-data');
  }
  for (const waterStatus of [undefined, '', 'Safe Ideal', 'SENSOR_ERROR', 'UNKNOWN', 'constructor', '__proto__']) {
    assert.equal(evaluateReadingSafety({ waterDepth: 0.6, waterStatus }).parameters.waterLevel.severity, 'warning');
  }
});

test('water display uses two decimals while comparison retains the original number', () => {
  const thresholds = { ...DEFAULT_THRESHOLDS, waterLevelMin: 4 };
  for (const rawValue of [3.96, 3.99, 4, 4.04]) {
    const reading = normalizeSensorReading({ water_depth_cm: rawValue }, thresholds);
    assert.equal(reading.waterValue, rawValue);
    assert.equal(reading.waterLabel, `${rawValue.toFixed(2)} cm`);
    assert.equal(reading.safety.parameters.waterLevel.severity, rawValue < 4 ? 'warning' : 'normal');
    assert.equal(reading.safety.issues.length, rawValue < 4 ? 1 : 0);
  }
  const low = normalizeSensorReading({ water_depth_cm: 3.94 }, thresholds);
  assert.equal(low.waterLabel, '3.94 cm');
  assert.equal(low.safety.parameters.waterLevel.severity, 'warning');
  assert.equal(low.safety.issues[0].message, '3.94 cm is below the active tank minimum (4.00 cm).');
  const firmware = normalizeSensorReading({ water_depth_cm: 3.99, water_status: 'LOW_WARNING' }, thresholds);
  assert.equal(firmware.waterLabel, '3.99 cm');
  assert.equal(firmware.safety.parameters.waterLevel.severity, 'warning');
  assert.doesNotMatch(firmware.safety.issues[0].message, /below.*minimum/);
  assert.match(getParameterExplanation(firmware.safety.parameters.waterLevel, 'Water Level'), /device reports a low water level/);
});

test('requested water boundary examples use supplied firmware tiers, never an invented critical cutoff', () => {
  // 4.5 is a real saved/default Web minimum. 3.4 is only the user's example
  // firmware boundary; it is not present in Web settings and is not inferred.
  for (const [depth, status, severity] of [
    [4.6, 'SAFE_IDEAL', 'normal'], [4.5, 'SAFE_IDEAL', 'normal'],
    [4.4, 'LOW_WARNING', 'warning'], [4, 'LOW_WARNING', 'warning'],
    [3.5, 'LOW_WARNING', 'warning'], [3.4, 'CRITICAL_LOW', 'critical'], [3.3, 'CRITICAL_LOW', 'critical'],
  ]) {
    assert.equal(evaluateReadingSafety({ waterDepth: depth, waterStatus: status }).parameters.waterLevel.severity, severity);
  }
  for (const minimum of [3.5, 4.5]) {
    for (const [depth, severity] of [[minimum + 0.1, 'normal'], [minimum, 'normal'], [minimum - 0.1, 'warning'], [0.6, 'warning']]) {
      assert.equal(evaluateReadingSafety({ waterDepth: depth }, { ...DEFAULT_THRESHOLDS, waterLevelMin: minimum }).parameters.waterLevel.severity, severity);
    }
  }
  assert.equal(evaluateReadingSafety({ waterDepth: 3.3 }).parameters.waterLevel.severity, 'warning');
});

test('known temperature pH and clarity firmware warnings are not flattened into Critical', () => {
  for (const [fields, key] of [
    [{ temperature: 18.27, temperatureStatus: 'COLD_WARNING' }, 'temperature'],
    [{ temperature: 30.02, temperatureStatus: 'HOT_WARNING' }, 'temperature'],
    [{ ph: 6.37, phStatus: 'LOW_ACIDIC' }, 'ph'],
    [{ ph: 8.97, phStatus: 'HIGH_ALKALINE_WARNING' }, 'ph'],
    [{ turbidityVoltage: 2.184, turbidityStatus: 'SLIGHTLY_CLOUDY' }, 'turbidity'],
    [{ turbidityVoltage: 1.556, turbidityStatus: 'DIRTY' }, 'turbidity'],
  ]) {
    const safety = evaluateReadingSafety(fields);
    assert.equal(safety.parameters[key].severity, 'warning');
    assert.equal(getSafetySeverity(safety), 'warning');
    assert.equal(safety.isSafe, false);
    assert.equal(safety.issues.length, 1);
  }
  for (const [fields, key] of [
    [{ temperature: 17.15, temperatureStatus: 'CRITICAL_COLD' }, 'temperature'],
    [{ ph: 5.97, phStatus: 'CRITICAL_ACIDIC' }, 'ph'],
    [{ turbidityVoltage: 1.035, turbidityStatus: 'CRITICAL_DIRTY' }, 'turbidity'],
  ]) assert.equal(evaluateReadingSafety(fields).parameters[key].severity, 'critical');
  // Saved ranges still decide whether these three parameters are acceptable.
  assert.equal(evaluateReadingSafety({ temperature: 28.52, temperatureStatus: 'HOT_WARNING' }).parameters.temperature.severity, 'normal');
  assert.equal(evaluateReadingSafety({ ph: 6.37, phStatus: 'LOW_ACIDIC' }, { ...DEFAULT_THRESHOLDS, phMin: 6 }).parameters.ph.severity, 'normal');
  assert.equal(evaluateReadingSafety({ turbidityVoltage: 2.184, turbidityStatus: 'SLIGHTLY_CLOUDY' }, { ...DEFAULT_THRESHOLDS, turbidityMax: 2 }).parameters.turbidity.severity, 'normal');
  // Opposite-direction or arbitrary metadata cannot downgrade an alert.
  assert.equal(evaluateReadingSafety({ temperature: 31, temperatureStatus: 'COLD_WARNING' }).parameters.temperature.severity, 'critical');
  assert.equal(evaluateReadingSafety({ ph: 4.8, phStatus: 'HIGH_ALKALINE_WARNING' }).parameters.ph.severity, 'critical');
});

test('firmware water severity survives history, current summaries, CSV and AI reevaluation', () => {
  for (const [status, label] of [['LOW_WARNING', 'Warning'], ['HIGH_WARNING', 'Warning'], ['CRITICAL_LOW', 'Critical'], ['CRITICAL_HIGH', 'Critical'], ['SAFE_IDEAL', 'Normal']]) {
    const records = buildMonitoringRecords([{ ...normal, tank_id: 'tank-a', water_depth_cm: status === 'SAFE_IDEAL' ? 4.6 : 4, water_status: status }], [], tanks);
    const snapshot = getCurrentTankSnapshot(records, tanks[0]);
    assert.equal(getSafetyStatusLabel(records[0].status), label);
    assert.equal(getSafetyStatusLabel(getSafetySeverity(snapshot.safety)), label);
    assert.equal(buildTankHistoryExportRows(records)[0]['Water Level Condition'], label);
    assert.equal(buildTankSnapshotExportRows([snapshot])[0]['Water Level Condition'], label);
    assert.equal(buildMonitoringAIContext({ records, tank: tanks[0] }).latest_sensor.condition, label);
  }
  const records = buildMonitoringRecords([{ ...normal, tank_id: 'tank-a', temperature_c: 30.02, temperature_status: 'HOT_WARNING', ph_value: 6.37, ph_status: 'LOW_ACIDIC', turbidity_voltage: 2.184, turbidity_status: 'SLIGHTLY_CLOUDY' }], [], tanks);
  assert.equal(getSafetySeverity(getCurrentTankSnapshot(records, tanks[0]).safety), 'warning');
  assert.equal(buildMonitoringAIContext({ records, tank: tanks[0] }).latest_sensor.condition, 'Warning');
});

test('threshold aliases and incomplete settings retain valid fallbacks', () => {
  const snake = { temperature_min: 21, temperature_max: 29, ph_min: 6, ph_max: 8, turbidity_max: 2.4, water_level_min: 5, ammonia_max: 0.2 };
  const expected = { temperatureMin: 21, temperatureMax: 29, phMin: 6, phMax: 8, turbidityMax: 2.4, waterLevelMin: 5, ammoniaMax: 0.2 };
  assert.deepEqual(normalizeThresholds(snake), expected);
  assert.deepEqual(normalizeThresholds({ thresholds: expected }), expected);
  assert.deepEqual(normalizeThresholds({ temperatureMin: '', phMin: false, waterLevelMin: null }), DEFAULT_THRESHOLDS);
  assert.equal(normalizeThresholds({ thresholds: {}, water_level_min: 5.5 }).waterLevelMin,5.5);
});

test('each tank uses its own saved thresholds in history, summaries, exports and AI without altering measurements',()=>{
 const bundle=thresholdBundle([{thresholds:DEFAULT_THRESHOLDS},
  {tank_id:'tank-a',thresholds:{...DEFAULT_THRESHOLDS,waterLevelMin:5.5,phMin:7.5,ammoniaMax:0.5}},
  {tank_id:'tank-b',thresholds:{...DEFAULT_THRESHOLDS,waterLevelMin:4,phMin:6.5,ammoniaMax:0.8}}]);
 const water=tanks.map(tank=>({...normal,tank_id:tank.id,water_status:'SAFE_IDEAL'}));
 const scans=tanks.map(tank=>({tank_id:tank.id,ammonia:0.6}));
 const before=JSON.stringify({water,scans});const records=buildMonitoringRecords(water,scans,tanks,bundle);
 const a=getCurrentTankSnapshot(records,tanks[0],bundle),b=getCurrentTankSnapshot(records,tanks[1],bundle);
 assert.equal(a.safety.parameters.waterLevel.severity,'warning');assert.equal(a.safety.parameters.ph.severity,'critical');
 assert.equal(a.safety.parameters.ammonia.severity,'critical');assert.equal(getSafetySeverity(b.safety),'normal');
 assert.equal(buildTankSnapshotExportRows([a,b])[0]['Water Level Condition'],'Warning');
 assert.equal(buildTankSnapshotExportRows([a,b])[1]['Water Level Condition'],'Normal');
 assert.equal(buildMonitoringAIContext({records,tank:tanks[0],thresholds:bundle}).latest_ammonia.condition,'Critical');
 assert.equal(buildMonitoringAIContext({records,tank:tanks[1],thresholds:bundle}).latest_ammonia.condition,'Normal');
 assert.equal(resolveTankThresholds(bundle,'new-tank').waterLevelMin,4.5);assert.equal(JSON.stringify({water,scans}),before);
});

test('threshold cache is account-scoped, draft patches preserve unedited fields and no-op does not call the server',async()=>{
 const previous=globalThis.localStorage;const storage=new Map();
 globalThis.localStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
 try {
  const bundle=thresholdBundle([{tank_id:'tank-a',thresholds:{...DEFAULT_THRESHOLDS,waterLevelMin:7}}]);
  cacheThresholdBundle('owner-a',bundle);assert.equal(getLocalThresholds('tank-a','owner-a').waterLevelMin,7);
  assert.equal(getLocalThresholds('tank-a','owner-b').waterLevelMin,4.5);assert.equal(getLocalThresholds().waterLevelMin,4.5);
  assert.deepEqual(readThresholdCache('owner-a'),bundle);
  assert.deepEqual(thresholdChanges(DEFAULT_THRESHOLDS,{...DEFAULT_THRESHOLDS,waterLevelMin:5}),{waterLevelMin:5});
  assert.deepEqual(suggestionPatch({parameter:'water_level',suggested_value:5}),{waterLevelMin:5});
  assert.throws(()=>suggestionPatch({parameter:'water_level',suggested_value:null}),/incomplete/);
  const client={rpc(){throw new Error('No-op must not call server');}};
  assert.equal((await applyTankThresholds(client,{userId:'owner-a',tankId:'tank-a',patch:{}})).changed,0);
 } finally {globalThis.localStorage=previous;}
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
  assert.deepEqual(Object.keys(water), ['Type', 'Tank', 'Temperature', 'Temperature Condition', 'pH', 'pH Condition', 'Water Clarity', 'Water Clarity Condition', 'Water Level', 'Water Level Condition', 'Water Sensor Health', 'Water Value Source', 'Water Measurement Fresh', 'Water Last Good Age (ms)', 'Ammonia', 'Ammonia Condition', 'Overall Condition', 'Date']);
  assert.equal(water.Ammonia, '');
  assert.equal(water['Water Level Condition'], 'Warning');
  assert.equal(ammonia.Temperature, '');
  assert.equal(ammonia['Ammonia Condition'], 'Critical');
  assert.equal(ammonia.Date, '2026-10-03T09:00:00Z');
});

test('water stale health never becomes Normal or physical Critical, regardless of carried depth', () => {
  for (const depth of [0.6, 4.02, 99]) {
    const raw = { ...normal, water_depth_cm: depth, water_status: 'SENSOR_STALE',
      raw_payload: { water_value_source: 'last_good', water_measurement_fresh: false, water_last_good_age_ms: 5000,
        sensor_health: { water_level: { health: 'WARNING' } }, warning_flags: ['WATER_LEVEL_SENSOR_STALE'] } };
    const before = JSON.stringify(raw);
    const normalized = normalizeSensorReading(raw);
    const parameter = normalized.safety.parameters.waterLevel;
    assert.equal(normalized.waterValue, depth);
    assert.match(normalized.waterLabel, /^Latest available:/);
    assert.equal(parameter.severity, 'warning');
    assert.equal(parameter.health, 'stale');
    assert.equal(parameter.measurementFresh, false);
    assert.equal(parameter.valueSource, 'last_good');
    assert.equal(getSafetySeverity(normalized.safety), 'warning');
    assert.equal(normalized.safety.isSafe, false);
    assert.match(getParameterExplanation(parameter, 'Water Level'), /Waiting for fresh reading/);
    assert.equal(JSON.stringify(raw), before);
  }
});

test('explicit carried metadata overrides a fresh-looking water status during every reevaluation', () => {
  for (const status of ['SAFE_IDEAL', 'CRITICAL_LOW', 'HIGH_WARNING', undefined]) {
    const payload = { water_value_source: 'last_good', water_measurement_fresh: false, water_last_good_age_ms: 10000 };
    const records = buildMonitoringRecords([{ ...normal, tank_id: 'tank-a', water_status: status, raw_payload: JSON.stringify(payload) }], [], tanks);
    const snapshot = getCurrentTankSnapshot(records, tanks[0]);
    assert.equal(snapshot.safety.parameters.waterLevel.health, 'stale');
    assert.equal(getSafetySeverity(snapshot.safety), 'warning');
    const history = buildTankHistoryExportRows(records)[0];
    const current = buildTankSnapshotExportRows([snapshot])[0];
    for (const row of [history, current]) {
      assert.equal(row['Water Value Source'], 'last_good');
      assert.equal(row['Water Measurement Fresh'], false);
      assert.equal(row['Water Last Good Age (ms)'], 10000);
      assert.equal(row['Water Sensor Health'], 'Waiting for fresh reading');
      assert.match(row['Water Level'], /Latest available/);
    }
    const context = buildMonitoringAIContext({ records, tank: tanks[0] });
    assert.equal(context.latest_sensor.water_measurement_fresh, false);
    assert.equal(context.latest_sensor.water_value_source, 'last_good');
    assert.equal(context.latest_sensor.condition, 'Warning');
    assert.match(context.instructions, /not a new physical measurement/);
  }
});

test('confirmed water error, startup waiting, and fresh recovery have distinct health states', () => {
  const error = normalizeSensorReading({ water_status: 'SENSOR_ERROR', water_depth_cm: null, water_level: null, water_distance_cm: 4 });
  assert.equal(error.waterValue, null);
  assert.equal(error.waterLabel, 'Sensor Error');
  assert.equal(error.safety.parameters.waterLevel.health, 'error');
  assert.equal(error.safety.parameters.waterLevel.hasValue, false);
  assert.equal(getSafetySeverity(error.safety), 'warning');
  const waiting = normalizeSensorReading({ water_status: 'NO_READING' });
  assert.equal(waiting.waterValue, null);
  assert.equal(waiting.safety.parameters.waterLevel.health, 'waiting');
  assert.equal(getSafetySeverity(waiting.safety), 'no-data');
  const staleWithoutValue = normalizeSensorReading({ water_status: 'SENSOR_STALE', water_depth_cm: null });
  assert.equal(staleWithoutValue.waterValue, null);
  assert.equal(staleWithoutValue.waterLabel, 'No Data');
  assert.match(staleWithoutValue.safety.parameters.waterLevel.explanation, /No last-good water level is available/);
  const fresh = normalizeSensorReading({ water_status: 'SAFE_IDEAL', water_depth_cm: 4.02,
    raw_payload: { water_value_source: 'fresh', water_measurement_fresh: true, water_last_good_age_ms: 0 } });
  assert.equal(fresh.waterValue, 4.02);
  assert.equal(fresh.waterLabel, '4.02 cm');
  assert.equal(fresh.safety.parameters.waterLevel.health, 'fresh');
  assert.equal(fresh.safety.parameters.waterLevel.measurementFresh, true);
  // Freshness recovery does not override the active tank minimum (4.5 cm).
  assert.equal(fresh.safety.parameters.waterLevel.severity, 'warning');
  assert.equal(fresh.safety.issues.length, 1);
  assert.equal(getWaterReadingHealth('SAFE_IDEAL', { sensor_health: { water_level: { health: 'ERROR' } } }).health, 'error');
  for (const invalid of [null, false, '', ' ', [], {}]) {
    assert.equal(getWaterReadingHealth('SENSOR_STALE', { water_last_good_age_ms: invalid }).lastGoodAgeMs, null);
  }
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

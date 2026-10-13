import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { formatWaterDepth, formatWaterDepthAlert, waterDepthMinimumMessage } from '../supabase/functions/_shared/waterDepthDisplay.js';
import { formatMonitoringAlert } from '../supabase/functions/_shared/monitoringAlertPresentation.js';
import { buildTankActivity } from '../supabase/functions/_shared/tankActivity.js';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false } });
after(() => server.close());
const { normalizeSensorReading } = await server.ssrLoadModule('/src/utils/sensorReadingUtils.js');
const { buildMonitoringRecords, getCurrentTankSnapshot, buildTankHistoryExportRows, buildTankSnapshotExportRows } = await server.ssrLoadModule('/src/utils/monitoringRecords.js');
const { buildPrintableReport } = await server.ssrLoadModule('/src/utils/exportPrintUtils.js');

test('two-decimal depth formatting preserves null/invalid handling and a real zero', () => {
  for (const [value, display] of [[3.05, '3.05 cm'], ['3.05', '3.05 cm'], [3, '3.00 cm'], [0, '0.00 cm'], [3.056, '3.06 cm']]) {
    assert.equal(formatWaterDepth(value), display);
  }
  for (const value of [null, undefined, '', ' ', false, NaN, Infinity, -1, 'invalid']) {
    assert.equal(formatWaterDepth(value), 'No Data');
    assert.equal(formatWaterDepth(value, null), null);
  }
});
test('canonical depth stays 3.05; raw threshold and precision boundaries are never rounded first', () => {
  const row = { water_depth_cm: 3.05, water_level: 99, water_distance_cm: 0.1, water_status: 'SAFE_IDEAL' };
  const before = structuredClone(row);
  for (const [minimum, severity] of [[3.04, 'normal'], [3.05, 'normal'], [3.051, 'warning'], [3.06, 'warning']]) {
    const reading = normalizeSensorReading(row, { waterLevelMin: minimum });
    assert.equal(reading.waterValue, 3.05);
    assert.equal(reading.waterLabel, '3.05 cm');
    assert.equal(reading.safety.parameters.waterLevel.severity, severity);
  }
  const near = normalizeSensorReading({ water_depth_cm: 3.049 }, { waterLevelMin: 3.05 });
  assert.equal(near.safety.parameters.waterLevel.severity, 'warning');
  assert.match(near.safety.issues[0].message, /Raw comparison: 3.049 cm < 3.05 cm/);
  assert.match(waterDepthMinimumMessage(3.05, 3.051), /Raw comparison: 3.05 cm < 3.051 cm/);
  assert.deepEqual(row, before);
  assert.equal(normalizeSensorReading({ water_distance_cm: 3.05 }).waterValue, null);
  assert.equal(normalizeSensorReading({ water_depth_cm: 'invalid', water_level: 3.05 }).waterLabel, '3.05 cm');
  assert.equal(normalizeSensorReading({ water_depth_cm: 3.05, water_status: 'SENSOR_STALE' }).waterLabel, 'Latest available: 3.05 cm');
  assert.equal(normalizeSensorReading({ water_depth_cm: 3.05, water_status: 'SENSOR_ERROR' }).waterLabel, 'Sensor Error');
});
test('saved alert evidence supplies lost display precision without substituting current data or modifying metadata', () => {
  const row = { title: 'Low water level', message: 'Water level 3.0 cm is below the minimum of 3.1 cm.', severity: 'warning',
    metadata: { parameter: 'waterLevel', sensor_snapshot: { water_depth_cm: 3.05, value: 3, thresholds: { waterLevelMin: 3.1 } } } };
  const before = structuredClone(row);
  assert.equal(formatMonitoringAlert(row).message, 'Water level 3.05 cm is below the minimum of 3.1 cm.');
  assert.deepEqual(row, before);
  assert.equal(formatWaterDepthAlert({ title: 'Low water level', message: 'Water level 3.0 cm is low.' }).message, 'Water level 3.00 cm is low.');
  assert.deepEqual(formatMonitoringAlert({ title: 'Drain completed', message: 'Drain ran for 3 seconds.' }),
    { title: 'Drain completed', message: 'The drain pump was activated.' });
  assert.equal(formatMonitoringAlert({ title: 'Temperature', message: 'Probe cable is 3.0 cm long.' }).message, 'Probe cable is 3.0 cm long.');
  assert.equal(formatMonitoringAlert({ alert_title: 'Low water level', description: 'Water level 3.0 cm is low.',
    metadata: { parameter: 'water_depth', sensor_snapshot: { value: 3.05 } } }).message, 'Water level 3.05 cm is low.');
  assert.equal(formatMonitoringAlert({ title: 'Low water level', message: 'Take a fresh measurement.',
    metadata: { parameter: 'waterLevel', sensor_snapshot: { value: 3.05 } } }).message,
  'Take a fresh measurement. Recorded water level: 3.05 cm.');
  assert.equal(formatMonitoringAlert({ title: 'pH warning', message: 'pH is low; water level 3.0 cm was recorded.',
    metadata: { parameter: 'ph', sensor_snapshot: { value: 4.8 } } }).message, 'pH is low; water level 3.00 cm was recorded.');
  const precise = { title: 'Water level warning', message: 'Water level 3.05 cm is below the minimum of 3.051 cm.',
    metadata: { parameter: 'waterLevel', sensor_snapshot: { value: 3.05 } } };
  assert.equal(formatMonitoringAlert(precise).message, precise.message);
});
test('history, snapshot exports, printable report and saved activity share the same recorded depth', () => {
  const tank = { id: 'tank-a', user_id: 'owner', name: 'Tank A' };
  const row = { id: 'reading', user_id: 'owner', tank_id: tank.id, water_depth_cm: 3.05, created_at: '2026-10-13T02:00:00Z' };
  const records = buildMonitoringRecords([row], [], [tank]);
  const history = buildTankHistoryExportRows(records), current = buildTankSnapshotExportRows([getCurrentTankSnapshot(records, tank)]);
  assert.equal(history[0]['Water Level'], '3.05 cm');
  assert.equal(current[0]['Water Level'], '3.05 cm');
  const html = buildPrintableReport({ title: 'Tank report', sections: [{ title: 'History', rows: history, kind: 'tanks' }] });
  assert.match(html, /3.05 cm/);
  const alert = { ...row, id: 'alert', title: 'Low water level', type: 'sensor_reading', severity: 'warning',
    message: 'Water level 3.0 cm is low.', metadata: { parameter: 'water_depth', sensor_snapshot: { water_depth_cm: 3.05, value: 3 } } };
  const before = structuredClone(alert);
  const event = buildTankActivity({ tank, userId: 'owner', sources: { alerts: [alert] } })[0];
  assert.equal(event.reading, '3.05 cm');
  assert.equal(event.reason, 'Water level 3.05 cm is low.');
  assert.deepEqual(alert, before);
});

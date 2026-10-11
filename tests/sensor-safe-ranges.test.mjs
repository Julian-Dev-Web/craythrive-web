import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSensorCardValue, formatSensorSafeRange } from '../src/utils/sensorSafeRanges.js';
import { DEFAULT_THRESHOLDS, resolveTankThresholds, thresholdBundle } from '../supabase/functions/_shared/thresholdResolution.js';

test('all five card ranges use saved values, units and the real threshold direction', () => {
  const thresholds = { temperatureMin: 22.25, temperatureMax: 29.75, phMin: 6.8, phMax: 8.1,
    waterLevelMin: 3.75, turbidityMax: 2.85, ammoniaMax: 0.125 };
  assert.deepEqual(Object.fromEntries(['temperature', 'ph', 'waterLevel', 'turbidity', 'ammonia']
    .map(key => [key, formatSensorSafeRange(key, thresholds)])), {
    temperature: 'Safe Range: 22.25–29.75 °C', ph: 'Safe Range: 6.8–8.1',
    waterLevel: 'Safe Limit: ≥ 3.75 cm', turbidity: 'Safe Limit: ≥ 2.85 V',
    ammonia: 'Safe Limit: ≤ 0.125 mg/L',
  });
  assert.equal(formatSensorSafeRange('unknown', thresholds), '');
});

test('range presentation inherits tank override, account settings, then existing defaults', () => {
  const rows = [{ tank_id: null, thresholds: { waterLevelMin: 4.2 } },
    { tank_id: 'a', water_level_min: '2' }, { tank_id: 'b', thresholds: { waterLevelMin: 3 } }];
  const bundle = thresholdBundle(rows);
  assert.equal(formatSensorSafeRange('waterLevel', resolveTankThresholds(bundle, 'a')), 'Safe Limit: ≥ 2 cm');
  assert.equal(formatSensorSafeRange('waterLevel', resolveTankThresholds(bundle, 'b')), 'Safe Limit: ≥ 3 cm');
  assert.equal(formatSensorSafeRange('waterLevel', resolveTankThresholds(bundle, 'c')), 'Safe Limit: ≥ 4.2 cm');
  assert.equal(formatSensorSafeRange('waterLevel', resolveTankThresholds(thresholdBundle([]), 'c')),
    `Safe Limit: ≥ ${DEFAULT_THRESHOLDS.waterLevelMin} cm`);
  assert.equal(rows[0].thresholds.waterLevelMin, 4.2);
});

test('missing readings are explicit, while zero, recorded values and sensor health remain intact', () => {
  for (const value of [null, undefined, 'No Data', 'No Reading', 'No Scan', 'No Scan Yet']) {
    assert.equal(formatSensorCardValue(value, 'waterLevel'), 'No reading');
    assert.equal(formatSensorCardValue(value, 'ammonia'), 'No recent ammonia reading');
  }
  for (const value of [0, '0.00 mg/L', '26.3°C', 'Sensor Error', 'Latest available: 3.5 cm']) {
    assert.equal(formatSensorCardValue(value, 'ammonia'), value);
  }
});

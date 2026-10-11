import { timestampMs } from './philippineTime.js';

// Portable Web/Expo/Deno contract. One upload is one observation; never fill
// holes with values from another row or convert ADC/distance into engineering units.
export const LIVE_SENSOR_MAX_AGE_MS = 5 * 60 * 1000; // Existing monitoring/control freshness policy.
export function sensorNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
const firstNumber = (...values) => values.map(sensorNumber).find(value => value !== null) ?? null;
export function sensorValues(row = {}) {
  const ph = firstNumber(row.ph_value, row.ph);
  const clarity = firstNumber(row.turbidity_voltage, row.turbidity);
  const depth = firstNumber(row.water_depth_cm, row.water_level, row.waterValue);
  return {
    temperature: firstNumber(row.temperature_c, row.temperature),
    ph: ph !== null && ph >= 0 && ph <= 14 ? ph : null,
    turbidityVoltage: clarity !== null && clarity >= 0 ? clarity : null,
    waterDepth: depth !== null && depth >= 0 ? depth : null,
  };
}

// PostgreSQL preserves microseconds; Date alone would collapse distinct instants.
function observationOrder(row) {
  const value = row?.created_at;
  const ms = timestampMs(value);
  const fraction = typeof value === 'string' ? value.match(/\.(\d+)/)?.[1] || '' : '';
  return [Number.isFinite(ms) ? ms : -Infinity, Number(fraction.padEnd(6, '0').slice(3, 6)) || 0];
}
export function compareSensorRowsNewestFirst(a, b) {
  const [am, au] = observationOrder(a), [bm, bu] = observationOrder(b);
  const aId = String(a?.id || ''), bId = String(b?.id || '');
  return (bm - am || bu - au) || (bId > aId ? 1 : bId < aId ? -1 : 0);
}
export function orderLatestSensorQuery(query) {
  return query.order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false });
}
export function mergeSensorHistoryRows(history, current) {
  const rows = new Map(history.map(row => [row.id, row]));
  for (const row of current) rows.set(row.id, row);
  return [...rows.values()].sort(compareSensorRowsNewestFirst);
}
export function sensorRowBelongsToTank(row, tank, userId = tank?.user_id) {
  // Explicit observation binding survives device replacement. Reusing today's
  // device pairing cannot assign an unbound historic observation to a tank.
  const id = tank?.id || tank?.tank_id || tank?.uuid;
  return !!id && String(row?.tank_id || '') === String(id)
    && (!userId || row?.user_id === userId);
}
export function sensorObservationHealth(row, nowMs) {
  if (!row) return 'missing';
  const date = timestampMs(row.created_at);
  if (!Number.isFinite(date) || !Number.isFinite(nowMs) || date > nowMs) return 'unverified-time';
  return nowMs - date > LIVE_SENSOR_MAX_AGE_MS ? 'stale' : 'fresh';
}

// A display availability gate, not another threshold classifier. Historical
// evaluations and hardware guards keep using the existing evaluator unchanged.
export function currentSensorSafety(safety, row, nowMs, verified = true) {
  const observationHealth = sensorObservationHealth(row, nowMs);
  const parameters = {};
  for (const [key, original] of Object.entries(safety.parameters)) {
    const code = String(row?.[`${key === 'waterLevel' ? 'water' : key}_status`] || '').toUpperCase();
    const health = !verified ? 'unverified' : key === 'ammonia' ? original.hasValue ? 'manual-scan' : 'missing'
      : ['SENSOR_ERROR', 'ERROR', 'NO_DATA', 'NO_READING', 'WAITING'].includes(code) ? 'invalid'
      : code === 'SENSOR_STALE' || ['stale', 'error', 'waiting'].includes(original.health) ? 'stale'
      : !original.hasValue ? 'missing' : observationHealth;
    const usable = health === 'fresh';
    parameters[key] = usable ? original : { ...original, severity: 'no-data',
      recordedSeverity: original.severity, availability: health,
      label: health === 'stale' ? 'Stale' : key === 'ammonia' && original.hasValue ? 'Manual Scan' : 'No Reading',
      explanation: !verified ? 'Current readings or thresholds could not be verified. Refresh to retry.'
        : key === 'ammonia' ? original.hasValue ? 'Dated manual scan, not a live ammonia measurement. Take a new scan to check the current condition.'
          : 'No ammonia scan is available. Take a new scan.'
        : health === 'stale' ? 'Stale reading. Take a fresh measurement.'
        : health === 'unverified-time' ? 'The reading time could not be verified against server time.'
        : 'No valid current reading is available.',
      ...(key === 'waterLevel' ? { measurementFresh: false,
        health: ['error', 'waiting'].includes(original.health) ? original.health : health === 'stale' ? 'stale' : 'no-data' } : {}) };
  }
  const issues = safety.issues.filter(issue => ['warning', 'critical'].includes(parameters[issue.key]?.severity));
  const currentEvidenceIncomplete = ['temperature', 'ph', 'turbidity', 'waterLevel']
    .some(key => parameters[key]?.severity === 'no-data');
  return { ...safety, parameters, issues, observationHealth, currentEvidenceIncomplete,
    activeThresholds: verified ? safety.activeThresholds : null,
    isSafe: !currentEvidenceIncomplete && issues.length === 0,
    hasData: Object.values(parameters).some(parameter => parameter.hasValue) };
}

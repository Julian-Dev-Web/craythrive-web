import { formatSensorSafeRange } from './sensorSafeRanges.js';
import { formatPhilippineDateTime, timestampMs } from './philippineTime.js';
import { LIVE_SENSOR_MAX_AGE_MS } from './sensorReadingContract.js';
import { formatWaterDepth, waterDepthMinimumMessage } from './waterDepthDisplay.js';

// Same age policy as the existing Web manual-control guard. This only gates
// recommendation evidence; it does not change classification or actuator rules.
export const LIVE_RECOMMENDATION_MAX_AGE_MS = LIVE_SENSOR_MAX_AGE_MS;
const sensors = [
  ['temperature', 'Water Temperature', '°C', 1], ['waterLevel', 'Water Level', 'cm', 2],
  ['ph', 'pH Level', '', 2], ['turbidity', 'Water Clarity', 'V', 2], ['ammonia', 'Ammonia', 'mg/L', 2],
];
const rank = { critical: 0, warning: 1, 'no-data': 2, normal: 3 };
const labels = { critical: 'Critical', warning: 'Warning', normal: 'Normal', 'no-data': 'Unavailable' };
const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) ? Number(value) : null;
const statusCode = value => String(value || '').trim().toUpperCase().replaceAll(' ', '_');

function invalidValue(key, value) {
  return value === null || (['waterLevel', 'turbidity', 'ammonia'].includes(key) && value < 0)
    || (key === 'ph' && (value < 0 || value > 14));
}

function availability(key, reading, value, nowMs, ammoniaMaxAgeMs) {
  if (invalidValue(key, value)) return 'missing';
  if (['SENSOR_ERROR', 'ERROR', 'NO_READING', 'NO_DATA', 'WAITING'].includes(statusCode(reading?.status))
    || ['error', 'waiting', 'no-data'].includes(reading?.health)) return 'invalid';
  if (reading?.health === 'stale' || statusCode(reading?.status) === 'SENSOR_STALE') return 'stale';
  const dateMs = timestampMs(reading?.timestamp);
  if (!Number.isFinite(nowMs) || !Number.isFinite(dateMs) || dateMs > nowMs) return 'unverified-time';
  // No ammonia expiration policy is stored. Never invent one or call a manual
  // scan live. A future caller may supply an explicitly configured scan age.
  if (key === 'ammonia' && (!Number.isFinite(ammoniaMaxAgeMs) || ammoniaMaxAgeMs <= 0)) return 'scan-age-unconfigured';
  const limit = key === 'ammonia' ? ammoniaMaxAgeMs : LIVE_RECOMMENDATION_MAX_AGE_MS;
  return nowMs - dateMs > limit ? 'stale' : 'current';
}

function thresholdReason(key, value, parameter, active, range) {
  if (parameter?.source === 'firmware' && parameter.severity !== 'normal') {
    return `${parameter.explanation || 'The monitoring device reports a water-level issue'}. `
      + 'No matching numeric critical boundary is configured in these settings.';
  }
  const bounds = {
    temperature: [active.temperatureMin, active.temperatureMax], ph: [active.phMin, active.phMax],
    waterLevel: [active.waterLevelMin, null], turbidity: [active.turbidityMax, null], ammonia: [null, active.ammoniaMax],
  };
  const [min, max] = bounds[key];
  if (key === 'waterLevel' && value < min) return waterDepthMinimumMessage(value, min);
  if (min !== null && value < min) return `The reading is below the configured minimum (${min}${key === 'ph' ? '' : key === 'temperature' ? ' °C' : key === 'turbidity' ? ' V' : ' cm'}).`;
  if (max !== null && value > max) return `The reading is above the configured maximum (${max}${key === 'ph' ? '' : key === 'temperature' ? ' °C' : ' mg/L'}).`;
  return parameter?.severity === 'normal' ? `The reading is within the configured limits. ${range}.`
    : parameter?.explanation || 'The existing evaluator reports a condition that needs verification.';
}

export function getSensorInspectionAction(key, severity) {
  if (severity === 'normal') return 'Continue routine monitoring and record any changes.';
  const checks = {
    temperature: 'Check the probe connection, confirm with a separate thermometer, and inspect sun exposure or unusual temperature changes. Avoid abrupt adjustments.',
    waterLevel: 'Confirm the depth against the tank markings. Inspect for leaks, obstructions and sensor positioning before deciding whether water needs adjusting.',
    ph: 'Repeat the pH test with a checked probe or test kit. Inspect recent water or feeding changes. Do not dose chemicals from one reading; seek qualified aquaculture guidance if the issue persists.',
    turbidity: 'Inspect the water, gently clean the sensor as instructed, and check filtration and leftover feed. Retest before deciding on a water change.',
    ammonia: 'Take a new ammonia test or manual scan following the kit instructions. Inspect waste and recent feeding, and seek qualified guidance if the result remains high.',
  };
  return `${severity === 'critical' ? 'Check this tank now and verify with a fresh measurement. ' : 'Verify the reading and inspect the tank. '}${checks[key]}`;
}

// Portable across Web, Expo and Deno. This consumes the existing evaluator's
// result; it never creates biological thresholds or reclassifies fresh values.
export function buildSensorRecommendations({ tankId, tankName, parameters = {}, thresholds,
  readings = {}, nowMs, ammoniaMaxAgeMs = null }) {
  return sensors.map(([key, name, unit, decimals]) => {
    const reading = readings[key];
    const value = numeric(reading?.value);
    const parameter = parameters[key];
    const evaluated = Object.hasOwn(labels, parameter?.severity) ? parameter.severity : 'no-data';
    const health = availability(key, reading, value, nowMs, ammoniaMaxAgeMs);
    const severity = thresholds && health === 'current' ? evaluated : 'no-data';
    const range = thresholds ? formatSensorSafeRange(key, thresholds) : 'Safe limits unavailable';
    const timestamp = reading?.timestamp || null;
    const latestValue = invalidValue(key, value) ? key === 'ammonia' ? 'No recent ammonia reading' : 'No reading'
      : key === 'waterLevel' ? formatWaterDepth(value) : `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
    let reason;
    let action;
    if (!thresholds) {
      reason = 'The configured thresholds could not be verified. This value cannot establish the current tank condition.';
      action = 'Reconnect and reload the tank settings and readings before deciding what to change.';
    } else if (health !== 'current') {
      reason = health === 'missing' || health === 'invalid'
        ? 'No valid measurement is available to establish the current condition.'
        : health === 'stale' ? 'This is an older or carried measurement. It cannot establish the current water condition.'
        : health === 'scan-age-unconfigured' ? 'This is a dated manual scan, not a live sensor reading. No scan-validity period is configured, so it cannot confirm the current ammonia condition.'
        : 'The observation time could not be verified against server time. It cannot establish the current condition.';
      action = key === 'ammonia' ? 'Take a new ammonia test or manual scan following the kit instructions and confirm when it was taken.'
        : 'Check the sensor connection and take a fresh measurement. Reload when the sensor has uploaded a new reading.';
    } else if (evaluated === 'no-data') {
      reason = 'A reliable evaluated status is unavailable for this measurement.';
      action = 'Reload the tank settings and take a fresh reading before making changes.';
    } else {
      reason = thresholdReason(key, value, parameter, thresholds, range);
      action = getSensorInspectionAction(key, severity);
    }
    return { id: `${tankId}:${key}`, tankId, tankName, parameter: key, name,
      value: invalidValue(key, value) ? null : value, unit, latestValue, safeRange: range,
      severity, status: health === 'stale' ? 'Stale' : labels[severity], health,
      recordedSeverity: evaluated, timestamp,
      timestampLabel: formatPhilippineDateTime(timestamp, {}, 'Timestamp unavailable'),
      reason, action, measurementType: key === 'ammonia' ? 'manual_scan' : 'sensor',
    };
  }).sort((a, b) => rank[a.severity] - rank[b.severity]);
}

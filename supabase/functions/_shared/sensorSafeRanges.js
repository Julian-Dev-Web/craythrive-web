import { normalizeThresholds } from './thresholdResolution.js';

// Presentation only; shared by Web and the portable recommendation rules.
export function formatSensorSafeRange(sensor, thresholds) {
  const active = normalizeThresholds(thresholds);
  switch (sensor) {
    case 'temperature': return `Safe Range: ${active.temperatureMin}–${active.temperatureMax} °C`;
    case 'ph': return `Safe Range: ${active.phMin}–${active.phMax}`;
    case 'waterLevel': return `Safe Limit: ≥ ${active.waterLevelMin} cm`;
    // Historical turbidityMax means minimum clear-water voltage.
    case 'turbidity': return `Safe Limit: ≥ ${active.turbidityMax} V`;
    case 'ammonia': return `Safe Limit: ≤ ${active.ammoniaMax} mg/L`;
    default: return '';
  }
}

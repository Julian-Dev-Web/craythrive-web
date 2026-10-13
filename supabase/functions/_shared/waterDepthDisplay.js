import { sensorNumber } from './sensorReadingContract.js';

// Presentation only: callers keep the original number for evaluation/control.
export function formatWaterDepth(value, empty = 'No Data') {
  const number = sensorNumber(value);
  return number === null || number < 0 ? empty : `${number.toFixed(2)} cm`;
}

export function waterDepthMinimumMessage(value, minimum) {
  const reading = formatWaterDepth(value), limit = formatWaterDepth(minimum);
  // If more than two decimals were uploaded/configured, explain a comparison
  // hidden by display precision rather than comparing rounded numbers.
  const detail = value < minimum && reading === limit ? ` Raw comparison: ${value} cm < ${minimum} cm.` : '';
  return `${reading} is below the active tank minimum (${limit}).${detail}`;
}

export function formatWaterDepthText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/(^|[^\w.-])(\d+(?:\.\d+)?)\s*cm\b/g, (match, prefix, number, offset) => {
    const before = value.slice(0, offset + prefix.length);
    // Configured bounds and explicitly disclosed raw comparisons can have
    // additional meaningful precision. They are not sensor display values.
    if (/\b(?:minimum|maximum|min|max|threshold|limit|range)\s*(?:of|is|:|=|\()?\s*$/i.test(before)
      || /Raw comparison:[^\n]*$/i.test(before)) return match;
    return `${prefix}${formatWaterDepth(number, match.slice(prefix.length))}`;
  });
}

export function recordedWaterDepth(record = {}) {
  const metadata = record.metadata || {}, snapshot = metadata.sensor_snapshot || {};
  const parameter = String(metadata.parameter || snapshot.parameter || '').replace(/[_\s-]/g, '').toLowerCase();
  const waterValue = !parameter || ['waterlevel', 'waterdepth', 'waterdepthcm'].includes(parameter) ? snapshot.value : null;
  const value = [record.water_depth_cm, snapshot.water_depth_cm, metadata.water_depth_cm,
    record.water_level, snapshot.water_level, waterValue].map(sensorNumber).find(value => value !== null) ?? null;
  return value !== null && value >= 0 ? value : null;
}

// Historical alerts must use their own saved evidence, never today's snapshot.
export function formatWaterDepthAlert(record = {}) {
  const metadata = record.metadata || {}, snapshot = metadata.sensor_snapshot || {};
  const title = record.title || record.alert_title || record.notification_title;
  let message = record.message || record.description || record.body;
  const parameter = String(metadata.parameter || snapshot.parameter || record.sensor_type || record.type || '').replace(/[_\s-]/g, '').toLowerCase();
  const water = ['waterlevel', 'waterdepth', 'waterdepthcm'].includes(parameter)
    || /water[\s_-]+(?:level|depth)\b/i.test(`${title || ''} ${message || ''}`);
  if (!water) return { title, message };
  const saved = recordedWaterDepth(record);
  if (saved !== null && typeof message === 'string') {
    let replaced = false;
    message = message.replace(/(water[\s_-]+(?:level|depth)\s*(?::|=|is|of|at)?\s*|^)(\d+(?:\.\d+)?)\s*cm\b/i,
      (_, prefix) => { replaced = true; return `${prefix}${formatWaterDepth(saved)}`; });
    if (!replaced) message += ` Recorded water level: ${formatWaterDepth(saved)}.`;
  }
  return { title: formatWaterDepthText(title), message: formatWaterDepthText(message) };
}

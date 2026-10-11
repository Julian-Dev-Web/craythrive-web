export { formatSensorSafeRange } from '../../supabase/functions/_shared/sensorSafeRanges.js';

export function formatSensorCardValue(value, sensor) {
  if (value == null || ['No Data', 'No Reading', 'No Scan', 'No Scan Yet'].includes(value)) {
    return sensor === 'ammonia' ? 'No recent ammonia reading' : 'No reading';
  }
  return value;
}

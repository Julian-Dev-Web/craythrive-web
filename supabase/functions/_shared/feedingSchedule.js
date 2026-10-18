import { normalizeDispenseCycles, recordedDispenseCycles } from './feederControl.js';
import { philippineDateKey, philippineDayBounds, timestampMs } from './philippineTime.js';

export const DEFAULT_FEEDING_SCHEDULE = Object.freeze({ auto_feeding_enabled: true, auto_feed_hour: 19, auto_feed_minute: 0, auto_feed_cycles: 2 });
const integer = (value, maximum) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
export function validFeedingSchedule(value) {
  return !!value && typeof value.auto_feeding_enabled === 'boolean' && integer(value.auto_feed_hour, 23)
    && integer(value.auto_feed_minute, 59) && recordedDispenseCycles(value.auto_feed_cycles) !== null
    && typeof value.auto_feed_cycles === 'number';
}
export function normalizeFeedingSchedule(row = {}) {
  return { auto_feeding_enabled: typeof row.auto_feeding_enabled === 'boolean' ? row.auto_feeding_enabled : DEFAULT_FEEDING_SCHEDULE.auto_feeding_enabled,
    auto_feed_hour: integer(row.auto_feed_hour, 23) ? row.auto_feed_hour : DEFAULT_FEEDING_SCHEDULE.auto_feed_hour,
    auto_feed_minute: integer(row.auto_feed_minute, 59) ? row.auto_feed_minute : DEFAULT_FEEDING_SCHEDULE.auto_feed_minute,
    auto_feed_cycles: normalizeDispenseCycles(row.auto_feed_cycles) };
}
export function feedingTimeInput(value) {
  return integer(value?.auto_feed_hour, 23) && integer(value?.auto_feed_minute, 59)
    ? `${String(value.auto_feed_hour).padStart(2, '0')}:${String(value.auto_feed_minute).padStart(2, '0')}` : '';
}
export function parseFeedingTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return { auto_feed_hour: null, auto_feed_minute: null };
  const [hour, minute] = value.split(':').map(Number);
  return { auto_feed_hour: integer(hour, 23) ? hour : null, auto_feed_minute: integer(minute, 59) ? minute : null };
}
// A wall-clock schedule in Manila, never a browser-local Date conversion.
export function feedingTimeLabel(value) {
  if (!feedingTimeInput(value)) return 'Time unavailable';
  const hour = value.auto_feed_hour;
  return `${hour % 12 || 12}:${String(value.auto_feed_minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
// Display only. This never runs a command, schedules a timer or claims execution.
export function nextFeedingSchedule(value, now, completedToday = false) {
  const ms = timestampMs(now);
  if (!value?.auto_feeding_enabled || !validFeedingSchedule(value) || !Number.isFinite(ms)) return null;
  const start = timestampMs(philippineDayBounds(philippineDateKey(ms)).startIso);
  let next = start + (value.auto_feed_hour * 60 + value.auto_feed_minute) * 60000;
  if (completedToday || next < ms) next += 86400000;
  return new Date(next).toISOString();
}

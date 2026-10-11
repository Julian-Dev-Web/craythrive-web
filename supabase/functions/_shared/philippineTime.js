// Portable policy for Vite, Expo/Hermes and Deno. Database instants stay UTC.
export const PHILIPPINE_TIME_ZONE = 'Asia/Manila';
const DAY_MS = 86400000;

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  // PostgreSQL may use a space separator and +00 rather than +00:00.
  let iso = value.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(iso)
    || !validCalendarDate(iso.slice(0, 10))) return NaN;
  iso = iso.replace(/([+-]\d{2})$/, '$1:00');
  return new Date(iso).getTime();
}

function format(value, options, fallback) {
  const ms = timestampMs(value);
  return Number.isFinite(ms) ? new Intl.DateTimeFormat('en-PH', {
    ...options, timeZone: PHILIPPINE_TIME_ZONE,
  }).format(ms) : fallback;
}

export const formatPhilippineDateTime = (value, options = {}, fallback = 'No date') => format(value,
  { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, ...options }, fallback);
export const formatPhilippineDate = (value, options = {}, fallback = 'No date') => format(value,
  { month: 'short', day: 'numeric', year: 'numeric', ...options }, fallback);
export const formatPhilippineTime = (value, options = {}, fallback = '') => format(value,
  { hour: 'numeric', minute: '2-digit', hour12: true, ...options }, fallback);

export function philippineDateKey(value) {
  const ms = timestampMs(value);
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PHILIPPINE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ms);
  const part = key => parts.find(item => item.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function philippineDayBounds(day) {
  if (!validCalendarDate(day)) throw new RangeError('A valid Philippine calendar date is required.');
  const start = new Date(`${day}T00:00:00+08:00`).getTime();
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + DAY_MS).toISOString() };
}

export const formatPhilippineCalendarDate = day => {
  if (!validCalendarDate(day)) return '';
  return formatPhilippineDate(philippineDayBounds(day).startIso);
};

export function philippineDateRange(fromDate, toDate) {
  return { startIso: fromDate ? philippineDayBounds(fromDate).startIso : null,
    endIso: toDate ? philippineDayBounds(toDate).endIso : null };
}

export function isWithinPhilippineDateRange(value, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  const ms = timestampMs(value);
  if (!Number.isFinite(ms)) return false;
  try {
    const { startIso, endIso } = philippineDateRange(fromDate, toDate);
    return (!startIso || ms >= timestampMs(startIso)) && (!endIso || ms < timestampMs(endIso));
  } catch { return false; }
}

export function applyPhilippineDateFilter(query, fromDate, toDate, column = 'created_at') {
  const { startIso, endIso } = philippineDateRange(fromDate, toDate);
  if (startIso) query = query.gte(column, startIso);
  if (endIso) query = query.lt(column, endIso);
  return query;
}

// Ascending comparator; reverse the arguments for newest first. Missing or
// ambiguous legacy timestamps sort last rather than using the device timezone.
export function compareTimestamps(first, second) {
  const a = timestampMs(first), b = timestampMs(second);
  return (Number.isFinite(a) ? a : -Infinity) - (Number.isFinite(b) ? b : -Infinity) || 0;
}

export function formatPhilippineRelativeTime(value, now) {
  const then = timestampMs(value);
  if (!Number.isFinite(then)) return '';
  if (!Number.isFinite(now) || then > now) return formatPhilippineDateTime(value);
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

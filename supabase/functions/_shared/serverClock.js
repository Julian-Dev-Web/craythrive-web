import { timestampMs } from './philippineTime.js';

// performance.now() measures elapsed time and is unaffected by a changed wall
// clock. A stale/missing server anchor is unavailable, never device-time fallback.
export function createServerClock({ monotonicNow = () => performance.now(), maxAgeMs = 300000 } = {}) {
  let anchor = null;
  return {
    set(instant) {
      const ms = timestampMs(instant);
      if (!Number.isFinite(ms)) throw new Error('Invalid server timestamp.');
      anchor = { ms, tick: monotonicNow() };
    },
    clear() { anchor = null; },
    now() {
      if (!anchor) return null;
      const elapsed = monotonicNow() - anchor.tick;
      return elapsed >= 0 && elapsed <= maxAgeMs ? anchor.ms + elapsed : null;
    },
  };
}

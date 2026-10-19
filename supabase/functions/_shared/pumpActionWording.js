import { waterAutomationStatus } from './waterAutomationStatus.js';
import { getRecordedActionStatus } from './actionStatus.js';
// Presentation only. Requested duration_ms/seconds never proves actual runtime.
// Portable across Vite, Expo and Deno. No reads, writes or actuator commands.
const text = value => typeof value === 'string' ? value.trim() : '';
const key = value => text(value).toLowerCase().replace(/[\s-]+/g, '_');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const actions = /^(drain|drain_for|drain_water|drain_pump|pump_drain|auto_drain|refill|refill_for|fill|fill_water|add_water|refill_pump|pump_refill|auto_refill)$/;

export function getActualRefillDurationMs(record = {}) {
  record = object(record);
  const metadata = object(record.metadata);
  for (const source of [record, metadata]) {
    for (const [field, multiplier] of [['actual_duration_ms', 1], ['actual_duration_seconds', 1000]]) {
      const value = source[field];
      if ((typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
        && /^[+]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(String(value).trim())
        && Number.isFinite(Number(value)) && Number(value) > 0 && Number.isFinite(Number(value) * multiplier)) {
        return Number(value) * multiplier;
      }
    }
  }
  // Verified firmware acknowledgement contract, observed separately from the
  // requested duration_ms. Do not parse historical "pump ran for" alert text.
  for (const value of [record.result_message, record.notes, metadata.result_message, metadata.notes]) {
    const match = /^(?:REFILL relay command|REFILL_FOR) completed for ([+]?[0-9]+(?:\.[0-9]+)?)\s*ms\b/i.exec(text(value));
    if (match && Number.isFinite(Number(match[1])) && Number(match[1]) > 0) return Number(match[1]);
  }
  return null;
}

export function formatPumpAction(record = {}, source = '') {
  record = object(record);
  const metadata = object(record.metadata);
  const action = [record.command_type, record.action_type, record.action, record.control_action,
    record.command, record.type, metadata.command_type, metadata.action_type].map(key).find(value => actions.test(value));
  const title = text(record.title || record.alert_title || record.notification_title);
  // A recommendation such as "Add water needed" is not an execution event.
  const titleKind = /^(drain(?: water)?|refill|add water)\s+(?:completed|done|rejected|blocked|failed|command failed|cancelled|canceled|action recorded|pending|queued|running|executing)\b/i.exec(title)?.[1].toLowerCase();
  const kind = action ? action.includes('drain') ? 'drain' : 'refill'
    : titleKind ? titleKind.startsWith('drain') ? 'drain' : 'refill' : null;
  if (!kind) return null;

  // alerts.status is read/resolution state, not execution success. Explicit
  // execution status always wins over an old title/result containing completed.
  const automation = waterAutomationStatus(record, source);
  const status = automation?.rawStatus || getRecordedActionStatus({ ...record,
    status: action ? record.status : undefined, result: action ? record.result ?? record.state : undefined }, source)
    || (/rejected|blocked/i.test(title) ? 'rejected' : /failed|failure/i.test(title) ? 'failed'
      : /cancelled|canceled/i.test(title) ? 'cancelled' : /completed|\bdone\b/i.test(title) ? 'done' : 'recorded');
  const label = kind === 'drain' ? 'Drain' : 'Add Water';
  const actionLabel = kind === 'drain' ? 'drain' : 'refill';
  if (automation && !['completed', 'blocked', 'failed'].includes(automation.tone)) return {
    title: `${label} – ${automation.label}`, message: automation.message, status: automation.rawStatus, kind,
  };
  if (status === 'rechecking') return {
    title: `${label} – Executed – Rechecking`, message: `The ${actionLabel} pump was activated successfully. Fresh sensor readings are being evaluated to confirm the expected water-level change.`, status, kind,
  };
  if (['rejected', 'blocked'].includes(status)) return {
    title: `${label} rejected`, message: `The ${actionLabel} action was blocked by a safety rule.`, status: 'rejected', kind,
  };
  if (['failed', 'error'].includes(status)) return {
    title: `${label} failed`, message: `The ${actionLabel} action could not be completed.`, status: 'failed', kind,
  };
  if (!['done', 'completed', 'success', 'succeeded'].includes(status)) return {
    title: `${label} ${status}`, message: `The ${actionLabel} action is ${status}.`, status, kind,
  };

  let message = `The ${actionLabel} pump was activated.`;
  const actualDurationMs = kind === 'refill' ? getActualRefillDurationMs(record) : null;
  if (actualDurationMs !== null) {
    const seconds = actualDurationMs / 1000;
    const rounded = Number(seconds.toFixed(3));
    const milliseconds = Number(actualDurationMs.toPrecision(3));
    const duration = seconds < 0.001 ? `${milliseconds} ${milliseconds === 1 ? 'millisecond' : 'milliseconds'}`
      : `${rounded} ${rounded === 1 ? 'second' : 'seconds'}`;
    message = `The refill pump ran for ${duration}.`;
  }
  return { title: `${label} completed`, message, status: 'done', kind,
    ...(actualDurationMs === null ? {} : { actual_duration_ms: actualDurationMs }) };
}

export function formatPumpAlert(record) {
  const formatted = formatPumpAction(record);
  // Return presentation text only: never replace alerts.status/is_read or
  // mutate the original command, duration, notes or metadata.
  return formatted ? { title: formatted.title, message: formatted.message }
    : { title: record?.title, message: record?.message };
}

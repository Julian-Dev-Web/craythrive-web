// Saved status is authoritative for presentation. Never derive an outcome from
// reason text, acknowledgement wording, timestamps, or missing unrelated fields.
const normalize = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';

export function getRecordedActionStatus(row = {}, source = '') {
  const metadata = row.metadata || {};
  const device = source === 'device_commands' || !source && !!row.command_type && !row.action_type;
  const saved = device ? row.command_status : source === 'tank_automation_logs' ? row.action_status : row.action_status ?? row.command_status;
  const legacy = row.status ?? row.result;
  const notificationState = ['active', 'resolved', 'read', 'unread', 'open', 'handled', 'dismissed'].includes(normalize(legacy));
  const embedded = device ? metadata.command_status ?? metadata.action_status : metadata.action_status ?? metadata.command_status;
  return normalize(saved ?? (notificationState ? embedded ?? legacy : legacy ?? embedded));
}

export function getActionStatusPresentation(row = {}, source = '', automatic = false) {
  const rawStatus = getRecordedActionStatus(row, source);
  const states = {
    done: ['Completed', 'completed', automatic
      ? 'The automatic action completed and the expected water-level movement was confirmed.'
      : 'The actuator action completed.'],
    rechecking: ['Executed – Rechecking', 'rechecking', 'The pump action was executed. Fresh sensor readings are still being checked.'],
    blocked: ['Blocked', 'blocked', 'The action was intentionally blocked by a safety rule.'],
    rejected: ['Rejected', 'rejected', 'The action was intentionally blocked by a safety rule.'],
    skipped: ['Skipped', 'skipped', 'The action was intentionally skipped.'],
    cancelled: ['Cancelled', 'cancelled', 'The action was cancelled.'],
    failed: ['Failed', 'failed', 'The actuator action could not be completed.'],
    running: ['In Progress', 'progress', 'The actuator action is in progress.'],
    pending: ['Pending Verification', 'pending', 'The action is pending verification.'],
  };
  const aliases = { completed: 'done', success: 'done', succeeded: 'done', error: 'failed', started: 'running', executing: 'running', processing: 'running',
    queued: 'pending', sent: 'pending', requested: 'pending', acknowledged: 'pending', canceled: 'cancelled' };
  const key = Object.hasOwn(aliases, rawStatus) ? aliases[rawStatus] : rawStatus;
  const [label, tone, message] = Object.hasOwn(states, key) ? states[key]
    : ['Unknown / Unconfirmed', 'unknown', 'The recorded action status is unknown or unavailable.'];
  return { rawStatus, label, tone, message };
}

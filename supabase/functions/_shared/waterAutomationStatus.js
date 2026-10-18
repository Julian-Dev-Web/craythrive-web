// Presentation only: trust the recorded automation outcome, never infer a
// successful water correction from elapsed time or a requested pump duration.
const text = value => typeof value === 'string' ? value.trim() : '';
export function waterAutomationStatus(row = {}, source = '') {
  const metadata = row.metadata || {};
  const action = text(row.action_type || metadata.action_type || row.command_type || metadata.command_type).toUpperCase();
  const automatic = /^AUTO_(REFILL|DRAIN)$/.test(action)
    || (row.command_value === 'auto' && /REFILL|DRAIN/.test(action));
  if (!automatic) return null;
  const reason = text(row.reason || row.notes || row.result_message || metadata.notes || row.message);
  const originalStatus = /Auto action status:\s*([\w-]+)/i.exec(reason)?.[1];
  const raw = text(source === 'tank_automation_logs' ? row.action_status
    : row.action_status || metadata.action_status || originalStatus || row.command_status).toLowerCase();
  const isMirror = source === 'device_commands' || (row.command_value === 'auto' && !row.action_type);
  const pump = /DRAIN/.test(action) ? 'drain' : 'refill';
  const states = {
    done: ['Completed', 'completed', `The expected water-level effect was reported as confirmed by the actuator.`],
    rechecking: ['Executed – Rechecking', 'rechecking', `The ${pump} pump was activated successfully. Fresh sensor readings are being evaluated to confirm the expected water-level change before another automatic water action.`],
    blocked: ['Blocked', 'blocked', 'The action was prevented by a safety or control rule.'],
    skipped: ['Skipped', 'skipped', 'The action was intentionally skipped.'],
  };
  // Older failed rows may describe an inconclusive sensor check rather than
  // an interrupted actuator. Preserve their raw reason without claiming either
  // physical failure or successful execution when that evidence is absent.
  const executionFailure = /(?:actuator|pump|relay|execution|action).{0,25}interrupt|interrupt.{0,25}(?:actuator|pump|relay|execution|action)|stop[_ ]?all|stop command|emergency stop|safety.{0,25}abort|abort.{0,25}(?:execution|pump|action)|(?:actuator|pump|relay|control|execution|action).{0,35}(?:could not|cannot|unable|failed to).{0,25}(?:execute|complete|start|activate)|execution (?:error|failed)|hardware (?:error|fault)/i.test(reason);
  let state = Object.hasOwn(states, raw) ? states[raw] : null;
  if (raw === 'failed' && executionFailure) state = ['Failed', 'failed', 'The actuator action could not complete. See the recorded reason.'];
  if (raw === 'done' && isMirror && !originalStatus && !metadata.action_status) state = null;
  const [label, tone, message] = state || ['Pending Verification', 'pending',
    raw === 'failed' ? 'The saved reason does not confirm an actuator execution failure. Check the recorded sensor verification details.'
      : 'The automatic action result has not been verified.'];
  return { rawStatus: raw, label, tone, message, pump };
}

export function automationLogId(row = {}) {
  const metadata = row.metadata || {};
  return String(row.automation_log_id || row.tank_automation_log_id || row.auto_log_id
    || metadata.automation_log_id || metadata.tank_automation_log_id || metadata.auto_log_id
    || /Auto log id:\s*([\w-]+)/i.exec(text(row.result_message || row.notes || row.reason || row.message || metadata.result_message || metadata.notes))?.[1] || '');
}

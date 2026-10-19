import { getRecordedActionStatus } from './actionStatus.js';

export const STOP_COMMAND = 'STOP_ALL';
export const RESUME_COMMAND = 'RESUME_CONTROLS';
export const ACTIVE_COMMAND_STATUSES = ['pending', 'running', 'processing'];
export function isCommandActive(command) {
  return !!command && ACTIVE_COMMAND_STATUSES.includes(getRecordedActionStatus(command, 'device_commands'));
}
export function isCommandTerminal(command) {
  return !!command && ['done', 'completed', 'rejected', 'failed', 'cancelled', 'canceled', 'skipped'].includes(getRecordedActionStatus(command, 'device_commands'));
}
export function commandResultReason(command) {
  const reason = String(command?.result_message || command?.reason || command?.notes || '').replace(/^FEED_ONCE rejected:\s*/i, '').trim();
  return reason ? reason[0].toUpperCase() + reason.slice(1) : '';
}

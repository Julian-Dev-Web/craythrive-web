import { getActionStatusPresentation } from './actionStatus.js';
// Presentation only: the source table's saved status wins over diagnostic text.
const text = value => typeof value === 'string' ? value.trim() : '';
export function waterAutomationStatus(row = {}, source = '') {
  const metadata = row.metadata || {};
  const action = text(row.action_type || metadata.action_type || row.command_type || metadata.command_type).toUpperCase();
  const automatic = /^AUTO_(REFILL|DRAIN)$/.test(action)
    || (row.command_value === 'auto' && /REFILL|DRAIN/.test(action));
  if (!automatic) return null;
  const pump = /DRAIN/.test(action) ? 'drain' : 'refill';
  const automaticResult = source !== 'device_commands' && (!row.command_type || !!row.action_type);
  return { ...getActionStatusPresentation(row, source, automaticResult), pump };
}

export function automationLogId(row = {}) {
  const metadata = row.metadata || {};
  return String(row.automation_log_id || row.tank_automation_log_id || row.auto_log_id
    || metadata.automation_log_id || metadata.tank_automation_log_id || metadata.auto_log_id
    || /Auto log id:\s*([\w-]+)/i.exec(text(row.result_message || row.notes || row.reason || row.message || metadata.result_message || metadata.notes))?.[1] || '');
}

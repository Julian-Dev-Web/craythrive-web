import { formatPumpAction } from './pumpActionWording.js';
import { formatWaterDepthAlert } from './waterDepthDisplay.js';
import { waterAutomationStatus } from './waterAutomationStatus.js';

// An action verification notification is informational. Independent sensor
// alerts keep their saved severity and are never suppressed by pump status.
export function waterAutomationAlertSeverity(record) {
  if (/sensor|ammonia/.test(String(record?.type || '').toLowerCase())) return null;
  const automation = waterAutomationStatus(record);
  return automation?.tone === 'rechecking' || automation?.tone === 'pending' ? 'info' : null;
}

export function formatMonitoringAlert(record) {
  // These are already rendered by the persistent automation-alert pipeline.
  // Preserve its specific automatic title/reason rather than relabeling it as a
  // generic Add Water/Drain command notification.
  if (record?.source === 'tank_automation_logs' && record.metadata?.water_activity_version === 1) {
    return { title: record.title, message: record.message };
  }
  const pump = formatPumpAction(record);
  return pump ? { title: pump.title, message: pump.message,
    ...(waterAutomationAlertSeverity(record) ? { severity: 'info' } : {}) } : formatWaterDepthAlert(record || {});
}

import { formatPumpAction } from './pumpActionWording.js';
import { formatWaterDepthAlert } from './waterDepthDisplay.js';

export function formatMonitoringAlert(record) {
  const pump = formatPumpAction(record);
  return pump ? { title: pump.title, message: pump.message } : formatWaterDepthAlert(record || {});
}

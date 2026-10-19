import { compareTimestamps, formatPhilippineDateTime, timestampMs } from './philippineTime.js';
import { getSensorInspectionAction } from './sensorRecommendations.js';
import { formatSensorSafeRange } from './sensorSafeRanges.js';
import { formatPumpAction } from './pumpActionWording.js';
import { formatWaterDepth, formatWaterDepthAlert, recordedWaterDepth } from './waterDepthDisplay.js';
import { formatMonitoringAlert } from './monitoringAlertPresentation.js';
import { formatRecordedFeedingAction } from './feederControl.js';
import { automationLogId, waterAutomationStatus } from './waterAutomationStatus.js';
import { getActionStatusPresentation, getRecordedActionStatus } from './actionStatus.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const code = value => text(value).toLowerCase().replace(/[\s-]+/g, '_');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
const names = { temperature: 'Temperature', ph: 'pH', waterLevel: 'Water level', turbidity: 'Water clarity', ammonia: 'Ammonia' };
const units = { temperature: '°C', ph: '', waterLevel: 'cm', turbidity: 'V', ammonia: 'mg/L' };
export const ACTIVITY_CATEGORIES = { sensor: 'Sensor conditions', feeding: 'Feeding', water: 'Water control',
  ammonia: 'Ammonia results', thresholds: 'Threshold changes', device: 'Device connection', other: 'Other activity' };

function parameterFor(row) {
  const metadata = object(row.metadata);
  const explicit = metadata.parameter || metadata.sensor_snapshot?.parameter;
  if (['water_level', 'water_depth', 'water_depth_cm'].includes(explicit)) return 'waterLevel';
  if (Object.hasOwn(names, explicit)) return explicit;
  const value = code(`${row.type || ''} ${row.title || ''} ${row.action_type || ''}`);
  if (/ammonia/.test(value)) return 'ammonia';
  if (/temperature/.test(value)) return 'temperature';
  if (/(^|_)ph(_|$)/.test(value)) return 'ph';
  if (/turbidity|clarity/.test(value)) return 'turbidity';
  if (/water_level|water_depth/.test(value)) return 'waterLevel';
  return null;
}

function recordedSeverity(row) {
  const value = code(row.severity);
  return ['critical', 'danger', 'unsafe'].includes(value) ? 'critical'
    : value === 'warning' ? 'warning' : ['normal', 'safe', 'success'].includes(value) ? 'normal' : 'no-data';
}

// Used only by the existing feeding verification guard, never by status labels.
export function hasRecordedCommandAcknowledgement(row) {
  const note = text(row.result_message || row.notes || row.reason);
  return ['done', 'completed', 'success', 'succeeded'].includes(code(row.command_status))
    && Number.isFinite(timestampMs(row.executed_at))
    && /^(?:FEED_ONCE completed\.|(?:REFILL_FOR|DRAIN_FOR) completed for \d+ ms\.|STOP_ALL executed[. ])/i.test(note)
    && !/Auto log id:/i.test(note);
}

export function getRecordedActionOutcome(row, source = '') {
  const status = getRecordedActionStatus(row, source);
  if (source === 'control_logs' && row.action_type === 'threshold_updated' && ['', 'updated'].includes(status)) return 'Completed';
  return getActionStatusPresentation(row, source).label;
}

function actionFor(row) {
  const action = code(row.command_type || row.action_type || row.type);
  if (/feed/.test(action)) return /scheduled/.test(action) ? 'Scheduled feeding'
    : /auto/.test(action) || row.command_value === 'auto' ? 'Automatic feeding' : /manual/.test(action) ? 'Manual feeding' : 'Feeding';
  if (/refill|fill|add_water/.test(action)) return /auto/.test(action) || row.command_value === 'auto' ? 'Automatic water refill' : 'Manual water refill';
  if (/drain/.test(action)) return /auto/.test(action) || row.command_value === 'auto' ? 'Automatic water draining' : 'Manual water draining';
  if (/stop/.test(action)) return 'Stop equipment';
  return text(row.action_type || row.command_type).replaceAll('_', ' ') || 'Tank activity';
}

export function formatRecordedPumpAction(row, source = '') {
  const pump = formatPumpAction(row, source);
  if (!pump) return null;
  const automation = waterAutomationStatus(row, source);
  if (automation) return { ...pump, message: automation.message };
  const presentation = getActionStatusPresentation(row, source);
  if (presentation.tone === 'unknown') return { ...pump,
    title: `${pump.kind === 'drain' ? 'Drain' : 'Add Water'} recorded`,
    message: presentation.message };
  return pump;
}

// Only saved event evidence is accepted. Current settings/readings are never an
// input: changing today's thresholds cannot rewrite a historical event.
export function buildTankActivity({ tank, userId, sources = {} }) {
  if (!tank?.id || tank.user_id !== userId) return [];
  const rows = Object.entries(sources).flatMap(([source, items]) => (Array.isArray(items) ? items : [])
    .filter(row => row?.id && row.user_id === userId && String(row.tank_id) === String(tank.id))
    .map(row => ({ source, row })));
  const lookup = source => new Set(rows.filter(item => item.source === source).map(item => String(item.row.id)));
  const commands = lookup('device_commands'), controls = lookup('control_logs'), scans = lookup('ammonia_readings'), autos = lookup('tank_automation_logs');
  const scanAlerts = new Map(rows.filter(item => item.source === 'alerts' && scans.has(String(item.row.metadata?.ammonia_reading_id)))
    .sort((a, b) => compareTimestamps(a.row.created_at, b.row.created_at))
    .map(item => [String(item.row.metadata.ammonia_reading_id), item.row]));
  const events = new Map();
  const sourcePriority = { tank_automation_logs: 0, device_commands: 1, control_logs: 2, alerts: 3 };
  for (const { source, row } of rows) {
    const metadata = object(row.metadata);
    if (source !== 'tank_automation_logs' && autos.has(automationLogId(row))) continue;
    if (source === 'control_logs' && commands.has(String(row.command_id || metadata.command_id))) continue;
    if (source === 'alerts' && (commands.has(String(row.command_id || metadata.command_id))
      || controls.has(String(metadata.control_log_id)) || scans.has(String(metadata.ammonia_reading_id)))) continue;

    const parameter = parameterFor(row);
    const savedSnapshot = object(metadata.sensor_snapshot);
    const event = { id: `${source}:${row.id}`, source, tankId: tank.id,
      tankName: tank.tank_name || tank.name || 'Tank', timestamp: row.created_at,
      timestampLabel: formatPhilippineDateTime(row.created_at, {}, 'Timestamp unavailable'),
      severity: recordedSeverity(row), outcome: null, title: text(row.title) || actionFor(row),
      category: 'other', reason: text(row.reason || row.result_message || row.notes || row.message),
      action: null, result: null, reading: null, threshold: null, recommendation: null, parameter };
    if (source === 'device_commands' || source === 'control_logs' || source === 'tank_automation_logs') {
      event.action = actionFor(row);
      event.outcome = getRecordedActionOutcome(row, source);
      const kind = code(row.command_type || row.action_type);
      event.category = /feed/.test(kind) ? 'feeding' : /drain|refill|pump|fill|stop/.test(kind) ? 'water' : 'other';
      event.title = event.action;
      const presentation = getActionStatusPresentation(row, source);
      event.outcomeTone = presentation.tone;
      event.result = presentation.message;
      const pump = formatRecordedPumpAction(row, source);
      const automation = waterAutomationStatus(row, source);
      if (automation) {
        event.outcomeTone = automation.tone;
        event.severity = 'no-data';
        event.result = automation.message;
        event.reason = event.reason.replace(/\s*\|\s*Auto (?:log id|action status):[^|]*/gi, '').trim();
      }
      if (source === 'tank_automation_logs') {
        event.reason = text(row.reason);
        event.context = ['water_status', 'ph_status', 'turbidity_status', 'temperature_status', 'ammonia_status', 'stable_reading_count', 'duration_seconds']
          .filter(key => row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== '')
          .map(key => ({ label: key.replaceAll('_', ' '), value: String(row[key]) }));
      }
      if (pump && !automation) event.reason = ['Completed', 'Unknown / Unconfirmed'].includes(event.outcome)
        ? pump.message : [pump.message, event.reason].filter(Boolean).join(' ');
      const feeding = formatRecordedFeedingAction(row, event.outcome);
      if (feeding) {
        event.outcome = feeding.outcome;
        event.dispenseCycles = feeding.cycles;
        event.result = feeding.message;
      }
      if (kind === 'threshold_updated') {
        event.category = 'thresholds'; event.title = 'Threshold Updated'; event.action = 'Saved threshold settings';
        event.result = metadata.source === 'ai_recommendation' ? 'AI recommendation accepted by user' : 'Updated';
        if (event.outcome === 'Completed') event.outcomeTone = 'completed';
      }
      if (/device_(connected|disconnected|online|offline)/.test(kind)) event.category = 'device';
    } else if (source === 'ammonia_readings') {
      const alert = scanAlerts.get(String(row.id));
      const value = [row.ammonia_mg_l, row.ammonia_level, row.ammonia, row.ammonia_ppm, row.ammonia_value].map(finite).find(value => value !== null);
      event.category = 'ammonia'; event.title = 'Ammonia result recorded';
      event.reading = value === undefined ? null : `${value} mg/L`;
      event.reason = text(row.message) || 'A manual test or scan was recorded. This is historical evidence, not a live reading.';
      event.severity = alert ? recordedSeverity(alert) : 'no-data';
      event.result = alert?.message || (text(row.ammonia_status || row.status) ? `Recorded classification: ${row.ammonia_status || row.status}` : 'Historical classification was not recorded.');
    } else if (source === 'alerts') {
      const presentation = formatMonitoringAlert(row);
      event.title = presentation.title || event.title;
      event.reason = presentation.message || event.reason;
      event.category = /sensor|ammonia/.test(code(row.type)) ? 'sensor' : /device.*(connect|online|offline)/.test(code(row.type || row.title)) ? 'device' : 'other';
      if (row.command_id || metadata.command_type || code(row.type) === 'control_log') {
        const recorded = { ...row, ...metadata, command_status: row.command_status ?? metadata.command_status, action_status: row.action_status ?? metadata.action_status };
        const kind = code(recorded.command_type || recorded.action_type);
        event.category = /feed/.test(kind) ? 'feeding' : /drain|refill|pump|fill|stop/.test(kind) ? 'water' : 'other';
        event.title = actionFor(recorded);
        event.action = event.title;
        const automation = waterAutomationStatus(recorded);
        event.outcome = getRecordedActionOutcome(recorded, metadata.command_type ? 'device_commands' : 'control_logs');
        if (automation) {
          event.outcomeTone = automation.tone; event.severity = 'no-data';
          event.reason = text(metadata.reason || metadata.notes || row.reason || row.message)
            .replace(/\s*\|\s*Auto (?:log id|action status):[^|]*/gi, '').trim();
        }
        event.outcomeTone = getActionStatusPresentation(recorded).tone;
        event.result = getActionStatusPresentation(recorded).message;
        if (automation) event.result = automation.message;
        const feeding = formatRecordedFeedingAction(recorded, event.outcome);
        if (feeding) { event.dispenseCycles = feeding.cycles; event.outcome = feeding.outcome; }
      }
      const recovery = code(row.type) === 'sensor_recovery' || metadata.event_type === 'sensor_recovery';
      if (recovery) { event.severity = 'normal'; event.result = 'A recovery event was recorded by the backend.'; }
      // Handled/resolved does not establish physical sensor recovery.
      if (!recovery && row.status === 'resolved') event.result = 'Alert marked handled; sensor recovery was not independently recorded.';
    }
    const savedValue = parameter === 'waterLevel' ? recordedWaterDepth(row) : finite(savedSnapshot.value);
    if (savedValue !== null && parameter) event.reading = parameter === 'waterLevel'
      ? formatWaterDepth(savedValue, null) : `${savedValue}${units[parameter] ? ` ${units[parameter]}` : ''}`;
    if (parameter === 'waterLevel' && source !== 'alerts' && event.category !== 'thresholds') {
      event.reason = formatWaterDepthAlert({ ...row, title: event.title, message: event.reason }).message;
    }
    // Render only explicitly saved, complete safe-limit snapshots. No default
    // normalization is allowed to fill historical gaps with today's values.
    const required = { temperature: ['temperatureMin', 'temperatureMax'], ph: ['phMin', 'phMax'],
      waterLevel: ['waterLevelMin'], turbidity: ['turbidityMax'], ammonia: ['ammoniaMax'] }[parameter];
    const savedLimits = object(savedSnapshot.thresholds);
    if (required?.every(key => finite(savedLimits[key]) !== null)) event.threshold = formatSensorSafeRange(parameter, savedLimits);
    if (['warning', 'critical'].includes(event.severity) && parameter) {
      event.recommendation = text(metadata.recommendation?.action) || getSensorInspectionAction(parameter, event.severity);
      event.recommendationLabel = text(metadata.recommendation?.action) ? 'Recorded recommendation' : 'Inspection guidance';
    }
    if (event.category === 'device') event.outcome = null;
    // Preserve a single canonical card even if only repeated command/alert
    // mirrors are available while the full automation RPC is unavailable.
    const linkedId = automationLogId(row);
    const key = linkedId ? `automation:${linkedId}` : event.id;
    const previous = events.get(key);
    if (!previous || sourcePriority[source] < sourcePriority[previous.source]
      || sourcePriority[source] === sourcePriority[previous.source] && compareTimestamps(event.timestamp, previous.timestamp) >= 0) events.set(key, event);
  }
  return [...events.values()].sort((a, b) => compareTimestamps(b.timestamp, a.timestamp) || a.id.localeCompare(b.id));
}

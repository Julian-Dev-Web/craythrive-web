import { AMMONIA_READING_FIELDS } from "../constants/schema";
import { normalizeSensorReading, toNumberOrNull } from "./sensorReadingUtils";
import { evaluateReadingSafety, getLocalThresholds } from "./thresholdEvaluation";
import { getSafetySeverity, getSafetyStatusLabel } from "./statusHelpers";

const keys = values => values.filter(value => value !== null && value !== undefined && value !== "").map(String);
export const getMonitoringTankKeys = tank => keys([
  tank?.id, tank?.tank_id, tank?.uuid, tank?.device_uid, tank?.device_id, tank?.iot_device_id, tank?.tank_code,
]);
export const getMonitoringRecordKeys = row => keys([
  row?.tank_id, row?.tankId, row?.tank_uuid, row?.tank_profile_id, row?.device_uid, row?.device_id, row?.iot_device_id,
]);
export const getMonitoringDate = row => row?.created_at || row?.timestamp || row?.date || row?.updated_at || null;
const dateTime = row => new Date(getMonitoringDate(row) || 0).getTime() || 0;

export function getAmmoniaNumericValue(row) {
  for (const field of [AMMONIA_READING_FIELDS.VALUE, ...AMMONIA_READING_FIELDS.VALUE_FALLBACKS, "value", "ppm"]) {
    const value = toNumberOrNull(row?.[field]);
    if (value !== null) return value;
  }
  return null;
}

export function recordMatchesMonitoringTank(row, tank) {
  const tankKeys = getMonitoringTankKeys(tank);
  const references = keys([row?.tank_id, row?.tankId, row?.tank_uuid, row?.tank_profile_id]);
  if (references.length) return references.some(key => tankKeys.includes(key));
  return getMonitoringRecordKeys(row).some(key => tankKeys.includes(key));
}

export function findMonitoringTank(row, tanks) {
  // Prefer an explicit tank reference before considering device aliases.
  const references = keys([row?.tank_id, row?.tankId, row?.tank_uuid, row?.tank_profile_id]);
  return tanks.find(tank => references.some(key => keys([tank?.id, tank?.tank_id, tank?.uuid]).includes(key)))
    || tanks.find(tank => recordMatchesMonitoringTank(row, tank)) || null;
}

export function getMonitoringTankKey(row, tanks) {
  const tank = findMonitoringTank(row, tanks);
  return getMonitoringTankKeys(tank)[0] || getMonitoringRecordKeys(row)[0]
    || `unmatched:${row?.id || getMonitoringDate(row) || "unknown"}`;
}

export function getLatestAmmoniaForTank(tank, rows) {
  return rows.filter(row => recordMatchesMonitoringTank(row, tank)).sort((a, b) => dateTime(b) - dateTime(a))[0] || null;
}

export function getAmmoniaLabel(value) {
  return value === null || value === undefined ? "No Scan" : `${Number(value).toFixed(2)} mg/L`;
}

export function buildMonitoringRecords(waterRows, ammoniaRows, tanks, thresholds = getLocalThresholds()) {
  const enrich = (reading, type, index) => {
    const tank = findMonitoringTank(reading, tanks);
    const tankName = tank?.name || tank?.tank_name || tank?.title || tank?.label || tank?.display_name
      || reading?.tank_name || reading?.tank_label || reading?.tank_display_name || "Unmatched tank";
    const ammoniaValue = type === "Ammonia Reading" ? getAmmoniaNumericValue(reading) : null;
    const normalized = type === "Water Reading"
      ? normalizeSensorReading(reading, thresholds)
      : { ...normalizeSensorReading(null), raw: reading,
        safety: evaluateReadingSafety({ ammonia: ammoniaValue }, thresholds),
        createdAt: getMonitoringDate(reading) };
    return {
      reading, normalized, type, index, recordId: `${type}:${reading.id || index}`,
      tankName: String(tankName), name: String(tankName), tankKey: getMonitoringTankKey(reading, tanks),
      date: getMonitoringDate(reading), ammoniaValue, ammoniaLabel: getAmmoniaLabel(ammoniaValue),
      status: getSafetySeverity(normalized.safety),
    };
  };
  return [...waterRows.map((row, index) => enrich(row, "Water Reading", index)),
    ...ammoniaRows.map((row, index) => enrich(row, "Ammonia Reading", index))]
    .sort((a, b) => dateTime(b.reading) - dateTime(a.reading));
}

// Only current summaries combine independent readings; history never does.
export function evaluateCurrentTankSafety(waterRecord, ammoniaRecord, thresholds = getLocalThresholds()) {
  const normalized = waterRecord?.normalized;
  const sameTank = !waterRecord || !ammoniaRecord || waterRecord.tankKey === ammoniaRecord.tankKey;
  return evaluateReadingSafety({
    temperature: normalized?.temperatureValue, ph: normalized?.phValue,
    turbidityVoltage: normalized?.turbidityValue, waterDepth: normalized?.waterValue,
    ammonia: sameTank ? ammoniaRecord?.ammoniaValue : undefined,
  }, thresholds);
}

export function buildTankHistoryExportRows(records, formatDate = value => value || "") {
  return records.map(item => {
    const water = item.type === "Water Reading";
    const parameters = item.normalized.safety.parameters;
    const condition = key => getSafetyStatusLabel(parameters[key]?.severity);
    return {
      Type: item.type, Tank: item.tankName,
      Temperature: water ? item.normalized.temperatureLabel : "",
      "Temperature Condition": water ? condition("temperature") : "",
      pH: water ? item.normalized.phNumberLabel : "",
      "pH Condition": water ? condition("ph") : "",
      "Water Clarity": water ? item.normalized.turbidityNumberLabel : "",
      "Water Clarity Condition": water ? condition("turbidity") : "",
      "Water Level": water ? item.normalized.waterLabel : "",
      "Water Level Condition": water ? condition("waterLevel") : "",
      Ammonia: water ? "" : item.ammoniaLabel,
      "Ammonia Condition": water ? "" : item.ammoniaValue === null ? "No Scan" : condition("ammonia"),
      "Overall Condition": getSafetyStatusLabel(item.status), Date: formatDate(item.date),
    };
  });
}

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
// A scan is an event. Editing its metadata must not change when it was scanned.
export const getAmmoniaScanDate = row => row?.created_at || null;

export function getAmmoniaNumericValue(row) {
  for (const field of [AMMONIA_READING_FIELDS.VALUE, ...AMMONIA_READING_FIELDS.VALUE_FALLBACKS, "value", "ppm"]) {
    const value = toNumberOrNull(row?.[field]);
    if (value !== null) return value;
  }
  return null;
}

export function recordMatchesMonitoringTank(row, tank) {
  const references = keys([row?.tank_id, row?.tankId, row?.tank_uuid, row?.tank_profile_id]);
  if (references.length) return references.some(key => keys([tank?.id, tank?.tank_id, tank?.uuid]).includes(key));
  const tankKeys = getMonitoringTankKeys(tank);
  return getMonitoringRecordKeys(row).some(key => tankKeys.includes(key));
}

// A manual scan needs a tank reference; a reused device is not evidence that
// the scan belongs to the device's current tank.
export function recordMatchesAmmoniaTank(row, tank) {
  return keys([row?.tank_id, row?.tankId, row?.tank_uuid, row?.tank_profile_id]).length > 0
    && recordMatchesMonitoringTank(row, tank);
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
  return rows.filter(row => recordMatchesAmmoniaTank(row, tank))
    .sort((a, b) => (new Date(getAmmoniaScanDate(b) || 0).getTime() || 0) - (new Date(getAmmoniaScanDate(a) || 0).getTime() || 0))[0] || null;
}

export function getAmmoniaLabel(value) {
  return value === null || value === undefined ? "No Scan" : `${Number(value).toFixed(2)} mg/L`;
}

export function buildMonitoringRecords(waterRows, ammoniaRows, tanks, thresholds = getLocalThresholds()) {
  const enrich = (reading, type, index) => {
    const tank = type === "Ammonia Reading" ? tanks.find(tank => recordMatchesAmmoniaTank(reading, tank)) : findMonitoringTank(reading, tanks);
    const tankName = tank?.name || tank?.tank_name || tank?.title || tank?.label || tank?.display_name
      || reading?.tank_name || reading?.tank_label || reading?.tank_display_name || "Unmatched tank";
    const ammoniaValue = type === "Ammonia Reading" ? getAmmoniaNumericValue(reading) : null;
    const date = type === "Ammonia Reading" ? getAmmoniaScanDate(reading) : getMonitoringDate(reading);
    const normalized = type === "Water Reading"
      ? normalizeSensorReading(reading, thresholds)
      : { ...normalizeSensorReading(null), raw: reading,
        safety: evaluateReadingSafety({ ammonia: ammoniaValue }, thresholds),
        createdAt: date };
    return {
      reading, normalized, type, index, recordId: `${type}:${reading.id || index}`,
      tankName: String(tankName), name: String(tankName), tankKey: type === "Ammonia Reading"
        ? getMonitoringTankKeys(tank)[0] || keys([reading?.tank_id, reading?.tankId, reading?.tank_uuid, reading?.tank_profile_id])[0] || `unmatched:${reading?.id || index}`
        : getMonitoringTankKey(reading, tanks),
      date, ammoniaValue, ammoniaLabel: getAmmoniaLabel(ammoniaValue),
      status: getSafetySeverity(normalized.safety),
    };
  };
  return [...waterRows.map((row, index) => enrich(row, "Water Reading", index)),
    ...ammoniaRows.map((row, index) => enrich(row, "Ammonia Reading", index))]
    .sort((a, b) => (new Date(b.date || 0).getTime() || 0) - (new Date(a.date || 0).getTime() || 0));
}

export function getCurrentTankSnapshot(records, tank = null, thresholds = getLocalThresholds()) {
  const scoped = tank ? records.filter(item => (item.type === "Ammonia Reading" ? recordMatchesAmmoniaTank : recordMatchesMonitoringTank)(item.reading, tank)) : records;
  const sorted = [...scoped].sort((a, b) => (new Date(b.date || 0).getTime() || 0) - (new Date(a.date || 0).getTime() || 0));
  const waterRecord = sorted.find(item => item.type === "Water Reading") || null;
  const anchor = waterRecord || sorted.find(item => item.type === "Ammonia Reading");
  const ammoniaRecord = sorted.find(item => item.type === "Ammonia Reading" && (!anchor || item.tankKey === anchor.tankKey)) || null;
  return { waterRecord, ammoniaRecord,
    tankName: tank?.name || tank?.tank_name || tank?.title || anchor?.tankName || "No tank selected",
    tankId: tank?.id || tank?.tank_id || null,
    safety: evaluateCurrentTankSafety(waterRecord, ammoniaRecord, thresholds) };
}

export function buildTankSnapshotExportRows(snapshots, formatDate = value => value || "") {
  return snapshots.map(({ tankName, waterRecord, ammoniaRecord, safety }) => {
    const reading = waterRecord?.normalized;
    const condition = key => getSafetyStatusLabel(safety.parameters[key]?.severity);
    return { Type: "Current Tank Status", Tank: tankName,
      Temperature: reading?.temperatureLabel || "No Data", "Temperature Condition": condition("temperature"),
      pH: reading?.phNumberLabel || "No Data", "pH Condition": condition("ph"),
      "Water Clarity": reading?.turbidityNumberLabel || "No Data", "Water Clarity Condition": condition("turbidity"),
      "Water Level": reading?.waterLabel || "No Data", "Water Level Condition": condition("waterLevel"),
      "Sensor Date": waterRecord?.date ? formatDate(waterRecord.date) : "",
      Ammonia: ammoniaRecord?.ammoniaLabel || "No Scan",
      "Ammonia Condition": ammoniaRecord?.ammoniaValue != null ? condition("ammonia") : "No Scan",
      "Ammonia Scan Date": ammoniaRecord?.date ? formatDate(ammoniaRecord.date) : "",
      "Ammonia Source": "Latest available manual scan",
      "Overall Condition": getSafetyStatusLabel(getSafetySeverity(safety)),
    };
  });
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

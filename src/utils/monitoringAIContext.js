import { getCurrentTankSnapshot } from "./monitoringRecords";
import { getSafetySeverity, getSafetyStatusLabel } from "./statusHelpers";
import { evaluateReadingSafety, getLocalThresholds, resolveTankThresholds } from "./thresholdEvaluation";

// Integration contract for an AI caller. No AI endpoint exists in this web repo.
export function buildMonitoringAIContext({ records, tank, thresholds = getLocalThresholds(), historyLimit = 10 }) {
  const snapshot = getCurrentTankSnapshot(records, tank, thresholds);
  const anchor = snapshot.waterRecord || snapshot.ammoniaRecord;
  thresholds = resolveTankThresholds(thresholds, tank?.id || anchor?.tankKey);
  const scoped = records.filter(item => anchor && item.tankKey === anchor.tankKey)
    .sort((a, b) => (new Date(b.date || 0).getTime() || 0) - (new Date(a.date || 0).getTime() || 0));
  const sensor = item => item ? { timestamp: item.date,
    temperature: item.normalized.temperatureValue, ph: item.normalized.phValue,
    water_clarity: item.normalized.turbidityValue, water_level: item.normalized.waterValue,
    water_sensor_health: item.normalized.safety.parameters.waterLevel.health,
    water_value_source: item.normalized.safety.parameters.waterLevel.valueSource,
    water_measurement_fresh: item.normalized.safety.parameters.waterLevel.measurementFresh,
    water_last_good_age_ms: item.normalized.safety.parameters.waterLevel.lastGoodAgeMs,
    condition: getSafetyStatusLabel(getSafetySeverity(evaluateReadingSafety({
      temperature: item.normalized.temperatureValue, ph: item.normalized.phValue,
      turbidityVoltage: item.normalized.turbidityValue, waterDepth: item.normalized.waterValue,
      waterStatus: item.normalized.raw?.water_status,
      waterMetadata: item.normalized.raw?.raw_payload,
      temperatureStatus: item.normalized.raw?.temperature_status,
      phStatus: item.normalized.raw?.ph_status,
      turbidityStatus: item.normalized.raw?.turbidity_status,
    }, thresholds))) } : null;
  const ammonia = item => item ? { value: item.ammoniaValue, timestamp: item.date,
    condition: item.ammoniaValue == null ? "No Scan" : getSafetyStatusLabel(getSafetySeverity(evaluateReadingSafety({ ammonia: item.ammoniaValue }, thresholds))),
    measurement_type: "manual_scan" } : null;
  return { tank_id: snapshot.tankId, tank_name: snapshot.tankName,
    latest_sensor: sensor(snapshot.waterRecord), latest_ammonia: ammonia(snapshot.ammoniaRecord),
    recent_sensor_readings: scoped.filter(item => item.type === "Water Reading").slice(0, historyLimit).map(sensor),
    recent_ammonia_scans: scoped.filter(item => item.type === "Ammonia Reading").slice(0, historyLimit).map(ammonia),
    instructions: "Ammonia is manually scanned and may be older than the latest sensor readings. Never describe it as a live reading. Mention the ammonia scan timestamp when it affects a recommendation. Missing scans are unknown, not zero. Do not invent an age or staleness cutoff. Water marked last_good or water_measurement_fresh=false is a carried value, not a new physical measurement; do not describe it as current or recovered.",
  };
}

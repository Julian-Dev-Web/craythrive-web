import { formatPhilippineDateTime } from './philippineTime';
import { evaluateReadingSafety, getLocalThresholds, resolveTankThresholds } from "./thresholdEvaluation";
import { sensorNumber, sensorValues } from '../../supabase/functions/_shared/sensorReadingContract.js';
import { formatWaterDepth } from '../../supabase/functions/_shared/waterDepthDisplay.js';

// src/utils/sensorReadingUtils.js

export function getFirstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return null;
}

export function toNumberOrNull(value) {
  return sensorNumber(value);
}

export function formatNumber(value, decimals = 1) {
  const numberValue = toNumberOrNull(value);

  if (numberValue === null) return "N/A";

  return numberValue.toFixed(decimals);
}

export function normalizeStatus(value) {
  if (!value) return "";

  return String(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim();
}

export function normalizeSensorReading(reading, thresholds = getLocalThresholds()) {
  thresholds = resolveTankThresholds(thresholds, reading?.tank_id);
  if (!reading) {
    return {
      raw: null,
      safety: evaluateReadingSafety({}, thresholds),

      temperatureValue: null,
      temperatureLabel: "No Data",
      temperatureStatus: "No Reading",

      phValue: null,
      phNumberLabel: "No Data",
      phLabel: "No Reading",
      phStatus: "No Reading",

      turbidityValue: null,
      turbidityNumberLabel: "No Data",
      turbidityLabel: "No Reading",
      turbidityStatus: "No Reading",

      waterValue: null,
      waterLabel: "No Data",
      waterStatus: "No Reading",

      createdAt: null,
      deviceUid: "",
    };
  }

  const { temperature: temperatureValue, ph: phValue, turbidityVoltage: turbidityValue,
    waterDepth: waterValue } = sensorValues(reading);

  const safety = evaluateReadingSafety({
    temperature: temperatureValue, ph: phValue,
    turbidityVoltage: turbidityValue, waterDepth: waterValue,
    waterStatus: reading.water_status,
    waterMetadata: reading.raw_payload,
    temperatureStatus: reading.temperature_status,
    phStatus: reading.ph_status,
    turbidityStatus: reading.turbidity_status,
  }, thresholds);
  const temperatureStatus = safety.parameters.temperature.label;
  const phStatus = safety.parameters.ph.label;
  const turbidityStatus = safety.parameters.turbidity.label;
  const waterStatus = safety.parameters.waterLevel.label;

  return {
    raw: reading,
    safety,

    temperatureValue,
    temperatureLabel:
      toNumberOrNull(temperatureValue) === null
        ? "No Data"
        : `${formatNumber(temperatureValue, 1)}°C`,
    temperatureStatus,

    phValue,
    phNumberLabel:
      toNumberOrNull(phValue) === null ? "No Data" : formatNumber(phValue, 2),
    phLabel: phStatus,
    phStatus,

    turbidityValue,
    turbidityNumberLabel:
      toNumberOrNull(turbidityValue) === null
        ? "No Data"
        : `${formatNumber(turbidityValue, 2)} V`,
    turbidityLabel: turbidityStatus,
    turbidityStatus,

    waterValue,
    waterLabel:
      safety.parameters.waterLevel.health === "error"
        ? "Sensor Error"
        : !safety.parameters.waterLevel.hasValue
        ? "No Data"
        : safety.parameters.waterLevel.health === "stale"
        ? `Latest available: ${formatWaterDepth(waterValue)}`
        : formatWaterDepth(waterValue),
    waterStatus,

    createdAt: reading.created_at || null,
    deviceUid: reading.device_uid || "",
  };
}

export function getTemperatureStatus(value, thresholds = getLocalThresholds()) {
  return evaluateReadingSafety({ temperature: value }, thresholds).parameters.temperature.label;
}

export function getPhStatus(value, thresholds = getLocalThresholds()) {
  return evaluateReadingSafety({ ph: value }, thresholds).parameters.ph.label;
}

export function getTurbidityStatusFromVoltage(value, thresholds = getLocalThresholds()) {
  return evaluateReadingSafety({ turbidityVoltage: value }, thresholds).parameters.turbidity.label;
}

export function getWaterStatus(value, thresholds = getLocalThresholds()) {
  return evaluateReadingSafety({ waterDepth: value }, thresholds).parameters.waterLevel.label;
}

export function formatReadingTime(value) { return !value ? 'No time' : formatPhilippineDateTime(value, {}, 'Invalid time'); }

import { evaluateReadingSafety, getLocalThresholds } from "./thresholdEvaluation";

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
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return null;

  return numberValue;
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

  const temperatureValue = [
    reading.temperature_c,
    reading.temperature
  ].map(toNumberOrNull).find(value => value !== null) ?? null;

  const phValue = [reading.ph_value, reading.ph]
    .map(toNumberOrNull).find(value => value !== null) ?? null;

  const turbidityValue = [
    reading.turbidity_voltage,
    reading.turbidity,
    reading.raw_turbidity_value
  ].map(toNumberOrNull).find(value => value !== null) ?? null;

  const waterValue = [
    reading.water_depth_cm,
    reading.water_level,
    reading.waterValue
  ].map(toNumberOrNull).find(value => value !== null) ?? null;

  const safety = evaluateReadingSafety({
    temperature: temperatureValue, ph: phValue,
    turbidityVoltage: turbidityValue, waterDepth: waterValue,
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
      toNumberOrNull(waterValue) === null
        ? "No Data"
        : `${formatNumber(waterValue, 1)} cm`,
    waterStatus,

    createdAt: reading.created_at || reading.timestamp || reading.date || null,
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

export function formatReadingTime(value) {
  if (!value) return "No time";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Invalid time";
  }
}

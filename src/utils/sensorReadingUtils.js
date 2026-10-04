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
  if (value === null || value === undefined || value === "") return null;

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

      temperatureValue: null,
      temperatureLabel: "N/A",
      temperatureStatus: "No Reading",

      phValue: null,
      phNumberLabel: "N/A",
      phLabel: "No Reading",
      phStatus: "No Reading",

      turbidityValue: null,
      turbidityNumberLabel: "N/A",
      turbidityLabel: "No Reading",
      turbidityStatus: "No Reading",

      waterValue: null,
      waterLabel: "N/A",
      waterStatus: "No Reading",

      createdAt: null,
      deviceUid: "",
    };
  }

  const temperatureValue = getFirstValue(
    reading.temperature_c,
    reading.temperature
  );

  // IMPORTANT:
  // Use ph first because this is the more correct/actual pH reading in your DB.
  // ph_value is only fallback because some old rows/code may still use it.
  const phValue = getFirstValue(
    reading.ph,
    reading.ph_value
  );

  const turbidityValue = getFirstValue(
    reading.turbidity_voltage,
    reading.turbidity,
    reading.raw_turbidity_value
  );

  const waterValue = getFirstValue(
    reading.water_depth_cm,
    reading.water_level,
    reading.waterValue
  );

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
        ? "N/A"
        : `${formatNumber(temperatureValue, 1)}°C`,
    temperatureStatus,

    phValue,
    phNumberLabel:
      toNumberOrNull(phValue) === null ? "N/A" : formatNumber(phValue, 2),
    phLabel: phStatus,
    phStatus,

    turbidityValue,
    turbidityNumberLabel:
      toNumberOrNull(turbidityValue) === null
        ? "N/A"
        : `${formatNumber(turbidityValue, 2)} V`,
    turbidityLabel: turbidityStatus,
    turbidityStatus,

    waterValue,
    waterLabel:
      toNumberOrNull(waterValue) === null
        ? "N/A"
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
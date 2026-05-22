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

export function normalizeStatusUpper(value) {
  return normalizeStatus(value).toUpperCase();
}

export function getReadingDate(reading) {
  return (
    reading?.created_at ||
    reading?.timestamp ||
    reading?.date ||
    reading?.updated_at ||
    ""
  );
}

export function sortReadingsNewestFirst(readings = []) {
  return [...(readings || [])].sort((a, b) => {
    return new Date(getReadingDate(b)) - new Date(getReadingDate(a));
  });
}

export function getReadingPhValue(reading) {
  return toNumberOrNull(getFirstValue(reading?.ph_value, reading?.ph));
}

export function isSafePhStatus(status) {
  const value = normalizeStatusUpper(status);

  return (
    value.includes("IDEAL") ||
    value.includes("SAFE") ||
    value.includes("NORMAL")
  );
}

export function isUnsafePhStatus(status) {
  const value = normalizeStatusUpper(status);

  return (
    value.includes("UNSAFE") ||
    value.includes("CRITICAL") ||
    value.includes("DANGER") ||
    value.includes("HIGH PH") ||
    value.includes("LOW PH") ||
    value.includes("HIGH ALKALINE") ||
    value.includes("LOW ALKALINE") ||
    value.includes("ACIDIC")
  );
}

export function isUnsafePhReading(reading) {
  if (!reading) return false;

  const phValue = getReadingPhValue(reading);
  const phStatus = getFirstValue(reading.ph_status, getPhStatus(phValue));

  if (isSafePhStatus(phStatus)) return false;

  if (phValue !== null && (phValue < 6.5 || phValue > 8.5)) {
    return true;
  }

  return isUnsafePhStatus(phStatus);
}

export function pickStableLatestReading(readings = []) {
  const sorted = sortReadingsNewestFirst(readings);

  if (sorted.length === 0) return null;

  const latest = sorted[0];

  // If latest pH is safe, use it normally.
  if (!isUnsafePhReading(latest)) {
    return latest;
  }

  // If latest pH is unsafe, require 3 consecutive unsafe pH readings.
  // This prevents 1 random pH spike from becoming the tank status.
  const latestThree = sorted.slice(0, 3);

  const confirmedUnsafePh =
    latestThree.length >= 3 && latestThree.every(isUnsafePhReading);

  if (confirmedUnsafePh) {
    return latest;
  }

  // If it is only a spike, use the newest safe reading instead.
  const newestSafeReading = sorted.find((reading) => {
    return !isUnsafePhReading(reading);
  });

  return newestSafeReading || latest;
}

export function normalizeSensorReading(reading) {
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

  const phValue = getFirstValue(reading.ph_value, reading.ph);

  const turbidityValue = getFirstValue(
    reading.turbidity_voltage,
    reading.turbidity,
    reading.raw_turbidity_value
  );

  const waterValue = getFirstValue(
    reading.water_depth_cm,
    reading.water_level,
    reading.water_distance_cm
  );

  const temperatureStatus = normalizeStatus(
    reading.temperature_status || getTemperatureStatus(temperatureValue)
  );

  const phStatus = normalizeStatus(reading.ph_status || getPhStatus(phValue));

  const turbidityStatus = normalizeStatus(
    reading.turbidity_status || getTurbidityStatusFromVoltage(turbidityValue)
  );

  const waterStatus = normalizeStatus(
    reading.water_status || getWaterStatus(waterValue)
  );

  return {
    raw: reading,

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

export function getTemperatureStatus(value) {
  const numberValue = toNumberOrNull(value);

  if (numberValue === null) return "No Reading";
  if (numberValue < 22) return "Cold";
  if (numberValue > 30) return "Warm";

  return "Ideal";
}

export function getPhStatus(value) {
  const numberValue = toNumberOrNull(value);

  if (numberValue === null) return "No Reading";
  if (numberValue < 6.5) return "Low pH";
  if (numberValue > 8.5) return "High pH";

  return "Ideal pH";
}

export function getTurbidityStatusFromVoltage(value) {
  const numberValue = toNumberOrNull(value);

  if (numberValue === null) return "No Reading";

  // Higher voltage = clearer water, lower voltage = dirtier water.
  if (numberValue >= 3.8) return "Clear";
  if (numberValue >= 2.5) return "Slightly Dirty";
  if (numberValue >= 1.5) return "Dirty";

  return "Critical";
}

export function getWaterStatus(value) {
  const numberValue = toNumberOrNull(value);

  if (numberValue === null) return "No Reading";

  return "Measured";
}

export function formatReadingTime(value) {
  if (!value) return "No time";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Invalid time";
  }
}
// src/utils/thresholdEvaluation.js
//
// Compares live sensor readings against the SAME threshold values the user
// configures on the Threshold Settings page (Supabase `threshold_settings`
// table, with a localStorage fallback) so "safe range" means the same thing
// everywhere in the dashboard.

import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { toNumberOrNull } from "./sensorReadingUtils";

const STORAGE_KEY = "craythrive_threshold_settings";
const TABLE_NAME = "threshold_settings";

export const DEFAULT_THRESHOLDS = {
  temperatureMin: 20,
  temperatureMax: 30,
  phMin: 6.5,
  phMax: 8.5,
  turbidityMax: 40,
  waterLevelMin: 35,
  ammoniaMax: 0.25,
};

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeThresholds(data) {
  if (!data) return DEFAULT_THRESHOLDS;

  const source = data.thresholds || data.safe_thresholds || data;

  return {
    temperatureMin: numberOrDefault(
      source.temperatureMin ?? source.temperature_min,
      DEFAULT_THRESHOLDS.temperatureMin
    ),
    temperatureMax: numberOrDefault(
      source.temperatureMax ?? source.temperature_max,
      DEFAULT_THRESHOLDS.temperatureMax
    ),
    phMin: numberOrDefault(source.phMin ?? source.ph_min, DEFAULT_THRESHOLDS.phMin),
    phMax: numberOrDefault(source.phMax ?? source.ph_max, DEFAULT_THRESHOLDS.phMax),
    turbidityMax: numberOrDefault(
      source.turbidityMax ?? source.turbidity_max,
      DEFAULT_THRESHOLDS.turbidityMax
    ),
    waterLevelMin: numberOrDefault(
      source.waterLevelMin ?? source.water_level_min,
      DEFAULT_THRESHOLDS.waterLevelMin
    ),
    ammoniaMax: numberOrDefault(
      source.ammoniaMax ?? source.ammonia_max,
      DEFAULT_THRESHOLDS.ammoniaMax
    ),
  };
}

export function getLocalThresholds() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (!saved) return DEFAULT_THRESHOLDS;

    return {
      ...DEFAULT_THRESHOLDS,
      ...JSON.parse(saved),
    };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

/**
 * Loads the thresholds that should currently apply: the logged-in user's
 * saved Supabase row when available, otherwise the localStorage copy /
 * hard defaults. Mirrors the same lookup ThresholdSettingsPage.jsx uses so
 * both pages always agree on what "safe" means.
 */
export async function loadActiveThresholds() {
  if (!isSupabaseConfigured || !supabase) {
    return getLocalThresholds();
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;

    if (!userId) {
      return getLocalThresholds();
    }

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) {
      return getLocalThresholds();
    }

    return normalizeThresholds(data);
  } catch {
    return getLocalThresholds();
  }
}

/**
 * Checks one reading's raw numeric values against the active thresholds.
 *
 * Note on turbidity: the sensor reports a VOLTAGE where higher = clearer
 * water (see getTurbidityStatusFromVoltage in sensorReadingUtils.js), while
 * the Threshold Settings UI describes turbidityMax as a "maximum dirty
 * water" value — the two don't share the same scale/direction. Rather than
 * silently guess, turbidity here is flagged using its already-computed
 * status label (anything other than "Clear" counts as an issue) instead of
 * a raw numeric comparison. Worth normalizing later so turbidityMax means
 * the same thing in both places.
 */
export function evaluateReadingSafety(
  { temperature, ph, turbidityStatus, waterDepth },
  thresholds = DEFAULT_THRESHOLDS
) {
  const issues = [];

  const temp = toNumberOrNull(temperature);
  if (temp !== null) {
    if (temp < thresholds.temperatureMin) {
      issues.push({
        key: "temperature",
        label: "Temperature",
        message: `${temp.toFixed(1)}°C is below the safe minimum (${thresholds.temperatureMin}°C)`,
      });
    } else if (temp > thresholds.temperatureMax) {
      issues.push({
        key: "temperature",
        label: "Temperature",
        message: `${temp.toFixed(1)}°C is above the safe maximum (${thresholds.temperatureMax}°C)`,
      });
    }
  }

  const phValue = toNumberOrNull(ph);
  if (phValue !== null) {
    if (phValue < thresholds.phMin) {
      issues.push({
        key: "ph",
        label: "pH Level",
        message: `${phValue.toFixed(2)} is below the safe minimum (${thresholds.phMin})`,
      });
    } else if (phValue > thresholds.phMax) {
      issues.push({
        key: "ph",
        label: "pH Level",
        message: `${phValue.toFixed(2)} is above the safe maximum (${thresholds.phMax})`,
      });
    }
  }

  const cleanTurbidityStatus = String(turbidityStatus || "").toLowerCase();
  if (
    cleanTurbidityStatus &&
    cleanTurbidityStatus !== "clear" &&
    cleanTurbidityStatus !== "no reading"
  ) {
    issues.push({
      key: "turbidity",
      label: "Water Clarity",
      message: `Water clarity is currently "${turbidityStatus}" — expected Clear`,
    });
  }

  const waterValue = toNumberOrNull(waterDepth);
  if (waterValue !== null && waterValue < thresholds.waterLevelMin) {
    issues.push({
      key: "waterLevel",
      label: "Water Level",
      message: `${waterValue.toFixed(1)} cm is below the safe minimum (${thresholds.waterLevelMin} cm)`,
    });
  }

  const hasAnyData =
    temp !== null ||
    phValue !== null ||
    Boolean(cleanTurbidityStatus) ||
    waterValue !== null;

  return {
    isSafe: hasAnyData && issues.length === 0,
    hasData: hasAnyData,
    issues,
  };
}
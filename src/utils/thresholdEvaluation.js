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
 * Returns both:
 *  - `issues`: a flat list, for the overall safe-range banner.
 *  - `parameters`: a per-parameter breakdown ({ temperature, ph, turbidity,
 *    waterLevel, ammonia }), each with { severity, label, hasValue }, so
 *    individual metric cards can show the SAME verdict as the banner
 *    instead of a separate hardcoded status.
 *
 * Ammonia is special-cased: it comes from a separate mobile test-strip scan
 * (ammonia_readings table), not the continuous sensor stream, so a tank
 * that simply hasn't been scanned yet is NOT an "issue" — it's a neutral
 * "No Scan Yet" state that does not affect isSafe.
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
  { temperature, ph, turbidityStatus, waterDepth, ammonia },
  thresholds = DEFAULT_THRESHOLDS
) {
  const issues = [];
  const parameters = {};

  /* ---------------- TEMPERATURE ---------------- */

  const temp = toNumberOrNull(temperature);

  if (temp === null) {
    parameters.temperature = {
      severity: "no-data",
      label: "No Reading",
      hasValue: false,
    };
  } else if (temp < thresholds.temperatureMin) {
    parameters.temperature = {
      severity: "critical",
      label: "Below Safe Min",
      hasValue: true,
    };

    issues.push({
      key: "temperature",
      label: "Temperature",
      message: `${temp.toFixed(1)}°C is below the safe minimum (${thresholds.temperatureMin}°C)`,
    });
  } else if (temp > thresholds.temperatureMax) {
    parameters.temperature = {
      severity: "critical",
      label: "Above Safe Max",
      hasValue: true,
    };

    issues.push({
      key: "temperature",
      label: "Temperature",
      message: `${temp.toFixed(1)}°C is above the safe maximum (${thresholds.temperatureMax}°C)`,
    });
  } else {
    parameters.temperature = {
      severity: "normal",
      label: "Within Range",
      hasValue: true,
    };
  }

  /* ---------------- PH ---------------- */

  const phValue = toNumberOrNull(ph);

  if (phValue === null) {
    parameters.ph = {
      severity: "no-data",
      label: "No Reading",
      hasValue: false,
    };
  } else if (phValue < thresholds.phMin) {
    parameters.ph = {
      severity: "critical",
      label: "Below Safe Min",
      hasValue: true,
    };

    issues.push({
      key: "ph",
      label: "pH Level",
      message: `${phValue.toFixed(2)} is below the safe minimum (${thresholds.phMin})`,
    });
  } else if (phValue > thresholds.phMax) {
    parameters.ph = {
      severity: "critical",
      label: "Above Safe Max",
      hasValue: true,
    };

    issues.push({
      key: "ph",
      label: "pH Level",
      message: `${phValue.toFixed(2)} is above the safe maximum (${thresholds.phMax})`,
    });
  } else {
    parameters.ph = {
      severity: "normal",
      label: "Within Range",
      hasValue: true,
    };
  }

  /* ---------------- TURBIDITY ---------------- */

  const cleanTurbidityStatus = String(turbidityStatus || "").toLowerCase();

  if (!cleanTurbidityStatus || cleanTurbidityStatus === "no reading") {
    parameters.turbidity = {
      severity: "no-data",
      label: "No Reading",
      hasValue: false,
    };
  } else if (cleanTurbidityStatus === "clear") {
    parameters.turbidity = {
      severity: "normal",
      label: "Within Range",
      hasValue: true,
    };
  } else {
    parameters.turbidity = {
      severity: "critical",
      label: "Needs Attention",
      hasValue: true,
    };

    issues.push({
      key: "turbidity",
      label: "Water Clarity",
      message: `Water clarity is currently "${turbidityStatus}" — expected Clear`,
    });
  }

  /* ---------------- WATER LEVEL ---------------- */

  const waterValue = toNumberOrNull(waterDepth);

  if (waterValue === null) {
    parameters.waterLevel = {
      severity: "no-data",
      label: "No Reading",
      hasValue: false,
    };
  } else if (waterValue < thresholds.waterLevelMin) {
    parameters.waterLevel = {
      severity: "critical",
      label: "Below Safe Min",
      hasValue: true,
    };

    issues.push({
      key: "waterLevel",
      label: "Water Level",
      message: `${waterValue.toFixed(1)} cm is below the safe minimum (${thresholds.waterLevelMin} cm)`,
    });
  } else {
    parameters.waterLevel = {
      severity: "normal",
      label: "Within Range",
      hasValue: true,
    };
  }

  /* ---------------- AMMONIA ----------------
     Special case: no scan yet is a NEUTRAL state, not an issue, and does
     not count toward hasAnyData / isSafe either way. */

  const ammoniaValue = toNumberOrNull(ammonia);

  if (ammoniaValue === null) {
    parameters.ammonia = {
      severity: "neutral",
      label: "No Scan Yet",
      hasValue: false,
    };
  } else if (ammoniaValue > thresholds.ammoniaMax) {
    parameters.ammonia = {
      severity: "critical",
      label: "Above Safe Max",
      hasValue: true,
    };

    issues.push({
      key: "ammonia",
      label: "Ammonia",
      message: `${ammoniaValue} mg/L is above the safe maximum (${thresholds.ammoniaMax} mg/L)`,
    });
  } else {
    parameters.ammonia = {
      severity: "normal",
      label: "Within Range",
      hasValue: true,
    };
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
    parameters,
  };
}
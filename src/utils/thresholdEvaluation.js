// src/utils/thresholdEvaluation.js
//
// CrayThrive threshold evaluation + reference guidance.
//
// IMPORTANT DESIGN:
//
// 1. ACTIVE THRESHOLDS
//    These are the values actually used by CrayThrive when classifying
//    readings. They come from Supabase `threshold_settings` when available.
//
// 2. RESEARCH / REFERENCE GUIDANCE
//    These values are informational references shown to the user.
//    They DO NOT automatically overwrite active thresholds.
//
// 3. EXPERT / SURVEY RECOMMENDATIONS
//    These remain empty until actual validation/survey results exist.
//
// 4. CALIBRATION-SPECIFIC PARAMETERS
//    Turbidity voltage and water-level centimetres depend on CrayThrive's
//    physical sensor/tank calibration. They must not be presented as
//    universal biological limits.

import {
  isSupabaseConfigured,
  supabase,
} from "../lib/supabase";

import {
  toNumberOrNull,
} from "./sensorReadingUtils";

const STORAGE_KEY =
  "craythrive_threshold_settings";

const TABLE_NAME =
  "threshold_settings";

/*
|--------------------------------------------------------------------------
| ACTIVE / FALLBACK THRESHOLDS
|--------------------------------------------------------------------------
|
| These are operational CrayThrive fallback values.
|
| They are NOT automatically described as "research-backed".
|
| Supabase values override these when the logged-in user has saved
| threshold settings.
|
| NOTE:
| `turbidityMax` is kept as the existing database/property name for
| compatibility, although CrayThrive currently treats the voltage as a
| CLEAR-MINIMUM style threshold: higher voltage = clearer water.
|
*/

export const DEFAULT_THRESHOLDS = {
  temperatureMin: 20,
  temperatureMax: 30,

  phMin: 6.5,
  phMax: 8.5,

  // Legacy property name kept for DB compatibility.
  // Operational meaning:
  // minimum sensor voltage used as a clear-water reference.
  turbidityMax: 2.5,

  // Prototype tank operational threshold.
  // This is tank/sensor-calibration specific.
  waterLevelMin: 4.5,

  ammoniaMax: 0.25,
};

/*
|--------------------------------------------------------------------------
| RESEARCH / REFERENCE GUIDANCE
|--------------------------------------------------------------------------
|
| This information is for DISPLAY and EDUCATIONAL guidance.
|
| It must remain separate from DEFAULT_THRESHOLDS because:
|
| - a literature value is not automatically the user's active threshold;
| - turbidity voltage depends on sensor calibration;
| - water depth depends on the physical tank;
| - ammonia measurements can represent different analytes/methods;
| - future expert/survey recommendations must come from actual collected
|   validation data, not fabricated values.
|
*/

export const THRESHOLD_REFERENCE_GUIDANCE = {
  temperature: {
    key: "temperature",

    title: "Water Temperature",

    unit: "°C",

    referenceType: "research",

    referenceLabel:
      "Research-backed reference",

    primary: {
      min: 26,
      max: 29,

      label:
        "Optimal growth range",

      source:
        "Business Queensland — Redclaw crayfish aquaculture",

      sourceType:
        "Government aquaculture guidance",
    },

    supporting: {
      min: 20,
      max: 32,

      label:
        "Published safe physiological range",

      source:
        "Recent Cherax quadricarinatus culture study",

      sourceType:
        "Peer-reviewed study",
    },

    explanation:
      "Published guidance distinguishes an optimal growth range from a broader tolerated or managed range. CrayThrive should show these values as references rather than automatically replacing the user's active threshold.",

    surveyRecommendation:
      null,

    surveyStatus:
      "Pending actual expert/validation results",
  },

  ph: {
    key: "ph",

    title: "pH Level",

    unit: "pH",

    referenceType: "research",

    referenceLabel:
      "Research-backed reference",

    primary: {
      min: 7.0,
      max: 8.5,

      label:
        "Ideal range for redclaw",

      source:
        "Business Queensland — Redclaw crayfish aquaculture",

      sourceType:
        "Government aquaculture guidance",
    },

    supporting: {
      min: 7.0,
      max: 8.5,

      label:
        "Published safe physiological range",

      source:
        "Recent Cherax quadricarinatus culture study",

      sourceType:
        "Peer-reviewed study",
    },

    explanation:
      "The published references consistently place redclaw pH around 7.0–8.5. The active CrayThrive value may still be configured separately by the user.",

    surveyRecommendation:
      null,

    surveyStatus:
      "Pending actual expert/validation results",
  },

  turbidity: {
    key: "turbidity",

    title: "Water Clarity / Turbidity",

    unit: "V",

    referenceType:
      "sensor-calibration",

    referenceLabel:
      "Prototype calibration",

    primary: null,

    supporting: null,

    explanation:
      "CrayThrive's turbidity module currently evaluates an analog sensor voltage where higher voltage generally represents clearer water. Published aquaculture studies normally report turbidity using other units or water-clarity methods, so the CrayThrive voltage threshold must be treated as a prototype sensor-calibration value rather than a universal crayfish biological limit.",

    calibrationNote:
      "Use the actual DFRobot sensor calibration and CrayThrive prototype testing when setting this value.",

    surveyRecommendation:
      null,

    surveyStatus:
      "Pending actual expert/validation results",
  },

  waterLevel: {
    key: "waterLevel",

    title: "Water Level",

    unit: "cm",

    referenceType:
      "tank-calibration",

    referenceLabel:
      "Tank-specific calibration",

    primary: null,

    supporting: null,

    explanation:
      "A universal centimetre threshold is not appropriate because the reading depends on the physical tank height, ultrasonic sensor position, and CrayThrive water-level calibration.",

    calibrationNote:
      "Use the actual CrayThrive tank dimensions and ultrasonic calibration for the operational water-level threshold.",

    surveyRecommendation:
      null,

    surveyStatus:
      "Pending actual expert/validation results",
  },

  ammonia: {
    key: "ammonia",

    title: "Ammonia",

    unit: "mg/L",

    referenceType:
      "research-with-measurement-caveat",

    referenceLabel:
      "Research-backed reference",

    primary: {
      max: 0.05,

      comparison: "<",

      label:
        "Aquaculture management reference",

      source:
        "Business Queensland — Redclaw crayfish aquaculture",

      sourceType:
        "Government aquaculture guidance",
    },

    supporting: {
      max: 0.5,

      comparison: "<",

      unit: "mg/L NH4+-N",

      label:
        "Published study safe range",

      source:
        "Recent Cherax quadricarinatus culture study",

      sourceType:
        "Peer-reviewed study",
    },

    explanation:
      "Ammonia values must be interpreted with the measurement method. Published references may describe total ammonia, ammonia nitrogen, or NH4+-N differently. CrayThrive must not present one literature number as directly equivalent to the phone test-strip result until the strip's analyte and scale are confirmed.",

    measurementWarning:
      "Confirm the ammonia test-strip measurement type before using a literature value as an automatic operational limit.",

    surveyRecommendation:
      null,

    surveyStatus:
      "Pending actual expert/validation results",
  },
};

/*
|--------------------------------------------------------------------------
| REFERENCE HELPERS
|--------------------------------------------------------------------------
*/

export function getThresholdReference(
  parameter
) {
  const key =
    normalizeReferenceKey(
      parameter
    );

  if (!key) {
    return null;
  }

  return (
    THRESHOLD_REFERENCE_GUIDANCE[
      key
    ] || null
  );
}

export function getAllThresholdReferences() {
  return Object.values(
    THRESHOLD_REFERENCE_GUIDANCE
  );
}

function normalizeReferenceKey(
  value
) {
  const key =
    String(
      value || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        "_"
      )
      .replace(
        /-/g,
        "_"
      );

  if (
    key ===
      "temperature" ||
    key ===
      "temperaturemin" ||
    key ===
      "temperature_min" ||
    key ===
      "temperaturemax" ||
    key ===
      "temperature_max" ||
    key === "temp"
  ) {
    return "temperature";
  }

  if (
    key === "ph" ||
    key ===
      "phmin" ||
    key ===
      "ph_min" ||
    key ===
      "phmax" ||
    key ===
      "ph_max" ||
    key ===
      "ph_level"
  ) {
    return "ph";
  }

  if (
    key ===
      "turbidity" ||
    key ===
      "turbiditymax" ||
    key ===
      "turbidity_max" ||
    key ===
      "water_clarity"
  ) {
    return "turbidity";
  }

  if (
    key ===
      "waterlevel" ||
    key ===
      "water_level" ||
    key ===
      "waterlevelmin" ||
    key ===
      "water_level_min" ||
    key ===
      "water_depth"
  ) {
    return "waterLevel";
  }

  if (
    key ===
      "ammonia" ||
    key ===
      "ammoniamax" ||
    key ===
      "ammonia_max"
  ) {
    return "ammonia";
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| THRESHOLD NORMALIZATION
|--------------------------------------------------------------------------
*/

function numberOrDefault(
  value,
  fallback
) {
  const parsed =
    Number(
      value
    );

  return Number.isFinite(
    parsed
  )
    ? parsed
    : fallback;
}

export function normalizeThresholds(
  data
) {
  if (!data) {
    return {
      ...DEFAULT_THRESHOLDS,
    };
  }

  const source =
    data.thresholds ||
    data.safe_thresholds ||
    data;

  return {
    temperatureMin:
      numberOrDefault(
        source.temperatureMin ??
          source.temperature_min,
        DEFAULT_THRESHOLDS
          .temperatureMin
      ),

    temperatureMax:
      numberOrDefault(
        source.temperatureMax ??
          source.temperature_max,
        DEFAULT_THRESHOLDS
          .temperatureMax
      ),

    phMin:
      numberOrDefault(
        source.phMin ??
          source.ph_min,
        DEFAULT_THRESHOLDS
          .phMin
      ),

    phMax:
      numberOrDefault(
        source.phMax ??
          source.ph_max,
        DEFAULT_THRESHOLDS
          .phMax
      ),

    turbidityMax:
      numberOrDefault(
        source.turbidityMax ??
          source.turbidity_max,
        DEFAULT_THRESHOLDS
          .turbidityMax
      ),

    waterLevelMin:
      numberOrDefault(
        source.waterLevelMin ??
          source.water_level_min,
        DEFAULT_THRESHOLDS
          .waterLevelMin
      ),

    ammoniaMax:
      numberOrDefault(
        source.ammoniaMax ??
          source.ammonia_max,
        DEFAULT_THRESHOLDS
          .ammoniaMax
      ),
  };
}

/*
|--------------------------------------------------------------------------
| LOCAL STORAGE
|--------------------------------------------------------------------------
*/

export function getLocalThresholds() {
  try {
    const saved =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (!saved) {
      return {
        ...DEFAULT_THRESHOLDS,
      };
    }

    const parsed =
      JSON.parse(
        saved
      );

    return normalizeThresholds(
      parsed
    );
  } catch {
    return {
      ...DEFAULT_THRESHOLDS,
    };
  }
}

/*
|--------------------------------------------------------------------------
| LOAD ACTIVE THRESHOLDS
|--------------------------------------------------------------------------
|
| Priority:
|
| 1. Logged-in user's Supabase threshold_settings row
| 2. Browser localStorage copy
| 3. Hard fallback defaults
|
*/

export async function loadActiveThresholds() {
  if (
    !isSupabaseConfigured ||
    !supabase
  ) {
    return getLocalThresholds();
  }

  try {
    const {
      data: sessionData,
      error: sessionError,
    } =
      await supabase.auth.getSession();

    if (sessionError) {
      console.log(
        "LOAD ACTIVE THRESHOLDS SESSION ERROR:",
        sessionError
      );

      return getLocalThresholds();
    }

    const userId =
      sessionData?.session
        ?.user?.id;

    if (!userId) {
      return getLocalThresholds();
    }

    const {
      data,
      error,
    } =
      await supabase
        .from(
          TABLE_NAME
        )
        .select("*")
        .eq(
          "user_id",
          userId
        )
        .maybeSingle();

    if (
      error ||
      !data
    ) {
      if (error) {
        console.log(
          "LOAD ACTIVE THRESHOLDS DB ERROR:",
          error
        );
      }

      return getLocalThresholds();
    }

    const normalized =
      normalizeThresholds(
        data
      );

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          normalized
        )
      );
    } catch {
      // Local cache failure must not prevent Supabase values from loading.
    }

    return normalized;
  } catch (error) {
    console.log(
      "LOAD ACTIVE THRESHOLDS ERROR:",
      error
    );

    return getLocalThresholds();
  }
}

/*
|--------------------------------------------------------------------------
| SAFETY EVALUATION
|--------------------------------------------------------------------------
|
| Checks a tank reading using the ACTIVE CrayThrive thresholds.
|
| This function intentionally does NOT compare readings directly against
| the research reference object above.
|
| Why?
|
| Research guidance = informational / supporting reference
| Active threshold  = actual operational value selected by the user/system
|
*/

export function evaluateReadingSafety(
  {
    temperature,
    ph,
    turbidityVoltage,
    waterDepth,
    ammonia,
  },
  thresholds =
    DEFAULT_THRESHOLDS
) {
  const active =
    normalizeThresholds(
      thresholds
    );

  const issues = [];

  const parameters = {};

  /*
  |--------------------------------------------------------------------------
  | TEMPERATURE
  |--------------------------------------------------------------------------
  */

  const temp =
    toNumberOrNull(
      temperature
    );

  if (
    temp === null
  ) {
    parameters.temperature = {
      severity:
        "no-data",

      label:
        "No Reading",

      hasValue:
        false,
    };
  } else if (
    temp <
    active.temperatureMin
  ) {
    parameters.temperature = {
      severity:
        "critical",

      label:
        "Below Active Min",

      hasValue:
        true,
    };

    issues.push({
      key:
        "temperature",

      label:
        "Temperature",

      message:
        `${temp.toFixed(
          1
        )}°C is below the active minimum ` +
        `(${active.temperatureMin}°C)`,
    });
  } else if (
    temp >
    active.temperatureMax
  ) {
    parameters.temperature = {
      severity:
        "critical",

      label:
        "Above Active Max",

      hasValue:
        true,
    };

    issues.push({
      key:
        "temperature",

      label:
        "Temperature",

      message:
        `${temp.toFixed(
          1
        )}°C is above the active maximum ` +
        `(${active.temperatureMax}°C)`,
    });
  } else {
    parameters.temperature = {
      severity:
        "normal",

      label:
        "Within Active Range",

      hasValue:
        true,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | pH
  |--------------------------------------------------------------------------
  */

  const phValue =
    toNumberOrNull(
      ph
    );

  if (
    phValue === null
  ) {
    parameters.ph = {
      severity:
        "no-data",

      label:
        "No Reading",

      hasValue:
        false,
    };
  } else if (
    phValue <
    active.phMin
  ) {
    parameters.ph = {
      severity:
        "critical",

      label:
        "Below Active Min",

      hasValue:
        true,
    };

    issues.push({
      key:
        "ph",

      label:
        "pH Level",

      message:
        `${phValue.toFixed(
          2
        )} is below the active minimum ` +
        `(${active.phMin})`,
    });
  } else if (
    phValue >
    active.phMax
  ) {
    parameters.ph = {
      severity:
        "critical",

      label:
        "Above Active Max",

      hasValue:
        true,
    };

    issues.push({
      key:
        "ph",

      label:
        "pH Level",

      message:
        `${phValue.toFixed(
          2
        )} is above the active maximum ` +
        `(${active.phMax})`,
    });
  } else {
    parameters.ph = {
      severity:
        "normal",

      label:
        "Within Active Range",

      hasValue:
        true,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | TURBIDITY
  |--------------------------------------------------------------------------
  |
  | Numeric voltage is evaluated against the active clear-water minimum.
  | Stored sensor statuses are raw metadata only.
  |
  */

  const turbidityValue = toNumberOrNull(turbidityVoltage);
  parameters.turbidity = turbidityValue === null
    ? { severity: "no-data", label: "No Reading", hasValue: false }
    : turbidityValue >= active.turbidityMax
      ? { severity: "normal", label: "Clear", hasValue: true }
      : { severity: "critical", label: "Needs Attention", hasValue: true };
  if (parameters.turbidity.severity === "critical") {
    issues.push({ key: "turbidity", label: "Water Clarity",
      message: `${turbidityValue} V is below the active clear-water minimum (${active.turbidityMax} V)` });
  }

  /*
  |--------------------------------------------------------------------------
  | WATER LEVEL
  |--------------------------------------------------------------------------
  |
  | waterLevelMin is an operational tank calibration value.
  |
  | Do not describe it as a universal biological safe depth.
  |
  */

  const waterValue =
    toNumberOrNull(
      waterDepth
    );

  if (
    waterValue ===
    null
  ) {
    parameters.waterLevel = {
      severity:
        "no-data",

      label:
        "No Reading",

      hasValue:
        false,
    };
  } else if (
    waterValue <
    active.waterLevelMin
  ) {
    parameters.waterLevel = {
      severity:
        "critical",

      label:
        "Below Active Min",

      hasValue:
        true,
    };

    issues.push({
      key:
        "waterLevel",

      label:
        "Water Level",

      message:
        `${waterValue.toFixed(
          1
        )} cm is below the active tank minimum ` +
        `(${active.waterLevelMin} cm)`,
    });
  } else {
    parameters.waterLevel = {
      severity:
        "normal",

      label:
        "Within Active Range",

      hasValue:
        true,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | AMMONIA
  |--------------------------------------------------------------------------
  |
  | Special case:
  |
  | The mobile phone test-strip scan is not a continuous IoT sensor.
  |
  | No scan yet = neutral.
  |
  | It does NOT automatically make the whole tank unsafe.
  |
  */

  const ammoniaValue =
    toNumberOrNull(
      ammonia
    );

  if (
    ammoniaValue ===
    null
  ) {
    parameters.ammonia = {
      severity:
        "neutral",

      label:
        "No Scan Yet",

      hasValue:
        false,
    };
  } else if (
    ammoniaValue >
    active.ammoniaMax
  ) {
    parameters.ammonia = {
      severity:
        "critical",

      label:
        "Above Active Max",

      hasValue:
        true,
    };

    issues.push({
      key:
        "ammonia",

      label:
        "Ammonia",

      message:
        `${formatNumber(
          ammoniaValue
        )} mg/L is above the active maximum ` +
        `(${formatNumber(
          active.ammoniaMax
        )} mg/L)`,
    });
  } else {
    parameters.ammonia = {
      severity:
        "normal",

      label:
        "Within Active Range",

      hasValue:
        true,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | FINAL STATUS
  |--------------------------------------------------------------------------
  |
  | Ammonia does not count toward hasAnyData when no scan exists.
  |
  */

  const hasTurbidityData = turbidityValue !== null;

  const hasAnyData =
    temp !== null ||
    phValue !== null ||
    hasTurbidityData ||
    waterValue !== null ||
    ammoniaValue !== null;

  return {
    isSafe:
      hasAnyData &&
      issues.length === 0,

    hasData:
      hasAnyData,

    issues,

    parameters,

    activeThresholds:
      active,
  };
}

/*
|--------------------------------------------------------------------------
| DISPLAY HELPERS
|--------------------------------------------------------------------------
*/

export function formatResearchReference(
  parameter
) {
  const reference =
    getThresholdReference(
      parameter
    );

  if (!reference) {
    return "No reference available";
  }

  const primary =
    reference.primary;

  if (
    !primary
  ) {
    return reference.referenceLabel;
  }

  const unit =
    primary.unit ||
    reference.unit ||
    "";

  if (
    Number.isFinite(
      Number(
        primary.min
      )
    ) &&
    Number.isFinite(
      Number(
        primary.max
      )
    )
  ) {
    return `${formatNumber(
      primary.min
    )}–${formatNumber(
      primary.max
    )}${unit ? ` ${unit}` : ""}`;
  }

  if (
    Number.isFinite(
      Number(
        primary.max
      )
    )
  ) {
    const comparison =
      primary.comparison ||
      "<=";

    return `${comparison}${formatNumber(
      primary.max
    )}${unit ? ` ${unit}` : ""}`;
  }

  return reference.referenceLabel;
}

function formatNumber(
  value
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {
    return "—";
  }

  if (
    Number.isInteger(
      number
    )
  ) {
    return String(
      number
    );
  }

  return number
    .toFixed(
      2
    )
    .replace(
      /0+$/,
      ""
    )
    .replace(
      /\.$/,
      ""
    );
}

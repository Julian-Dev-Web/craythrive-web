import { logDiagnostic, getSafeErrorMessage } from "../../utils/securityDiagnostics";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  Droplets,
  ExternalLink,
  Gauge,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Waves,
  X,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import {
  DEFAULT_THRESHOLDS,
  getLocalThresholds,
  normalizeThresholds,
} from "../../utils/thresholdEvaluation";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const STORAGE_KEY =
  "craythrive_threshold_settings";

const TABLE_NAME =
  "threshold_settings";

const QUEENSLAND_SOURCE =
  "https://www.business.qld.gov.au/industries/farms-fishing-forestry/fisheries/aquaculture/species/redclaw-crayfish";

const STUDY_SOURCE =
  "https://www.mdpi.com/2304-8158/15/11/1857";

/*
|--------------------------------------------------------------------------
| THRESHOLD CARD INFORMATION
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| `recommendedValue` is shown as reference information.
|
| It does NOT automatically overwrite the active CrayThrive setting.
|
| Turbidity voltage + water-level cm are prototype calibration values,
| not universal crayfish biological limits.
|
*/

const thresholdRows = [
  {
    key: "temperatureMin",
    group: "temperature",

    label: "Temperature Minimum",

    helper:
      "Lowest active water temperature before CrayThrive flags the reading.",

    unit: "°C",

    icon: Thermometer,

    min: 10,
    max: 40,
    step: 0.1,

    referenceType: "Research-backed reference",

    recommendedValue: "26–29°C",

    recommendedTitle:
      "Preferred range for optimal redclaw growth",

    recommendation:
      "Queensland aquaculture guidance states that optimal redclaw growth occurs between 26°C and 29°C. For this minimum setting, 26°C is the preferred lower reference.",

    secondaryReference:
      "A recent redclaw culture study reports a broader physiological range of 20–32°C.",

    sourceName:
      "Business Queensland — Redclaw crayfish aquaculture",

    sourceUrl:
      QUEENSLAND_SOURCE,

    sourceTwoName:
      "Recent Cherax quadricarinatus culture study",

    sourceTwoUrl:
      STUDY_SOURCE,

    tone: "research",
  },

  {
    key: "temperatureMax",
    group: "temperature",

    label: "Temperature Maximum",

    helper:
      "Highest active water temperature before CrayThrive flags the reading.",

    unit: "°C",

    icon: Thermometer,

    min: 10,
    max: 40,
    step: 0.1,

    referenceType: "Research-backed reference",

    recommendedValue: "26–29°C",

    recommendedTitle:
      "Preferred range for optimal redclaw growth",

    recommendation:
      "Queensland aquaculture guidance states that optimal redclaw growth occurs between 26°C and 29°C. For this maximum setting, 29°C is the preferred upper reference.",

    secondaryReference:
      "A recent redclaw culture study reports a broader physiological range of 20–32°C.",

    sourceName:
      "Business Queensland — Redclaw crayfish aquaculture",

    sourceUrl:
      QUEENSLAND_SOURCE,

    sourceTwoName:
      "Recent Cherax quadricarinatus culture study",

    sourceTwoUrl:
      STUDY_SOURCE,

    tone: "research",
  },

  {
    key: "phMin",
    group: "ph",

    label: "pH Minimum",

    helper:
      "Lowest active pH value before CrayThrive flags the reading.",

    unit: "pH",

    icon: Droplets,

    min: 0,
    max: 14,
    step: 0.1,

    referenceType: "Research-backed reference",

    recommendedValue: "7.0–8.5 pH",

    recommendedTitle:
      "Ideal redclaw pH range",

    recommendation:
      "Published redclaw guidance identifies pH 7.0–8.5 as the ideal range. For this minimum setting, 7.0 is the preferred lower reference.",

    secondaryReference:
      "The recent culture study also lists 7.0–8.5 as its safe physiological pH range.",

    sourceName:
      "Business Queensland — Redclaw crayfish aquaculture",

    sourceUrl:
      QUEENSLAND_SOURCE,

    sourceTwoName:
      "Recent Cherax quadricarinatus culture study",

    sourceTwoUrl:
      STUDY_SOURCE,

    tone: "research",
  },

  {
    key: "phMax",
    group: "ph",

    label: "pH Maximum",

    helper:
      "Highest active pH value before CrayThrive flags the reading.",

    unit: "pH",

    icon: Droplets,

    min: 0,
    max: 14,
    step: 0.1,

    referenceType: "Research-backed reference",

    recommendedValue: "7.0–8.5 pH",

    recommendedTitle:
      "Ideal redclaw pH range",

    recommendation:
      "Published redclaw guidance identifies pH 7.0–8.5 as the ideal range. For this maximum setting, 8.5 is the preferred upper reference.",

    secondaryReference:
      "The recent culture study also lists 7.0–8.5 as its safe physiological pH range.",

    sourceName:
      "Business Queensland — Redclaw crayfish aquaculture",

    sourceUrl:
      QUEENSLAND_SOURCE,

    sourceTwoName:
      "Recent Cherax quadricarinatus culture study",

    sourceTwoUrl:
      STUDY_SOURCE,

    tone: "research",
  },

  {
    /*
     * Existing database/property name kept for compatibility.
     *
     * Operational interpretation:
     * higher voltage = clearer water.
     */
    key: "turbidityMax",
    group: "turbidity",

    label: "Water Clarity Threshold",

    helper:
      "Minimum turbidity-sensor voltage used as the clear-water reference.",

    unit: "V",

    icon: Waves,

    min: 0,
    max: 5,
    step: 0.01,

    referenceType: "Prototype calibration",

    recommendedValue: "≥ 2.50 V reference",

    recommendedTitle:
      "Calibrated sensor value",

    recommendation:
      "CrayThrive uses the DFRobot turbidity module's analog voltage. Higher voltage generally represents clearer water in the current prototype.",

    secondaryReference:
      "Published crayfish studies do not provide a universal DFRobot voltage threshold, so this value must not be presented as a biological research limit.",

    sourceName:
      "CrayThrive DFRobot turbidity sensor calibration",

    sourceUrl:
      null,

    sourceTwoName:
      null,

    sourceTwoUrl:
      null,

    tone: "calibration",
  },

  {
    key: "waterLevelMin",
    group: "water_level",

    label: "Water Level Minimum",

    helper:
      "Lowest tank water depth before CrayThrive identifies a low-water condition.",

    unit: "cm",

    icon: Gauge,

    min: 0,
    max: 20,
    step: 0.1,

    referenceType: "Tank-specific calibration",

    recommendedValue: "Prototype-specific",

    recommendedTitle:
      "Based on tank geometry",

    recommendation:
      "The safe operational centimetre value depends on the CrayThrive tank height, ultrasonic sensor position, and the desired working water depth.",

    secondaryReference:
      "Commercial pond-depth recommendations cannot be directly converted into the centimetre threshold used by the small CrayThrive prototype.",

    sourceName:
      "CrayThrive ultrasonic and tank calibration",

    sourceUrl:
      null,

    sourceTwoName:
      null,

    sourceTwoUrl:
      null,

    tone: "calibration",
  },

  {
    key: "ammoniaMax",
    group: "ammonia",

    label: "Ammonia Maximum",

    helper:
      "Maximum active ammonia value before CrayThrive flags the recorded scan.",

    unit: "mg/L",

    icon: AlertTriangle,

    min: 0,
    max: 5,
    step: 0.01,

    referenceType: "Research-backed reference",

    recommendedValue: "< 0.05 mg/L",

    recommendedTitle:
      "Preferred management reference",

    recommendation:
      "Queensland redclaw aquaculture guidance recommends maintaining ammonia below 0.05 mg/L during production.",

    secondaryReference:
      "A recent redclaw culture study reports NH₄⁺-N below 0.5 mg/L as a safe physiological range. These ammonia measurements are not necessarily interchangeable.",

    measurementWarning:
      "Confirm what ammonia form the LIANKAI phone-scanned test strip reports before treating a literature value as an exact strip cutoff.",

    sourceName:
      "Business Queensland — Redclaw crayfish aquaculture",

    sourceUrl:
      QUEENSLAND_SOURCE,

    sourceTwoName:
      "Recent Cherax quadricarinatus culture study",

    sourceTwoUrl:
      STUDY_SOURCE,

    tone: "research",
  },
];

/*
|--------------------------------------------------------------------------
| SANITIZE LEGACY VALUES
|--------------------------------------------------------------------------
|
| Earlier CrayThrive versions used values such as:
|
| turbidityMax = 40
| waterLevelMin = 35
|
| Those are incompatible with the present 0–5V and 0–20cm controls.
|
| We normalize them locally rather than displaying an impossible slider value.
|
*/

function sanitizeOperationalThresholds(
  values
) {
  const normalized =
    normalizeThresholds(
      values
    );

  return {
    ...normalized,

    turbidityMax:
      Number(
        normalized
          .turbidityMax
      ) >= 0 &&
      Number(
        normalized
          .turbidityMax
      ) <= 5
        ? Number(
            normalized
              .turbidityMax
          )
        : DEFAULT_THRESHOLDS
            .turbidityMax,

    waterLevelMin:
      Number(
        normalized
          .waterLevelMin
      ) >= 0 &&
      Number(
        normalized
          .waterLevelMin
      ) <= 20
        ? Number(
            normalized
              .waterLevelMin
          )
        : DEFAULT_THRESHOLDS
            .waterLevelMin,
  };
}

/*
|--------------------------------------------------------------------------
| VALIDATION
|--------------------------------------------------------------------------
*/

function validateThresholds(
  thresholds
) {
  const temperatureMin =
    Number(
      thresholds
        .temperatureMin
    );

  const temperatureMax =
    Number(
      thresholds
        .temperatureMax
    );

  const phMin =
    Number(
      thresholds.phMin
    );

  const phMax =
    Number(
      thresholds.phMax
    );

  const turbidity =
    Number(
      thresholds
        .turbidityMax
    );

  const waterLevel =
    Number(
      thresholds
        .waterLevelMin
    );

  const ammonia =
    Number(
      thresholds
        .ammoniaMax
    );

  if (
    !Number.isFinite(
      temperatureMin
    ) ||
    !Number.isFinite(
      temperatureMax
    )
  ) {
    return {
      valid: false,
      message:
        "Temperature thresholds must contain valid numbers.",
    };
  }

  if (
    temperatureMin <
      10 ||
    temperatureMax >
      40
  ) {
    return {
      valid: false,
      message:
        "Temperature values must remain between 10°C and 40°C.",
    };
  }

  if (
    temperatureMin >=
    temperatureMax
  ) {
    return {
      valid: false,
      message:
        "Temperature minimum must be lower than temperature maximum.",
    };
  }

  if (
    !Number.isFinite(
      phMin
    ) ||
    !Number.isFinite(
      phMax
    )
  ) {
    return {
      valid: false,
      message:
        "pH thresholds must contain valid numbers.",
    };
  }

  if (
    phMin < 0 ||
    phMax > 14
  ) {
    return {
      valid: false,
      message:
        "pH values must remain between 0 and 14.",
    };
  }

  if (
    phMin >= phMax
  ) {
    return {
      valid: false,
      message:
        "pH minimum must be lower than pH maximum.",
    };
  }

  if (
    !Number.isFinite(
      turbidity
    ) ||
    turbidity < 0 ||
    turbidity > 5
  ) {
    return {
      valid: false,
      message:
        "Water-clarity sensor voltage must remain between 0V and 5V.",
    };
  }

  if (
    !Number.isFinite(
      waterLevel
    ) ||
    waterLevel < 0 ||
    waterLevel > 20
  ) {
    return {
      valid: false,
      message:
        "Water-level minimum must remain between 0cm and 20cm for the current prototype.",
    };
  }

  if (
    !Number.isFinite(
      ammonia
    ) ||
    ammonia < 0 ||
    ammonia > 5
  ) {
    return {
      valid: false,
      message:
        "Ammonia threshold must remain between 0mg/L and 5mg/L.",
    };
  }

  return {
    valid: true,
    message: "",
  };
}

/*
|--------------------------------------------------------------------------
| AUTH
|--------------------------------------------------------------------------
*/

async function getCurrentUser() {
  const {
    data,
    error,
  } =
    await supabase.auth.getSession();

  if (error) {
    logDiagnostic(
      "GET SESSION ERROR:",
      error
    );

    return null;
  }

  return (
    data?.session?.user ||
    null
  );
}

/*
|--------------------------------------------------------------------------
| LOAD
|--------------------------------------------------------------------------
*/

async function loadThresholdRow(
  userId
) {
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

  if (error) {
    throw error;
  }

  return data;
}

/*
|--------------------------------------------------------------------------
| SAVE ACTIVE THRESHOLDS
|--------------------------------------------------------------------------
*/

async function saveThresholdsToSupabase(
  userId,
  thresholds,
  extraValues = {}
) {
  const cleanThresholds =
    sanitizeOperationalThresholds(
      thresholds
    );

  const payload = {
    user_id:
      userId,

    thresholds:
      cleanThresholds,

    temperature_min:
      Number(
        cleanThresholds
          .temperatureMin
      ),

    temperature_max:
      Number(
        cleanThresholds
          .temperatureMax
      ),

    ph_min:
      Number(
        cleanThresholds
          .phMin
      ),

    ph_max:
      Number(
        cleanThresholds
          .phMax
      ),

    turbidity_max:
      Number(
        cleanThresholds
          .turbidityMax
      ),

    water_level_min:
      Number(
        cleanThresholds
          .waterLevelMin
      ),

    ammonia_max:
      Number(
        cleanThresholds
          .ammoniaMax
      ),

    updated_at:
      new Date()
        .toISOString(),

    ...extraValues,
  };

  const {
    data,
    error,
  } =
    await supabase
      .from(
        TABLE_NAME
      )
      .upsert(
        payload,
        {
          onConflict:
            "user_id",
        }
      )
      .select("*")
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/*
|--------------------------------------------------------------------------
| CLEAR PENDING AI SUGGESTION
|--------------------------------------------------------------------------
*/

async function clearPendingAiSuggestion(
  userId
) {
  const {
    error,
  } =
    await supabase
      .from(
        TABLE_NAME
      )
      .update({
        pending_ai_suggestion:
          null,

        pending_ai_suggested_at:
          null,

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "user_id",
        userId
      );

  if (error) {
    throw error;
  }
}

/*
|--------------------------------------------------------------------------
| APPLY AI SUGGESTION TO THRESHOLD OBJECT
|--------------------------------------------------------------------------
*/

function applySuggestionToThresholds(
  currentThresholds,
  suggestion
) {
  const next = {
    ...sanitizeOperationalThresholds(
      currentThresholds
    ),
  };

  const parameter =
    normalizeAiParameter(
      suggestion
        ?.parameter
    );

  const suggestedMin =
    firstNumber(
      suggestion
        ?.suggested_min,
      suggestion
        ?.suggested
        ?.min
    );

  const suggestedMax =
    firstNumber(
      suggestion
        ?.suggested_max,
      suggestion
        ?.suggested
        ?.max
    );

  const suggestedValue =
    firstNumber(
      suggestion
        ?.suggested_value,
      suggestion
        ?.suggested
        ?.value,
      typeof suggestion
        ?.suggested ===
      "number"
        ? suggestion
            .suggested
        : null
    );

  switch (
    parameter
  ) {
    case "temperature":
      if (
        suggestedMin ===
          null ||
        suggestedMax ===
          null
      ) {
        throw new Error(
          "The pending temperature suggestion is incomplete."
        );
      }

      next.temperatureMin =
        suggestedMin;

      next.temperatureMax =
        suggestedMax;

      break;

    case "ph":
      if (
        suggestedMin ===
          null ||
        suggestedMax ===
          null
      ) {
        throw new Error(
          "The pending pH suggestion is incomplete."
        );
      }

      next.phMin =
        suggestedMin;

      next.phMax =
        suggestedMax;

      break;

    case "turbidity": {
      const value =
        suggestedValue ??
        suggestedMin ??
        suggestedMax;

      if (
        value === null
      ) {
        throw new Error(
          "The pending turbidity suggestion is incomplete."
        );
      }

      next.turbidityMax =
        value;

      break;
    }

    case "water_level": {
      const value =
        suggestedValue ??
        suggestedMin ??
        suggestedMax;

      if (
        value === null
      ) {
        throw new Error(
          "The pending water-level suggestion is incomplete."
        );
      }

      next.waterLevelMin =
        value;

      break;
    }

    case "ammonia": {
      const value =
        suggestedValue ??
        suggestedMax ??
        suggestedMin;

      if (
        value === null
      ) {
        throw new Error(
          "The pending ammonia suggestion is incomplete."
        );
      }

      next.ammoniaMax =
        value;

      break;
    }

    default:
      throw new Error(
        "The pending AI suggestion uses an unsupported parameter."
      );
  }

  const validation =
    validateThresholds(
      next
    );

  if (
    !validation.valid
  ) {
    throw new Error(
      validation.message
    );
  }

  return next;
}

/*
|--------------------------------------------------------------------------
| THRESHOLD CONTROL
|--------------------------------------------------------------------------
*/

function ThresholdControl({
  item,
  value,
  onChange,
}) {
  const Icon =
    item.icon;

  const isResearch =
    item.tone ===
    "research";

  return (
    <article className="modern-setting-threshold-card">
      {/* HEADER */}

      <div className="modern-setting-threshold-top">
        <span>
          <Icon size={20} />
        </span>

        <div>
          <strong>
            {item.label}
          </strong>

          <small>
            {item.helper}
          </small>
        </div>
      </div>

      {/* ACTIVE VALUE */}

      <div
        style={
          activeValueHeaderStyle
        }
      >
        <span>
          Current Active Setting
        </span>

        <strong>
          {formatThresholdValue(
            item,
            value
          )}
        </strong>
      </div>

      {/* CONTROL */}

      <div className="modern-setting-threshold-control">
        <input
          type="range"
          min={item.min}
          max={item.max}
          step={item.step}
          value={value}
          onChange={(
            event
          ) =>
            onChange(
              item.key,
              event.target
                .value
            )
          }
        />

        <label>
          <input
            type="number"
            min={item.min}
            max={item.max}
            step={item.step}
            value={value}
            onChange={(
              event
            ) =>
              onChange(
                item.key,
                event.target
                  .value
              )
            }
          />

          <span>
            {item.unit}
          </span>
        </label>
      </div>

      {/* RESEARCH / CALIBRATION BASIS */}

      <div
        style={{
          ...referenceBoxStyle,

          ...(isResearch
            ? researchReferenceStyle
            : calibrationReferenceStyle),
        }}
      >
        <div
          style={
            referenceHeaderStyle
          }
        >
          <div
            style={
              referenceHeaderLeftStyle
            }
          >
            {isResearch ? (
              <BookOpen
                size={16}
              />
            ) : (
              <Settings
                size={16}
              />
            )}

            <span>
              {
                item.referenceType
              }
            </span>
          </div>

          <strong
            style={
              referenceValueStyle
            }
          >
            {
              item.recommendedValue
            }
          </strong>
        </div>

        <strong
          style={
            recommendedTitleStyle
          }
        >
          {
            item.recommendedTitle
          }
        </strong>

        <p
          style={
            referenceDescriptionStyle
          }
        >
          {
            item.recommendation
          }
        </p>

        <div
          style={
            supportingReferenceStyle
          }
        >
          <Info
            size={14}
          />

          <span>
            {
              item.secondaryReference
            }
          </span>
        </div>

        {item.measurementWarning ? (
          <div
            style={
              measurementWarningStyle
            }
          >
            <AlertTriangle
              size={14}
            />

            <span>
              {
                item.measurementWarning
              }
            </span>
          </div>
        ) : null}

        <div
          style={
            sourcesStyle
          }
        >
          <span
            style={
              sourceLabelStyle
            }
          >
            Basis
          </span>

          {item.sourceUrl ? (
            <a
              href={
                item.sourceUrl
              }
              target="_blank"
              rel="noreferrer"
              style={
                sourceLinkStyle
              }
            >
              {
                item.sourceName
              }

              <ExternalLink
                size={12}
              />
            </a>
          ) : (
            <strong
              style={
                localSourceStyle
              }
            >
              {
                item.sourceName
              }
            </strong>
          )}

          {item.sourceTwoUrl ? (
            <a
              href={
                item.sourceTwoUrl
              }
              target="_blank"
              rel="noreferrer"
              style={
                sourceLinkStyle
              }
            >
              {
                item.sourceTwoName
              }

              <ExternalLink
                size={12}
              />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/*
|--------------------------------------------------------------------------
| AI SUGGESTION CARD
|--------------------------------------------------------------------------
*/

function PendingAiSuggestionCard({
  suggestion,
  suggestedAt,
  thresholds,
  isApplying,
  isDismissing,
  onApply,
  onDismiss,
}) {
  if (
    !suggestion
  ) {
    return null;
  }

  const parameter =
    normalizeAiParameter(
      suggestion
        ?.parameter
    );

  const parameterLabel =
    getAiParameterLabel(
      parameter
    );

  const currentDisplay =
    getAiCurrentValueDisplay(
      parameter,
      thresholds,
      suggestion
    );

  const suggestedDisplay =
    getAiSuggestedValueDisplay(
      parameter,
      suggestion
    );

  return (
    <section
      className="modern-settings-panel modern-settings-wide"
      style={
        aiPanelStyle
      }
    >
      <div
        style={
          aiGlowStyle
        }
      />

      <div
        className="modern-panel-heading"
        style={{
          position:
            "relative",

          zIndex:
            1,
        }}
      >
        <div>
          <p className="dashboard-eyebrow">
            AI Review
          </p>

          <h3>
            Pending threshold suggestion
          </h3>

          <p
            style={
              sectionDescriptionStyle
            }
          >
            CrayThrive AI suggested a change from the mobile app. Review it before updating your active settings.
          </p>
        </div>

        <div
          style={
            aiIconStyle
          }
        >
          <Sparkles
            size={22}
          />
        </div>
      </div>

      <div
        style={
          aiContentStyle
        }
      >
        <div
          style={
            aiParameterHeaderStyle
          }
        >
          <div>
            <span
              style={
                aiMiniLabelStyle
              }
            >
              Parameter
            </span>

            <strong
              style={
                aiParameterTitleStyle
              }
            >
              {
                parameterLabel
              }
            </strong>
          </div>

          {suggestedAt ? (
            <div
              style={
                aiDateStyle
              }
            >
              <Clock3
                size={14}
              />

              {formatDateTime(
                suggestedAt
              )}
            </div>
          ) : null}
        </div>

        <div
          style={
            aiComparisonStyle
          }
        >
          <div
            style={
              aiValueCardStyle
            }
          >
            <span>
              Current Active
            </span>

            <strong>
              {
                currentDisplay
              }
            </strong>
          </div>

          <div
            style={
              aiArrowStyle
            }
          >
            →
          </div>

          <div
            style={{
              ...aiValueCardStyle,

              ...aiSuggestedValueStyle,
            }}
          >
            <span>
              AI Suggested
            </span>

            <strong>
              {
                suggestedDisplay
              }
            </strong>
          </div>
        </div>

        {suggestion
          ?.reason ? (
          <div
            style={
              aiReasonStyle
            }
          >
            <Info
              size={16}
            />

            <div>
              <strong>
                Why was this suggested?
              </strong>

              <p>
                {
                  suggestion
                    .reason
                }
              </p>
            </div>
          </div>
        ) : null}

        <div
          style={
            aiHumanControlStyle
          }
        >
          <ShieldCheck
            size={16}
          />

          <span>
            AI only recommends changes. Your active threshold remains unchanged until you approve it here.
          </span>
        </div>

        <div
          style={
            aiActionsStyle
          }
        >
          <button
            type="button"
            className="dashboard-primary-button"
            onClick={
              onApply
            }
            disabled={
              isApplying ||
              isDismissing
            }
          >
            {isApplying ? (
              <>
                Applying...

                <Loader2
                  size={17}
                  className="spin-icon"
                />
              </>
            ) : (
              <>
                <Check
                  size={17}
                />

                Apply Suggestion
              </>
            )}
          </button>

          <button
            type="button"
            className="modern-secondary-link"
            onClick={
              onDismiss
            }
            disabled={
              isApplying ||
              isDismissing
            }
          >
            {isDismissing ? (
              <>
                Dismissing...

                <Loader2
                  size={17}
                  className="spin-icon"
                />
              </>
            ) : (
              <>
                <X
                  size={17}
                />

                Dismiss
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

/*
|--------------------------------------------------------------------------
| PAGE
|--------------------------------------------------------------------------
*/

export default function ThresholdSettingsPage() {
  const [
    thresholds,
    setThresholds,
  ] =
    useState(() =>
      sanitizeOperationalThresholds(
        getLocalThresholds()
      )
    );

  const [
    user,
    setUser,
  ] =
    useState(
      null
    );

  const [
    dataSource,
    setDataSource,
  ] =
    useState(
      "localStorage"
    );

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(
      true
    );

  const [
    isSaving,
    setIsSaving,
  ] =
    useState(
      false
    );

  const [
    message,
    setMessage,
  ] =
    useState(
      ""
    );

  const [
    messageType,
    setMessageType,
  ] =
    useState(
      "success"
    );

  const [
    pendingAiSuggestion,
    setPendingAiSuggestion,
  ] =
    useState(
      null
    );

  const [
    pendingAiSuggestedAt,
    setPendingAiSuggestedAt,
  ] =
    useState(
      null
    );

  const [
    isApplyingAi,
    setIsApplyingAi,
  ] =
    useState(
      false
    );

  const [
    isDismissingAi,
    setIsDismissingAi,
  ] =
    useState(
      false
    );

  const validation =
    useMemo(
      () =>
        validateThresholds(
          thresholds
        ),
      [
        thresholds,
      ]
    );

  /*
  |--------------------------------------------------------------------------
  | LOAD SETTINGS
  |--------------------------------------------------------------------------
  */

  async function loadSettings() {
    setMessage("");

    if (
      !isSupabaseConfigured ||
      !supabase
    ) {
      setDataSource(
        "localStorage"
      );

      setThresholds(
        sanitizeOperationalThresholds(
          getLocalThresholds()
        )
      );

      setIsLoading(
        false
      );

      return;
    }

    try {
      setIsLoading(
        true
      );

      const currentUser =
        await getCurrentUser();

      setUser(
        currentUser
      );

      if (
        !currentUser?.id
      ) {
        setDataSource(
          "localStorage"
        );

        setThresholds(
          sanitizeOperationalThresholds(
            getLocalThresholds()
          )
        );

        return;
      }

      const row =
        await loadThresholdRow(
          currentUser.id
        );

      if (!row) {
        const local =
          sanitizeOperationalThresholds(
            getLocalThresholds()
          );

        setThresholds(
          local
        );

        setDataSource(
          "localStorage"
        );

        return;
      }

      const normalized =
        sanitizeOperationalThresholds(
          row
        );

      setThresholds(
        normalized
      );

      setDataSource(
        TABLE_NAME
      );

      setPendingAiSuggestion(
        normalizePendingSuggestion(
          row.pending_ai_suggestion
        )
      );

      setPendingAiSuggestedAt(
        row.pending_ai_suggested_at ||
          null
      );

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          normalized
        )
      );

      /*
       * Notify user if old invalid values were automatically
       * normalized for display.
       */

      const raw =
        normalizeThresholds(
          row
        );

      if (
        Number(
          raw.turbidityMax
        ) > 5 ||
        Number(
          raw.waterLevelMin
        ) > 20
      ) {
        setMessageType(
          "warning"
        );

        setMessage(
          "Older incompatible turbidity or water-level values were replaced with the current CrayThrive prototype defaults for this screen. Save Settings to synchronize the corrected values."
        );
      }
    } catch (
      error
    ) {
      logDiagnostic(
        "THRESHOLD SETTINGS LOAD ERROR:",
        error
      );

      setDataSource(
        "localStorage"
      );

      setThresholds(
        sanitizeOperationalThresholds(
          getLocalThresholds()
        )
      );

      setMessageType(
        "warning"
      );

      setMessage(
        getSafeErrorMessage(error, "Loaded local thresholds because Supabase was not available.")
      );
    } finally {
      setIsLoading(
        false
      );
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  /*
  |--------------------------------------------------------------------------
  | MANUAL CHANGE
  |--------------------------------------------------------------------------
  */

  function handleThresholdChange(
    key,
    value
  ) {
    setMessage("");

    setThresholds(
      (
        current
      ) => ({
        ...current,

        [key]:
          Number(
            value
          ),
      })
    );
  }

  /*
  |--------------------------------------------------------------------------
  | RESET
  |--------------------------------------------------------------------------
  */

  function handleResetDefaults() {
    setThresholds({
      ...DEFAULT_THRESHOLDS,
    });

    setMessageType(
      "success"
    );

    setMessage(
      "CrayThrive fallback defaults restored. Click Save Settings to make them active."
    );
  }

  /*
  |--------------------------------------------------------------------------
  | MANUAL SAVE
  |--------------------------------------------------------------------------
  */

  async function handleSave() {
    setMessage("");

    const result =
      validateThresholds(
        thresholds
      );

    if (
      !result.valid
    ) {
      setMessageType(
        "warning"
      );

      setMessage(
        result.message
      );

      return;
    }

    try {
      setIsSaving(
        true
      );

      const clean =
        sanitizeOperationalThresholds(
          thresholds
        );

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          clean
        )
      );

      if (
        !isSupabaseConfigured ||
        !supabase ||
        !user?.id
      ) {
        setThresholds(
          clean
        );

        setDataSource(
          "localStorage"
        );

        setMessageType(
          "warning"
        );

        setMessage(
          "Saved locally only. Sign in and connect Supabase to synchronize these settings."
        );

        return;
      }

      const saved =
        await saveThresholdsToSupabase(
          user.id,
          clean
        );

      const savedThresholds =
        sanitizeOperationalThresholds(
          saved ||
            clean
        );

      setThresholds(
        savedThresholds
      );

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          savedThresholds
        )
      );

      setDataSource(
        TABLE_NAME
      );

      setMessageType(
        "success"
      );

      setMessage(
        "Active thresholds saved to Supabase. Web and mobile can now use the same values."
      );
    } catch (
      error
    ) {
      logDiagnostic(
        "THRESHOLD SETTINGS SAVE ERROR:",
        error
      );

      setMessageType(
        "warning"
      );

      setMessage(
        getSafeErrorMessage(error, "Could not save threshold settings to Supabase.")
      );
    } finally {
      setIsSaving(
        false
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | APPLY AI SUGGESTION
  |--------------------------------------------------------------------------
  */

  async function handleApplyAiSuggestion() {
    if (
      !pendingAiSuggestion
    ) {
      return;
    }

    if (
      !user?.id ||
      !supabase
    ) {
      setMessageType(
        "warning"
      );

      setMessage(
        "Sign in before applying an AI threshold suggestion."
      );

      return;
    }

    try {
      setIsApplyingAi(
        true
      );

      setMessage("");

      /*
       * Reload latest row first.
       *
       * This prevents an old browser copy from overwriting
       * thresholds that may have changed elsewhere.
       */

      const latestRow =
        await loadThresholdRow(
          user.id
        );

      const latestThresholds =
        sanitizeOperationalThresholds(
          latestRow ||
            thresholds
        );

      const latestSuggestion =
        normalizePendingSuggestion(
          latestRow
            ?.pending_ai_suggestion
        ) ||
        pendingAiSuggestion;

      const nextThresholds =
        applySuggestionToThresholds(
          latestThresholds,
          latestSuggestion
        );

      const saved =
        await saveThresholdsToSupabase(
          user.id,
          nextThresholds,
          {
            pending_ai_suggestion:
              null,

            pending_ai_suggested_at:
              null,
          }
        );

      const cleanSaved =
        sanitizeOperationalThresholds(
          saved ||
            nextThresholds
        );

      setThresholds(
        cleanSaved
      );

      setPendingAiSuggestion(
        null
      );

      setPendingAiSuggestedAt(
        null
      );

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          cleanSaved
        )
      );

      setDataSource(
        TABLE_NAME
      );

      setMessageType(
        "success"
      );

      setMessage(
        "AI threshold suggestion applied successfully. The updated values are now active in CrayThrive."
      );
    } catch (
      error
    ) {
      logDiagnostic(
        "APPLY AI THRESHOLD ERROR:",
        error
      );

      setMessageType(
        "warning"
      );

      setMessage(
        getSafeErrorMessage(error, "The AI threshold suggestion could not be applied.")
      );
    } finally {
      setIsApplyingAi(
        false
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | DISMISS AI SUGGESTION
  |--------------------------------------------------------------------------
  */

  async function handleDismissAiSuggestion() {
    if (
      !user?.id ||
      !supabase
    ) {
      return;
    }

    try {
      setIsDismissingAi(
        true
      );

      setMessage("");

      await clearPendingAiSuggestion(
        user.id
      );

      setPendingAiSuggestion(
        null
      );

      setPendingAiSuggestedAt(
        null
      );

      setMessageType(
        "success"
      );

      setMessage(
        "AI suggestion dismissed. Your active threshold settings were not changed."
      );
    } catch (
      error
    ) {
      logDiagnostic(
        "DISMISS AI THRESHOLD ERROR:",
        error
      );

      setMessageType(
        "warning"
      );

      setMessage(
        getSafeErrorMessage(error, "The AI suggestion could not be dismissed.")
      );
    } finally {
      setIsDismissingAi(
        false
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | LOADING
  |--------------------------------------------------------------------------
  */

  if (
    isLoading
  ) {
    return (
      <section className="modern-settings-loading">
        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading threshold settings...
        </h3>

        <p>
          CrayThrive is loading your active thresholds, research references, and AI review status.
        </p>
      </section>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | PAGE UI
  |--------------------------------------------------------------------------
  */

  return (
    <div className="modern-settings-page">
      {/* ==============================================================
          HERO
      =============================================================== */}

      <section className="modern-settings-hero">
        <div>
          <p className="dashboard-eyebrow">
            Threshold Settings
          </p>

          <h2>
            Configure tank condition thresholds.
          </h2>

          <p>
            Adjust the active values used by CrayThrive for monitoring and alerts. Each setting also shows its research or prototype-calibration basis so the operational threshold is not confused with published guidance.
          </p>

          <div className="modern-settings-actions">
            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                handleSave
              }
              disabled={
                isSaving ||
                !validation.valid
              }
            >
              {isSaving ? (
                <>
                  Saving...

                  <Loader2
                    className="spin-icon"
                    size={18}
                  />
                </>
              ) : (
                <>
                  Save Settings

                  <Save
                    size={18}
                  />
                </>
              )}
            </button>

            <button
              type="button"
              className="modern-secondary-link"
              onClick={
                handleResetDefaults
              }
            >
              <RefreshCw
                size={18}
              />

              Restore Defaults
            </button>

            <span>
              Source:{" "}
              {dataSource ===
              TABLE_NAME
                ? "Supabase"
                : "Browser cache"}
            </span>
          </div>
        </div>

        <div className="modern-settings-hero-card">
          <Settings
            size={38}
          />

          <strong>
            {validation.valid
              ? "Ready"
              : "Check"}
          </strong>

          <span>
            {validation.valid
              ? "Threshold values are valid"
              : "Some values need review"}
          </span>
        </div>
      </section>

      {/* ==============================================================
          MESSAGE
      =============================================================== */}

      {message && (
        <section
          className={`modern-settings-message ${
            messageType ===
            "warning"
              ? "warning"
              : "success"
          }`}
        >
          {messageType ===
          "warning" ? (
            <AlertTriangle
              size={20}
            />
          ) : (
            <CheckCircle2
              size={20}
            />
          )}

          <span>
            {message}
          </span>
        </section>
      )}

      {/* ==============================================================
          PENDING AI SUGGESTION
      =============================================================== */}

      <PendingAiSuggestionCard
        suggestion={
          pendingAiSuggestion
        }
        suggestedAt={
          pendingAiSuggestedAt
        }
        thresholds={
          thresholds
        }
        isApplying={
          isApplyingAi
        }
        isDismissing={
          isDismissingAi
        }
        onApply={
          handleApplyAiSuggestion
        }
        onDismiss={
          handleDismissAiSuggestion
        }
      />

      {/* ==============================================================
          EXPLANATION
      =============================================================== */}

      <section
        className="modern-settings-panel modern-settings-wide"
        style={
          explanationPanelStyle
        }
      >
        <div
          style={
            explanationIconStyle
          }
        >
          <Info
            size={21}
          />
        </div>

        <div>
          <strong>
            Active setting vs. recommended reference
          </strong>

          <p
            style={
              explanationPanelTextStyle
            }
          >
            The number you save is the operational value actually used by CrayThrive. The recommended value shown inside each card is supporting research or prototype-calibration information and does not automatically replace your active setting.
          </p>
        </div>
      </section>

      {/* ==============================================================
          ACTIVE SETTINGS
      =============================================================== */}

      <section className="modern-settings-panel modern-settings-wide">
        <div className="modern-panel-heading">
          <div>
            <p className="dashboard-eyebrow">
              Active Thresholds
            </p>

            <h3>
              Water-condition rules
            </h3>

            <p
              style={
                sectionDescriptionStyle
              }
            >
              Review the study or calibration basis shown directly below every editable threshold.
            </p>
          </div>

          <Database
            size={22}
          />
        </div>

        <div className="modern-setting-threshold-grid">
          {thresholdRows.map(
            (
              item
            ) => (
              <ThresholdControl
                key={
                  item.key
                }
                item={
                  item
                }
                value={
                  thresholds[
                    item.key
                  ]
                }
                onChange={
                  handleThresholdChange
                }
              />
            )
          )}
        </div>
      </section>

      {/* ==============================================================
          EXPERT VALIDATION NOTE
      =============================================================== */}

      <section className="modern-settings-panel modern-settings-wide">
        <div className="modern-panel-heading">
          <div>
            <p className="dashboard-eyebrow">
              Expert Validation
            </p>

            <h3>
              Survey recommendations
            </h3>
          </div>

          <ShieldCheck
            size={22}
          />
        </div>

        <div
          style={
            validationNoticeStyle
          }
        >
          <AlertTriangle
            size={20}
          />

          <div>
            <strong>
              Pending actual validation results
            </strong>

            <p
              style={
                validationNoticeTextStyle
              }
            >
              CrayThrive will only display expert or aquaculture-specialist threshold recommendations after the study's actual validation responses have been collected and analyzed. No survey result is being assumed in advance.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| AI DISPLAY HELPERS
|--------------------------------------------------------------------------
*/

function normalizeAiParameter(
  value
) {
  const parameter =
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
    parameter ===
      "temperature" ||
    parameter ===
      "temp" ||
    parameter ===
      "water_temperature"
  ) {
    return "temperature";
  }

  if (
    parameter === "ph" ||
    parameter ===
      "ph_level"
  ) {
    return "ph";
  }

  if (
    parameter ===
      "turbidity" ||
    parameter ===
      "clarity" ||
    parameter ===
      "water_clarity"
  ) {
    return "turbidity";
  }

  if (
    parameter ===
      "water" ||
    parameter ===
      "water_level" ||
    parameter ===
      "water_depth"
  ) {
    return "water_level";
  }

  if (
    parameter ===
      "ammonia" ||
    parameter ===
      "nh3"
  ) {
    return "ammonia";
  }

  return parameter;
}

function normalizePendingSuggestion(
  value
) {
  if (!value) {
    return null;
  }

  if (
    typeof value ===
    "string"
  ) {
    try {
      const parsed =
        JSON.parse(
          value
        );

      return parsed &&
        typeof parsed ===
          "object"
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  if (
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  ) {
    return value;
  }

  return null;
}

function getAiParameterLabel(
  parameter
) {
  switch (
    parameter
  ) {
    case "temperature":
      return "Water Temperature";

    case "ph":
      return "pH Level";

    case "turbidity":
      return "Water Clarity";

    case "water_level":
      return "Water Level";

    case "ammonia":
      return "Ammonia";

    default:
      return "Threshold";
  }
}

function getAiCurrentValueDisplay(
  parameter,
  thresholds,
  suggestion
) {
  switch (
    parameter
  ) {
    case "temperature":
      return `${formatNumber(
        thresholds
          .temperatureMin
      )}–${formatNumber(
        thresholds
          .temperatureMax
      )} °C`;

    case "ph":
      return `${formatNumber(
        thresholds.phMin
      )}–${formatNumber(
        thresholds.phMax
      )} pH`;

    case "turbidity":
      return `≥ ${formatNumber(
        thresholds
          .turbidityMax
      )} V`;

    case "water_level":
      return `≥ ${formatNumber(
        thresholds
          .waterLevelMin
      )} cm`;

    case "ammonia":
      return `≤ ${formatNumber(
        thresholds
          .ammoniaMax
      )} mg/L`;

    default:
      return (
        suggestion
          ?.current_value ??
        "—"
      );
  }
}

function getAiSuggestedValueDisplay(
  parameter,
  suggestion
) {
  const min =
    firstNumber(
      suggestion
        ?.suggested_min,
      suggestion
        ?.suggested
        ?.min
    );

  const max =
    firstNumber(
      suggestion
        ?.suggested_max,
      suggestion
        ?.suggested
        ?.max
    );

  const value =
    firstNumber(
      suggestion
        ?.suggested_value,
      suggestion
        ?.suggested
        ?.value
    );

  switch (
    parameter
  ) {
    case "temperature":
      return min !==
        null &&
        max !== null
        ? `${formatNumber(
            min
          )}–${formatNumber(
            max
          )} °C`
        : "Incomplete";

    case "ph":
      return min !==
        null &&
        max !== null
        ? `${formatNumber(
            min
          )}–${formatNumber(
            max
          )} pH`
        : "Incomplete";

    case "turbidity":
      return value !==
        null
        ? `≥ ${formatNumber(
            value
          )} V`
        : "Incomplete";

    case "water_level":
      return value !==
        null
        ? `≥ ${formatNumber(
            value
          )} cm`
        : "Incomplete";

    case "ammonia":
      return value !==
        null
        ? `≤ ${formatNumber(
            value
          )} mg/L`
        : "Incomplete";

    default:
      return "—";
  }
}

/*
|--------------------------------------------------------------------------
| GENERAL HELPERS
|--------------------------------------------------------------------------
*/

function firstNumber(
  ...values
) {
  for (
    const value of
    values
  ) {
    if (
      value ===
        null ||
      value ===
        undefined ||
      value ===
        ""
    ) {
      continue;
    }

    const number =
      Number(
        value
      );

    if (
      Number.isFinite(
        number
      )
    ) {
      return number;
    }
  }

  return null;
}

function formatThresholdValue(
  item,
  value
) {
  const numeric =
    formatNumber(
      value
    );

  if (
    item.key ===
    "turbidityMax"
  ) {
    return `≥ ${numeric} ${item.unit}`;
  }

  if (
    item.key ===
    "waterLevelMin"
  ) {
    return `≥ ${numeric} ${item.unit}`;
  }

  if (
    item.key ===
    "ammoniaMax"
  ) {
    return `≤ ${numeric} ${item.unit}`;
  }

  return `${numeric} ${item.unit}`;
}

function formatNumber(
  value
) {
  const numeric =
    Number(
      value
    );

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return "—";
  }

  if (
    Number.isInteger(
      numeric
    )
  ) {
    return String(
      numeric
    );
  }

  return numeric
    .toFixed(2)
    .replace(
      /0+$/,
      ""
    )
    .replace(
      /\.$/,
      ""
    );
}

function formatDateTime(
  value
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return date.toLocaleString(
    undefined,
    {
      dateStyle:
        "medium",

      timeStyle:
        "short",
    }
  );
}

/*
|--------------------------------------------------------------------------
| INLINE UI STYLES FOR NEW SECTIONS
|--------------------------------------------------------------------------
|
| Existing classes still control the main CrayThrive visual theme.
|--------------------------------------------------------------------------
*/

const sectionDescriptionStyle = {
  margin:
    "5px 0 0",

  opacity:
    0.68,

  fontSize:
    "0.84rem",

  lineHeight:
    1.5,
};

const activeValueHeaderStyle = {
  display:
    "flex",

  alignItems:
    "center",

  justifyContent:
    "space-between",

  gap:
    "12px",

  margin:
    "12px 0 4px",

  padding:
    "9px 11px",

  borderRadius:
    "11px",

  background:
    "rgba(59, 130, 246, 0.06)",

  border:
    "1px solid rgba(59, 130, 246, 0.11)",

  fontSize:
    "0.78rem",
};

const referenceBoxStyle = {
  marginTop:
    "14px",

  padding:
    "13px",

  borderRadius:
    "14px",

  border:
    "1px solid rgba(148, 163, 184, 0.14)",
};

const researchReferenceStyle = {
  background:
    "rgba(34, 197, 94, 0.055)",

  border:
    "1px solid rgba(34, 197, 94, 0.15)",
};

const calibrationReferenceStyle = {
  background:
    "rgba(245, 158, 11, 0.055)",

  border:
    "1px solid rgba(245, 158, 11, 0.15)",
};

const referenceHeaderStyle = {
  display:
    "flex",

  justifyContent:
    "space-between",

  alignItems:
    "center",

  gap:
    "10px",

  marginBottom:
    "8px",
};

const referenceHeaderLeftStyle = {
  display:
    "flex",

  alignItems:
    "center",

  gap:
    "6px",

  fontSize:
    "0.72rem",

  fontWeight:
    700,

  textTransform:
    "uppercase",

  letterSpacing:
    "0.035em",

  opacity:
    0.72,
};

const referenceValueStyle = {
  fontSize:
    "0.9rem",

  textAlign:
    "right",
};

const recommendedTitleStyle = {
  display:
    "block",

  marginBottom:
    "5px",

  fontSize:
    "0.84rem",
};

const referenceDescriptionStyle = {
  margin:
    0,

  fontSize:
    "0.78rem",

  lineHeight:
    1.5,

  opacity:
    0.78,
};

const supportingReferenceStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "6px",

  marginTop:
    "9px",

  padding:
    "8px 9px",

  borderRadius:
    "10px",

  background:
    "rgba(148, 163, 184, 0.06)",

  fontSize:
    "0.74rem",

  lineHeight:
    1.45,

  opacity:
    0.78,
};

const measurementWarningStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "6px",

  marginTop:
    "8px",

  padding:
    "8px 9px",

  borderRadius:
    "10px",

  background:
    "rgba(245, 158, 11, 0.09)",

  fontSize:
    "0.73rem",

  lineHeight:
    1.45,
};

const sourcesStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  alignItems:
    "flex-start",

  gap:
    "4px",

  marginTop:
    "10px",

  paddingTop:
    "9px",

  borderTop:
    "1px solid rgba(148, 163, 184, 0.13)",
};

const sourceLabelStyle = {
  fontSize:
    "0.68rem",

  fontWeight:
    700,

  textTransform:
    "uppercase",

  letterSpacing:
    "0.04em",

  opacity:
    0.52,
};

const sourceLinkStyle = {
  display:
    "inline-flex",

  alignItems:
    "center",

  gap:
    "5px",

  fontSize:
    "0.72rem",

  fontWeight:
    650,

  color:
    "inherit",

  textDecoration:
    "underline",

  textUnderlineOffset:
    "3px",

  opacity:
    0.76,
};

const localSourceStyle = {
  fontSize:
    "0.72rem",

  opacity:
    0.74,
};

const explanationPanelStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "12px",
};

const explanationIconStyle = {
  width:
    "40px",

  height:
    "40px",

  display:
    "grid",

  placeItems:
    "center",

  flexShrink:
    0,

  borderRadius:
    "12px",

  background:
    "rgba(59, 130, 246, 0.09)",
};

const explanationPanelTextStyle = {
  margin:
    "5px 0 0",

  fontSize:
    "0.82rem",

  lineHeight:
    1.55,

  opacity:
    0.72,
};

const aiPanelStyle = {
  position:
    "relative",

  overflow:
    "hidden",

  border:
    "1px solid rgba(139, 92, 246, 0.18)",
};

const aiGlowStyle = {
  position:
    "absolute",

  top:
    "-100px",

  right:
    "-80px",

  width:
    "240px",

  height:
    "240px",

  borderRadius:
    "50%",

  background:
    "radial-gradient(circle, rgba(139, 92, 246, 0.14), transparent 68%)",

  pointerEvents:
    "none",
};

const aiIconStyle = {
  width:
    "42px",

  height:
    "42px",

  display:
    "grid",

  placeItems:
    "center",

  borderRadius:
    "13px",

  background:
    "rgba(139, 92, 246, 0.11)",
};

const aiContentStyle = {
  position:
    "relative",

  zIndex:
    1,

  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "14px",

  marginTop:
    "12px",
};

const aiParameterHeaderStyle = {
  display:
    "flex",

  alignItems:
    "center",

  justifyContent:
    "space-between",

  gap:
    "12px",
};

const aiMiniLabelStyle = {
  display:
    "block",

  marginBottom:
    "2px",

  fontSize:
    "0.68rem",

  textTransform:
    "uppercase",

  letterSpacing:
    "0.05em",

  opacity:
    0.54,
};

const aiParameterTitleStyle = {
  fontSize:
    "1rem",
};

const aiDateStyle = {
  display:
    "inline-flex",

  alignItems:
    "center",

  gap:
    "5px",

  fontSize:
    "0.73rem",

  opacity:
    0.62,
};

const aiComparisonStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "minmax(0, 1fr) auto minmax(0, 1fr)",

  alignItems:
    "center",

  gap:
    "10px",
};

const aiValueCardStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "5px",

  padding:
    "13px",

  borderRadius:
    "13px",

  background:
    "rgba(148, 163, 184, 0.055)",

  border:
    "1px solid rgba(148, 163, 184, 0.14)",

  fontSize:
    "0.76rem",
};

const aiSuggestedValueStyle = {
  background:
    "rgba(139, 92, 246, 0.07)",

  border:
    "1px solid rgba(139, 92, 246, 0.18)",
};

const aiArrowStyle = {
  fontSize:
    "1.25rem",

  opacity:
    0.45,
};

const aiReasonStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "9px",

  padding:
    "12px",

  borderRadius:
    "12px",

  background:
    "rgba(59, 130, 246, 0.055)",
};

const aiHumanControlStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "7px",

  fontSize:
    "0.76rem",

  lineHeight:
    1.45,

  opacity:
    0.75,
};

const aiActionsStyle = {
  display:
    "flex",

  alignItems:
    "center",

  flexWrap:
    "wrap",

  gap:
    "10px",
};

const validationNoticeStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "10px",

  padding:
    "14px",

  borderRadius:
    "14px",

  background:
    "rgba(245, 158, 11, 0.07)",

  border:
    "1px solid rgba(245, 158, 11, 0.14)",
};

const validationNoticeTextStyle = {
  margin:
    "4px 0 0",

  fontSize:
    "0.82rem",

  lineHeight:
    1.5,

  opacity:
    0.74,
};
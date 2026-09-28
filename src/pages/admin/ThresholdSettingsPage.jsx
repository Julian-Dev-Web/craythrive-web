import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  Droplets,
  Gauge,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Thermometer,
  Waves,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import {
  DEFAULT_THRESHOLDS,
  formatResearchReference,
  getLocalThresholds,
  getThresholdReference,
  normalizeThresholds,
} from "../../utils/thresholdEvaluation";

const STORAGE_KEY =
  "craythrive_threshold_settings";

const TABLE_NAME =
  "threshold_settings";

/*
|--------------------------------------------------------------------------
| EDITABLE THRESHOLD CONTROLS
|--------------------------------------------------------------------------
|
| These are the values the user can actually save and use in CrayThrive.
|
| IMPORTANT:
| - Research values are shown separately below.
| - Research values DO NOT automatically replace these values.
| - Mobile/web share the saved Supabase threshold_settings row.
|
*/

const thresholdRows = [
  {
    key:
      "temperatureMin",

    referenceKey:
      "temperature",

    label:
      "Temperature Minimum",

    helper:
      "Lowest active water temperature before CrayThrive flags the reading.",

    unit:
      "°C",

    icon:
      Thermometer,

    min:
      10,

    max:
      40,

    step:
      0.1,
  },

  {
    key:
      "temperatureMax",

    referenceKey:
      "temperature",

    label:
      "Temperature Maximum",

    helper:
      "Highest active water temperature before CrayThrive flags the reading.",

    unit:
      "°C",

    icon:
      Thermometer,

    min:
      10,

    max:
      40,

    step:
      0.1,
  },

  {
    key:
      "phMin",

    referenceKey:
      "ph",

    label:
      "pH Minimum",

    helper:
      "Lowest active pH level considered acceptable by CrayThrive.",

    unit:
      "pH",

    icon:
      Droplets,

    min:
      0,

    max:
      14,

    step:
      0.1,
  },

  {
    key:
      "phMax",

    referenceKey:
      "ph",

    label:
      "pH Maximum",

    helper:
      "Highest active pH level considered acceptable by CrayThrive.",

    unit:
      "pH",

    icon:
      Droplets,

    min:
      0,

    max:
      14,

    step:
      0.1,
  },

  {
    /*
     * Legacy DB/property name kept as turbidityMax
     * for compatibility with the existing system.
     *
     * Actual operational meaning:
     * minimum voltage considered clear.
     *
     * Higher voltage = clearer water.
     */
    key:
      "turbidityMax",

    referenceKey:
      "turbidity",

    label:
      "Water Clarity Minimum",

    helper:
      "Minimum turbidity-sensor voltage treated as clear. Higher voltage means clearer water.",

    unit:
      "V",

    icon:
      Waves,

    min:
      0,

    max:
      5,

    step:
      0.01,
  },

  {
    key:
      "waterLevelMin",

    referenceKey:
      "waterLevel",

    label:
      "Water Level Minimum",

    helper:
      "Lowest active tank water depth before CrayThrive identifies a low-water condition.",

    unit:
      "cm",

    icon:
      Gauge,

    min:
      0,

    max:
      20,

    step:
      0.1,
  },

  {
    key:
      "ammoniaMax",

    referenceKey:
      "ammonia",

    label:
      "Ammonia Maximum",

    helper:
      "Maximum active ammonia reading before CrayThrive flags the recorded test result.",

    unit:
      "mg/L",

    icon:
      AlertTriangle,

    min:
      0,

    max:
      5,

    step:
      0.01,
  },
];

/*
|--------------------------------------------------------------------------
| REFERENCE CARD ORDER
|--------------------------------------------------------------------------
*/

const referenceRows = [
  {
    key:
      "temperature",

    icon:
      Thermometer,
  },

  {
    key:
      "ph",

    icon:
      Droplets,
  },

  {
    key:
      "turbidity",

    icon:
      Waves,
  },

  {
    key:
      "waterLevel",

    icon:
      Gauge,
  },

  {
    key:
      "ammonia",

    icon:
      AlertTriangle,
  },
];

/*
|--------------------------------------------------------------------------
| VALIDATION
|--------------------------------------------------------------------------
*/

function isRangeValid(
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

  const water =
    Number(
      thresholds
        .waterLevelMin
    );

  const ammonia =
    Number(
      thresholds
        .ammoniaMax
    );

  return (
    Number.isFinite(
      temperatureMin
    ) &&
    Number.isFinite(
      temperatureMax
    ) &&
    temperatureMin >=
      10 &&
    temperatureMax <=
      40 &&
    temperatureMin <
      temperatureMax &&

    Number.isFinite(
      phMin
    ) &&
    Number.isFinite(
      phMax
    ) &&
    phMin >= 0 &&
    phMax <= 14 &&
    phMin <
      phMax &&

    Number.isFinite(
      turbidity
    ) &&
    turbidity >=
      0 &&
    turbidity <=
      5 &&

    Number.isFinite(
      water
    ) &&
    water >=
      0 &&
    water <=
      20 &&

    Number.isFinite(
      ammonia
    ) &&
    ammonia >=
      0 &&
    ammonia <=
      5
  );
}

function getValidationMessage(
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

  const water =
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
    return "Temperature thresholds must contain valid numbers.";
  }

  if (
    temperatureMin <
      10 ||
    temperatureMax >
      40
  ) {
    return "Temperature thresholds must remain between 10°C and 40°C.";
  }

  if (
    temperatureMin >=
    temperatureMax
  ) {
    return "Temperature minimum must be lower than temperature maximum.";
  }

  if (
    !Number.isFinite(
      phMin
    ) ||
    !Number.isFinite(
      phMax
    )
  ) {
    return "pH thresholds must contain valid numbers.";
  }

  if (
    phMin < 0 ||
    phMax > 14
  ) {
    return "pH thresholds must remain between 0 and 14.";
  }

  if (
    phMin >=
    phMax
  ) {
    return "pH minimum must be lower than pH maximum.";
  }

  if (
    !Number.isFinite(
      turbidity
    ) ||
    turbidity < 0 ||
    turbidity > 5
  ) {
    return "Water-clarity sensor voltage must remain between 0V and 5V.";
  }

  if (
    !Number.isFinite(
      water
    ) ||
    water < 0 ||
    water > 20
  ) {
    return "Water-level minimum must remain between 0cm and 20cm for the current prototype setting.";
  }

  if (
    !Number.isFinite(
      ammonia
    ) ||
    ammonia < 0 ||
    ammonia > 5
  ) {
    return "Ammonia threshold must remain between 0mg/L and 5mg/L.";
  }

  return "";
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
    console.log(
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
| LOAD THRESHOLDS
|--------------------------------------------------------------------------
*/

async function loadThresholdsFromSupabase(
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
    console.log(
      "LOAD THRESHOLDS ERROR:",
      error
    );

    return {
      thresholds:
        getLocalThresholds(),

      source:
        "localStorage",
    };
  }

  if (!data) {
    return {
      thresholds:
        getLocalThresholds(),

      source:
        "localStorage",
    };
  }

  return {
    thresholds:
      normalizeThresholds(
        data
      ),

    source:
      TABLE_NAME,
  };
}

/*
|--------------------------------------------------------------------------
| SAVE THRESHOLDS
|--------------------------------------------------------------------------
|
| Existing table only:
|
| public.threshold_settings
|
| No new threshold table is created.
|
*/

async function saveThresholdsToSupabase(
  userId,
  thresholds
) {
  const cleanThresholds =
    normalizeThresholds(
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
| EDITABLE CONTROL
|--------------------------------------------------------------------------
*/

function ThresholdControl({
  item,
  value,
  onChange,
}) {
  const Icon =
    item.icon;

  return (
    <article className="modern-setting-threshold-card">
      <div className="modern-setting-threshold-top">
        <span>
          <Icon
            size={
              20
            }
          />
        </span>

        <div>
          <strong>
            {
              item.label
            }
          </strong>

          <small>
            {
              item.helper
            }
          </small>
        </div>
      </div>

      <div className="modern-setting-threshold-control">
        <input
          type="range"
          min={
            item.min
          }
          max={
            item.max
          }
          step={
            item.step
          }
          value={
            value
          }
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
            min={
              item.min
            }
            max={
              item.max
            }
            step={
              item.step
            }
            value={
              value
            }
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
            {
              item.unit
            }
          </span>
        </label>
      </div>
    </article>
  );
}

/*
|--------------------------------------------------------------------------
| RESEARCH / CALIBRATION CARD
|--------------------------------------------------------------------------
*/

function ThresholdReferenceCard({
  item,
  thresholds,
}) {
  const Icon =
    item.icon;

  const reference =
    getThresholdReference(
      item.key
    );

  if (!reference) {
    return null;
  }

  const activeValue =
    getActiveThresholdDisplay(
      item.key,
      thresholds
    );

  const mainReference =
    formatResearchReference(
      item.key
    );

  const supporting =
    formatSupportingReference(
      reference
    );

  const isResearch =
    reference
      .referenceType ===
      "research" ||
    reference
      .referenceType ===
      "research-with-measurement-caveat";

  return (
    <article
      className="modern-setting-threshold-card"
      style={
        referenceCardStyle
      }
    >
      <div className="modern-setting-threshold-top">
        <span>
          <Icon
            size={
              20
            }
          />
        </span>

        <div>
          <strong>
            {
              reference.title
            }
          </strong>

          <small>
            {isResearch
              ? "Published reference compared with your active CrayThrive setting."
              : "Operational value depends on the CrayThrive prototype calibration."}
          </small>
        </div>
      </div>

      <div
        style={
          referenceSectionStyle
        }
      >
        <ReferenceLabel
          icon={
            ShieldCheck
          }
          title="Current Active Setting"
          value={
            activeValue
          }
          tone="active"
        />

        <ReferenceLabel
          icon={
            BookOpen
          }
          title={
            reference
              .referenceLabel
          }
          value={
            mainReference
          }
          tone={
            isResearch
              ? "research"
              : "calibration"
          }
        />
      </div>

      {reference.primary ? (
        <div
          style={
            sourceBoxStyle
          }
        >
          <strong
            style={
              sourceTitleStyle
            }
          >
            {
              reference
                .primary
                .label
            }
          </strong>

          <span
            style={
              sourceTextStyle
            }
          >
            Source:{" "}
            {
              reference
                .primary
                .source
            }
          </span>

          <span
            style={
              sourceMetaStyle
            }
          >
            {
              reference
                .primary
                .sourceType
            }
          </span>
        </div>
      ) : null}

      {supporting ? (
        <div
          style={
            supportingBoxStyle
          }
        >
          <span
            style={
              referenceMiniLabelStyle
            }
          >
            Supporting published reference
          </span>

          <strong
            style={
              supportingValueStyle
            }
          >
            {
              supporting
            }
          </strong>

          {reference
            .supporting
            ?.source ? (
            <span
              style={
                sourceTextStyle
              }
            >
              {
                reference
                  .supporting
                  .source
              }
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        style={
          explanationStyle
        }
      >
        <Info
          size={
            16
          }
          style={{
            flexShrink:
              0,
          }}
        />

        <p
          style={
            explanationTextStyle
          }
        >
          {
            reference
              .explanation
          }
        </p>
      </div>

      {reference
        .calibrationNote ? (
        <div
          style={
            calibrationStyle
          }
        >
          <strong>
            Prototype note:
          </strong>{" "}
          {
            reference
              .calibrationNote
          }
        </div>
      ) : null}

      {reference
        .measurementWarning ? (
        <div
          style={
            warningStyle
          }
        >
          <AlertTriangle
            size={
              15
            }
            style={{
              flexShrink:
                0,
            }}
          />

          <span>
            {
              reference
                .measurementWarning
            }
          </span>
        </div>
      ) : null}

      <div
        style={
          surveyStyle
        }
      >
        <span
          style={
            referenceMiniLabelStyle
          }
        >
          Expert / Validation Recommendation
        </span>

        {reference
          .surveyRecommendation ? (
          <strong>
            {
              reference
                .surveyRecommendation
            }
          </strong>
        ) : (
          <>
            <strong>
              Pending
            </strong>

            <small
              style={
                surveyNoteStyle
              }
            >
              Actual expert or survey results will be shown here after the validation activity. No expert value is fabricated beforehand.
            </small>
          </>
        )}
      </div>
    </article>
  );
}

/*
|--------------------------------------------------------------------------
| SMALL REFERENCE LABEL
|--------------------------------------------------------------------------
*/

function ReferenceLabel({
  icon: Icon,
  title,
  value,
  tone,
}) {
  return (
    <div
      style={{
        ...referenceValueBoxStyle,

        ...(tone ===
        "research"
          ? researchToneStyle
          : tone ===
            "calibration"
          ? calibrationToneStyle
          : activeToneStyle),
      }}
    >
      <div
        style={
          referenceValueHeaderStyle
        }
      >
        <Icon
          size={
            14
          }
        />

        <span>
          {
            title
          }
        </span>
      </div>

      <strong
        style={
          referenceValueStyle
        }
      >
        {
          value
        }
      </strong>
    </div>
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
    useState(
      getLocalThresholds
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

  const validThresholds =
    useMemo(
      () =>
        isRangeValid(
          thresholds
        ),
      [
        thresholds,
      ]
    );

  /*
  |--------------------------------------------------------------------------
  | LOAD
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
        getLocalThresholds()
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
          getLocalThresholds()
        );

        return;
      }

      const loaded =
        await loadThresholdsFromSupabase(
          currentUser.id
        );

      setThresholds(
        loaded.thresholds
      );

      setDataSource(
        loaded.source
      );

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          loaded.thresholds
        )
      );
    } catch (
      error
    ) {
      console.log(
        "THRESHOLD SETTINGS LOAD ERROR:",
        error
      );

      setDataSource(
        "localStorage"
      );

      setThresholds(
        getLocalThresholds()
      );

      setMessageType(
        "warning"
      );

      setMessage(
        "Loaded local thresholds because Supabase was not available."
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
  | EDIT
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
  | SAVE
  |--------------------------------------------------------------------------
  */

  async function handleSave() {
    setMessage("");

    const validationMessage =
      getValidationMessage(
        thresholds
      );

    if (
      validationMessage
    ) {
      setMessageType(
        "warning"
      );

      setMessage(
        validationMessage
      );

      return;
    }

    try {
      setIsSaving(
        true
      );

      const cleanThresholds =
        normalizeThresholds(
          thresholds
        );

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          cleanThresholds
        )
      );

      if (
        !isSupabaseConfigured ||
        !supabase ||
        !user?.id
      ) {
        setThresholds(
          cleanThresholds
        );

        setDataSource(
          "localStorage"
        );

        setMessageType(
          "warning"
        );

        setMessage(
          "Saved locally only. Sign in and connect Supabase to synchronize these thresholds with the mobile app."
        );

        return;
      }

      const saved =
        await saveThresholdsToSupabase(
          user.id,
          cleanThresholds
        );

      const savedThresholds =
        normalizeThresholds(
          saved ||
            cleanThresholds
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
        "Threshold settings saved to Supabase. The web dashboard and mobile app can now use the same active values."
      );
    } catch (
      error
    ) {
      console.log(
        "THRESHOLD SETTINGS SAVE ERROR:",
        error
      );

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          thresholds
        )
      );

      setDataSource(
        "localStorage"
      );

      setMessageType(
        "warning"
      );

      setMessage(
        error?.message ||
          "Saved locally because the Supabase threshold save failed."
      );
    } finally {
      setIsSaving(
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
          size={
            34
          }
        />

        <h3>
          Loading threshold settings...
        </h3>

        <p>
          CrayThrive is preparing your active water-condition thresholds and reference information.
        </p>
      </section>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | UI
  |--------------------------------------------------------------------------
  */

  return (
    <div className="modern-settings-page">
      {/*
      ------------------------------------------------------------------------
      HERO
      ------------------------------------------------------------------------
      */}

      <section className="modern-settings-hero">
        <div>
          <p className="dashboard-eyebrow">
            Threshold Settings
          </p>

          <h2>
            Configure CrayThrive water-condition thresholds.
          </h2>

          <p>
            These active values are used by CrayThrive to classify readings and support alerts, tank checks, AI recommendations, and automation rules. Research references are shown separately so published guidance is not confused with your actual saved settings.
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
                !validThresholds
              }
            >
              {isSaving ? (
                <>
                  Saving...
                  <Loader2
                    className="spin-icon"
                    size={
                      18
                    }
                  />
                </>
              ) : (
                <>
                  Save Settings
                  <Save
                    size={
                      18
                    }
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
                size={
                  18
                }
              />

              Restore Defaults
            </button>

            <span>
              Source:{" "}
              {formatDataSource(
                dataSource
              )}
            </span>
          </div>
        </div>

        <div className="modern-settings-hero-card">
          <Settings
            size={
              38
            }
          />

          <strong>
            {validThresholds
              ? "Ready"
              : "Check"}
          </strong>

          <span>
            {validThresholds
              ? "Active values are valid"
              : "Some values need review"}
          </span>
        </div>
      </section>

      {/*
      ------------------------------------------------------------------------
      MESSAGE
      ------------------------------------------------------------------------
      */}

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
              size={
                20
              }
            />
          ) : (
            <CheckCircle2
              size={
                20
              }
            />
          )}

          <span>
            {
              message
            }
          </span>
        </section>
      )}

      {/*
      ------------------------------------------------------------------------
      IMPORTANT EXPLANATION
      ------------------------------------------------------------------------
      */}

      <section
        className="modern-settings-panel modern-settings-wide"
        style={
          infoPanelStyle
        }
      >
        <div
          style={
            infoPanelIconStyle
          }
        >
          <Info
            size={
              22
            }
          />
        </div>

        <div>
          <strong>
            Research reference and active threshold are different.
          </strong>

          <p
            style={
              infoPanelTextStyle
            }
          >
            Published values below are supporting guidance for redclaw crayfish care. They do not automatically change CrayThrive. Only the values you save under Active Thresholds are written to Supabase and used by the web dashboard, mobile app, and connected rule logic.
          </p>
        </div>
      </section>

      {/*
      ------------------------------------------------------------------------
      ACTIVE THRESHOLDS
      ------------------------------------------------------------------------
      */}

      <section className="modern-settings-panel modern-settings-wide">
        <div className="modern-panel-heading">
          <div>
            <p className="dashboard-eyebrow">
              Active Thresholds
            </p>

            <h3>
              CrayThrive operational settings
            </h3>

            <p
              style={
                sectionDescriptionStyle
              }
            >
              These are the actual values currently used after you save them.
            </p>
          </div>

          <Database
            size={
              22
            }
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

      {/*
      ------------------------------------------------------------------------
      RESEARCH / CALIBRATION BASIS
      ------------------------------------------------------------------------
      */}

      <section className="modern-settings-panel modern-settings-wide">
        <div className="modern-panel-heading">
          <div>
            <p className="dashboard-eyebrow">
              Reference Basis
            </p>

            <h3>
              Research and prototype guidance
            </h3>

            <p
              style={
                sectionDescriptionStyle
              }
            >
              Compare the active CrayThrive settings with published redclaw guidance and parameters that require prototype-specific calibration.
            </p>
          </div>

          <BookOpen
            size={
              22
            }
          />
        </div>

        <div
          style={
            referenceGridStyle
          }
        >
          {referenceRows.map(
            (
              item
            ) => (
              <ThresholdReferenceCard
                key={
                  item.key
                }
                item={
                  item
                }
                thresholds={
                  thresholds
                }
              />
            )
          )}
        </div>
      </section>

      {/*
      ------------------------------------------------------------------------
      SURVEY / VALIDATION
      ------------------------------------------------------------------------
      */}

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
            size={
              22
            }
          />
        </div>

        <div
          style={
            validationNoticeStyle
          }
        >
          <AlertTriangle
            size={
              21
            }
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
              CrayThrive will display expert or aquaculture validation recommendations here only after the researchers have collected and analyzed the actual evaluation results. No survey threshold recommendation is being assumed or fabricated in advance.
            </p>
          </div>
        </div>
      </section>

      {/*
      ------------------------------------------------------------------------
      FINAL NOTE
      ------------------------------------------------------------------------
      */}

      <section
        className="modern-settings-panel modern-settings-wide"
        style={
          finalNoteStyle
        }
      >
        <div
          style={
            finalNoteIconStyle
          }
        >
          <CheckCircle2
            size={
              20
            }
          />
        </div>

        <div>
          <strong>
            Shared configuration
          </strong>

          <p
            style={
              finalNoteTextStyle
            }
          >
            Saving here updates the existing Supabase threshold_settings record for your account. The mobile application can fetch the same active values, including threshold changes accepted from the AI Guide.
          </p>
        </div>
      </section>
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| DISPLAY HELPERS
|--------------------------------------------------------------------------
*/

function getActiveThresholdDisplay(
  key,
  thresholds
) {
  switch (
    key
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

    case "waterLevel":
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
      return "—";
  }
}

function formatSupportingReference(
  reference
) {
  const value =
    reference
      ?.supporting;

  if (!value) {
    return "";
  }

  const unit =
    value.unit ||
    reference.unit ||
    "";

  const min =
    Number(
      value.min
    );

  const max =
    Number(
      value.max
    );

  if (
    Number.isFinite(
      min
    ) &&
    Number.isFinite(
      max
    )
  ) {
    return `${formatNumber(
      min
    )}–${formatNumber(
      max
    )}${
      unit
        ? ` ${unit}`
        : ""
    }`;
  }

  if (
    Number.isFinite(
      max
    )
  ) {
    return `${value.comparison || "≤"} ${formatNumber(
      max
    )}${
      unit
        ? ` ${unit}`
        : ""
    }`;
  }

  return "";
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

function formatDataSource(
  source
) {
  if (
    source ===
    TABLE_NAME
  ) {
    return "Supabase";
  }

  if (
    source ===
    "localStorage"
  ) {
    return "Browser cache";
  }

  return (
    source ||
    "Unknown"
  );
}

/*
|--------------------------------------------------------------------------
| LIGHTWEIGHT INLINE STYLES
|--------------------------------------------------------------------------
|
| These are only for the NEW information sections.
| Existing CrayThrive CSS still controls the main page/cards/buttons.
|
*/

const referenceGridStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "repeat(auto-fit, minmax(280px, 1fr))",

  gap:
    "16px",
};

const referenceCardStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "12px",
};

const referenceSectionStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "repeat(2, minmax(0, 1fr))",

  gap:
    "8px",
};

const referenceValueBoxStyle = {
  padding:
    "10px",

  borderRadius:
    "12px",

  border:
    "1px solid rgba(148, 163, 184, 0.18)",
};

const activeToneStyle = {
  background:
    "rgba(59, 130, 246, 0.08)",
};

const researchToneStyle = {
  background:
    "rgba(34, 197, 94, 0.08)",
};

const calibrationToneStyle = {
  background:
    "rgba(245, 158, 11, 0.08)",
};

const referenceValueHeaderStyle = {
  display:
    "flex",

  alignItems:
    "center",

  gap:
    "5px",

  marginBottom:
    "4px",

  fontSize:
    "0.74rem",

  opacity:
    0.72,
};

const referenceValueStyle = {
  fontSize:
    "0.98rem",

  lineHeight:
    1.25,
};

const sourceBoxStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "3px",

  padding:
    "10px",

  borderRadius:
    "12px",

  background:
    "rgba(34, 197, 94, 0.06)",

  border:
    "1px solid rgba(34, 197, 94, 0.14)",
};

const sourceTitleStyle = {
  fontSize:
    "0.86rem",
};

const sourceTextStyle = {
  fontSize:
    "0.78rem",

  lineHeight:
    1.4,

  opacity:
    0.78,
};

const sourceMetaStyle = {
  fontSize:
    "0.71rem",

  opacity:
    0.55,
};

const supportingBoxStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "3px",

  padding:
    "10px",

  borderRadius:
    "12px",

  background:
    "rgba(59, 130, 246, 0.05)",

  border:
    "1px solid rgba(59, 130, 246, 0.12)",
};

const referenceMiniLabelStyle = {
  fontSize:
    "0.7rem",

  textTransform:
    "uppercase",

  letterSpacing:
    "0.04em",

  opacity:
    0.58,
};

const supportingValueStyle = {
  fontSize:
    "0.94rem",
};

const explanationStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "7px",

  paddingTop:
    "2px",

  opacity:
    0.86,
};

const explanationTextStyle = {
  margin:
    0,

  fontSize:
    "0.79rem",

  lineHeight:
    1.5,
};

const calibrationStyle = {
  padding:
    "9px 10px",

  borderRadius:
    "10px",

  background:
    "rgba(245, 158, 11, 0.07)",

  fontSize:
    "0.76rem",

  lineHeight:
    1.45,
};

const warningStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "6px",

  padding:
    "9px 10px",

  borderRadius:
    "10px",

  background:
    "rgba(245, 158, 11, 0.08)",

  fontSize:
    "0.75rem",

  lineHeight:
    1.45,
};

const surveyStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "3px",

  padding:
    "10px",

  borderRadius:
    "11px",

  border:
    "1px dashed rgba(148, 163, 184, 0.28)",

  background:
    "rgba(148, 163, 184, 0.04)",
};

const surveyNoteStyle = {
  opacity:
    0.63,

  lineHeight:
    1.4,
};

const infoPanelStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "12px",
};

const infoPanelIconStyle = {
  width:
    "40px",

  height:
    "40px",

  flexShrink:
    0,

  display:
    "grid",

  placeItems:
    "center",

  borderRadius:
    "12px",

  background:
    "rgba(59, 130, 246, 0.10)",
};

const infoPanelTextStyle = {
  margin:
    "5px 0 0",

  lineHeight:
    1.55,

  opacity:
    0.75,
};

const sectionDescriptionStyle = {
  margin:
    "5px 0 0",

  fontSize:
    "0.84rem",

  lineHeight:
    1.5,

  opacity:
    0.68,
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
    "1px solid rgba(245, 158, 11, 0.15)",
};

const validationNoticeTextStyle = {
  margin:
    "4px 0 0",

  fontSize:
    "0.82rem",

  lineHeight:
    1.5,

  opacity:
    0.75,
};

const finalNoteStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "10px",
};

const finalNoteIconStyle = {
  width:
    "38px",

  height:
    "38px",

  flexShrink:
    0,

  display:
    "grid",

  placeItems:
    "center",

  borderRadius:
    "12px",

  background:
    "rgba(34, 197, 94, 0.09)",
};

const finalNoteTextStyle = {
  margin:
    "4px 0 0",

  lineHeight:
    1.5,

  opacity:
    0.72,
};
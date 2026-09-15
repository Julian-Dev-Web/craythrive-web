import { useEffect, useMemo, useState } from "react";

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  Droplets,
  Gauge,
  Loader2,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Thermometer,
  UserRound,
  Waves,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

/* =========================================================
   STORAGE / DATABASE
========================================================= */

const STORAGE_KEY =
  "craythrive_threshold_settings";

const THRESHOLD_TABLE =
  "threshold_settings";

/* =========================================================
   DEFAULT VALUES
========================================================= */

const DEFAULT_THRESHOLDS = {
  temperatureMin: 20,
  temperatureMax: 30,

  phMin: 6.5,
  phMax: 8.5,

  /*
   * Keep the existing database key for compatibility.
   * User-facing wording is "Water Clarity Minimum".
   *
   * Higher turbidity sensor voltage = clearer water.
   */
  turbidityMax: 2.5,

  /*
   * Minimum acceptable water level/depth
   * currently used by the system.
   */
  waterLevelMin: 4.5,

  ammoniaMax: 0.25,
};

/* =========================================================
   THRESHOLD CONFIG
========================================================= */

const thresholdSections = [
  {
    id: "temperature",
    title: "Temperature",
    description:
      "Set the safe water temperature range for your crayfish tank.",
    icon: Thermometer,

    items: [
      {
        key: "temperatureMin",
        label: "Minimum Temperature",
        helper:
          "Readings below this value may need checking.",
        unit: "°C",
        icon: Thermometer,
        min: 10,
        max: 40,
        step: 0.1,
      },

      {
        key: "temperatureMax",
        label: "Maximum Temperature",
        helper:
          "Readings above this value may need checking.",
        unit: "°C",
        icon: Thermometer,
        min: 10,
        max: 40,
        step: 0.1,
      },
    ],
  },

  {
    id: "ph",
    title: "pH Level",
    description:
      "Set the acceptable pH range used when checking water condition.",
    icon: Droplets,

    items: [
      {
        key: "phMin",
        label: "Minimum pH",
        helper:
          "The lowest pH value considered acceptable.",
        unit: "pH",
        icon: Droplets,
        min: 0,
        max: 14,
        step: 0.1,
      },

      {
        key: "phMax",
        label: "Maximum pH",
        helper:
          "The highest pH value considered acceptable.",
        unit: "pH",
        icon: Droplets,
        min: 0,
        max: 14,
        step: 0.1,
      },
    ],
  },

  {
    id: "water",
    title: "Water Condition",
    description:
      "Set the minimum water clarity and water level used by CrayThrive.",
    icon: Waves,

    items: [
      {
        key: "turbidityMax",
        label: "Water Clarity Minimum",
        helper:
          "Minimum sensor voltage considered clear. Higher voltage means clearer water.",
        unit: "V",
        icon: Waves,
        min: 0,
        max: 5,
        step: 0.01,
      },

      {
        key: "waterLevelMin",
        label: "Minimum Water Level",
        helper:
          "The lowest acceptable water level before the tank may need refilling.",
        unit: "cm",
        icon: Gauge,
        min: 0,
        max: 20,
        step: 0.1,
      },
    ],
  },

  {
    id: "ammonia",
    title: "Ammonia",
    description:
      "Set the highest ammonia reading that should still be considered acceptable.",
    icon: AlertTriangle,

    items: [
      {
        key: "ammoniaMax",
        label: "Maximum Ammonia",
        helper:
          "Readings above this value may require attention.",
        unit: "ppm",
        icon: AlertTriangle,
        min: 0,
        max: 5,
        step: 0.01,
      },
    ],
  },
];

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value || "").trim();
}

function formatFriendlyText(value) {
  const text = clean(value);

  if (!text) {
    return "User";
  }

  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function toNumber(
  value,
  fallback
) {
  const numberValue =
    Number(value);

  return Number.isFinite(
    numberValue
  )
    ? numberValue
    : fallback;
}

/* =========================================================
   NORMALIZE VALUES
========================================================= */

function normalizeThresholds(data) {
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
      toNumber(
        source.temperatureMin ??
          source.temperature_min,

        DEFAULT_THRESHOLDS.temperatureMin
      ),

    temperatureMax:
      toNumber(
        source.temperatureMax ??
          source.temperature_max,

        DEFAULT_THRESHOLDS.temperatureMax
      ),

    phMin:
      toNumber(
        source.phMin ??
          source.ph_min,

        DEFAULT_THRESHOLDS.phMin
      ),

    phMax:
      toNumber(
        source.phMax ??
          source.ph_max,

        DEFAULT_THRESHOLDS.phMax
      ),

    turbidityMax:
      toNumber(
        source.turbidityMax ??
          source.turbidity_max,

        DEFAULT_THRESHOLDS.turbidityMax
      ),

    waterLevelMin:
      toNumber(
        source.waterLevelMin ??
          source.water_level_min,

        DEFAULT_THRESHOLDS.waterLevelMin
      ),

    ammoniaMax:
      toNumber(
        source.ammoniaMax ??
          source.ammonia_max,

        DEFAULT_THRESHOLDS.ammoniaMax
      ),
  };
}

/* =========================================================
   LOCAL STORAGE
========================================================= */

function getLocalThresholds() {
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

    return normalizeThresholds(
      JSON.parse(saved)
    );
  } catch {
    return {
      ...DEFAULT_THRESHOLDS,
    };
  }
}

/* =========================================================
   PROFILE
========================================================= */

function getProfileName(
  profile,
  user
) {
  return (
    profile?.username ||
    profile?.full_name ||
    [
      profile?.first_name,
      profile?.last_name,
    ]
      .filter(Boolean)
      .join(" ") ||
    user?.email?.split("@")?.[0] ||
    "CrayThrive User"
  );
}

function getProfileRole(profile) {
  return formatFriendlyText(
    profile?.role ||
      "user"
  );
}

/* =========================================================
   VALIDATION
========================================================= */

function validateThresholds(
  thresholds
) {
  if (
    Number(
      thresholds.temperatureMin
    ) >=
    Number(
      thresholds.temperatureMax
    )
  ) {
    return {
      valid: false,
      message:
        "Minimum temperature must be lower than maximum temperature.",
    };
  }

  if (
    Number(
      thresholds.phMin
    ) >=
    Number(
      thresholds.phMax
    )
  ) {
    return {
      valid: false,
      message:
        "Minimum pH must be lower than maximum pH.",
    };
  }

  for (
    const section
    of thresholdSections
  ) {
    for (
      const item
      of section.items
    ) {
      const value =
        Number(
          thresholds[item.key]
        );

      if (
        !Number.isFinite(value)
      ) {
        return {
          valid: false,
          message: `${item.label} must contain a valid number.`,
        };
      }

      if (
        value < item.min ||
        value > item.max
      ) {
        return {
          valid: false,
          message: `${item.label} must be between ${item.min} and ${item.max} ${item.unit}.`,
        };
      }
    }
  }

  return {
    valid: true,
    message: "",
  };
}

/* =========================================================
   AUTH / PROFILE
========================================================= */

async function getCurrentUserAndProfile() {
  const { data } =
    await supabase.auth.getSession();

  const user =
    data?.session?.user;

  if (!user) {
    return {
      user: null,
      profile: null,
    };
  }

  const byId =
    await supabase
      .from("profiles")
      .select("*")
      .eq(
        "id",
        user.id
      )
      .maybeSingle();

  if (
    !byId.error &&
    byId.data
  ) {
    return {
      user,
      profile:
        byId.data,
    };
  }

  if (!user.email) {
    return {
      user,
      profile: null,
    };
  }

  const byEmail =
    await supabase
      .from("profiles")
      .select("*")
      .ilike(
        "email",
        user.email
      )
      .maybeSingle();

  return {
    user,

    profile:
      byEmail.error
        ? null
        : byEmail.data,
  };
}

/* =========================================================
   LOAD THRESHOLDS
========================================================= */

async function loadThresholdsFromSupabase(
  userId
) {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        THRESHOLD_TABLE
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

      syncMode:
        "local",
    };
  }

  if (!data) {
    return {
      thresholds:
        getLocalThresholds(),

      syncMode:
        "local",
    };
  }

  return {
    thresholds:
      normalizeThresholds(
        data
      ),

    syncMode:
      "online",
  };
}

/* =========================================================
   SAVE THRESHOLDS
========================================================= */

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
        cleanThresholds.temperatureMin
      ),

    temperature_max:
      Number(
        cleanThresholds.temperatureMax
      ),

    ph_min:
      Number(
        cleanThresholds.phMin
      ),

    ph_max:
      Number(
        cleanThresholds.phMax
      ),

    /*
     * Existing column kept for database
     * compatibility.
     */
    turbidity_max:
      Number(
        cleanThresholds.turbidityMax
      ),

    water_level_min:
      Number(
        cleanThresholds.waterLevelMin
      ),

    ammonia_max:
      Number(
        cleanThresholds.ammoniaMax
      ),

    updated_at:
      new Date().toISOString(),
  };

  const {
    data,
    error,
  } =
    await supabase
      .from(
        THRESHOLD_TABLE
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

/* =========================================================
   THRESHOLD CONTROL
========================================================= */

function ThresholdControl({
  item,
  value,
  onChange,
}) {
  const Icon =
    item.icon;

  return (
    <article className="cray-settings-threshold-card">

      <div className="cray-settings-threshold-top">

        <span>
          <Icon
            size={19}
          />
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

      <div className="cray-settings-threshold-control">

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
              event.target.value
            )
          }
          aria-label={
            item.label
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
                event.target.value
              )
            }
            aria-label={`${item.label} value`}
          />

          <span>
            {item.unit}
          </span>
        </label>
      </div>
    </article>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function SettingsPage() {
  const [
    thresholds,
    setThresholds,
  ] = useState(
    getLocalThresholds
  );

  const [
    profile,
    setProfile,
  ] = useState(null);

  const [
    user,
    setUser,
  ] = useState(null);

  const [
    syncMode,
    setSyncMode,
  ] = useState("local");

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    isSaving,
    setIsSaving,
  ] = useState(false);

  const [
    isDirty,
    setIsDirty,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState(null);

  /* =======================================================
     DERIVED DATA
  ======================================================= */

  const displayName =
    getProfileName(
      profile,
      user
    );

  const email =
    profile?.email ||
    user?.email ||
    "No email available";

  const role =
    getProfileRole(
      profile
    );

  const validation =
    useMemo(
      () =>
        validateThresholds(
          thresholds
        ),
      [thresholds]
    );

  /* =======================================================
     LOAD
  ======================================================= */

  const loadSettings =
    async () => {
      setMessage(null);

      if (
        !isSupabaseConfigured ||
        !supabase
      ) {
        const local =
          getLocalThresholds();

        setThresholds(
          local
        );

        setSyncMode(
          "local"
        );

        setIsDirty(
          false
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

        const result =
          await getCurrentUserAndProfile();

        setUser(
          result.user
        );

        setProfile(
          result.profile
        );

        if (
          !result.user?.id
        ) {
          const local =
            getLocalThresholds();

          setThresholds(
            local
          );

          setSyncMode(
            "local"
          );

          setIsDirty(
            false
          );

          return;
        }

        const loaded =
          await loadThresholdsFromSupabase(
            result.user.id
          );

        setThresholds(
          loaded.thresholds
        );

        setSyncMode(
          loaded.syncMode
        );

        setIsDirty(
          false
        );

        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(
            loaded.thresholds
          )
        );
      } catch (error) {
        console.error(
          "Settings loading error:",
          error
        );

        const local =
          getLocalThresholds();

        setThresholds(
          local
        );

        setSyncMode(
          "local"
        );

        setIsDirty(
          false
        );

        setMessage({
          tone:
            "warning",

          text:
            "Online settings could not be loaded. Your saved settings on this device are being used instead.",
        });
      } finally {
        setIsLoading(
          false
        );
      }
    };

  useEffect(() => {
    loadSettings();
  }, []);

  /* =======================================================
     CHANGE
  ======================================================= */

  const handleThresholdChange =
    (
      key,
      value
    ) => {
      setMessage(null);

      setThresholds(
        (current) => ({
          ...current,

          [key]:
            Number(value),
        })
      );

      setIsDirty(true);
    };

  /* =======================================================
     RESET
  ======================================================= */

  const handleResetDefaults =
    () => {
      setThresholds({
        ...DEFAULT_THRESHOLDS,
      });

      setIsDirty(true);

      setMessage({
        tone:
          "info",

        text:
          "Default values restored. Press Save Changes to apply them.",
      });
    };

  /* =======================================================
     SAVE
  ======================================================= */

  const handleSave =
    async () => {
      setMessage(null);

      if (
        !validation.valid
      ) {
        setMessage({
          tone:
            "warning",

          text:
            validation.message,
        });

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

        /*
         * Always save a local copy
         * as fallback.
         */
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

          setSyncMode(
            "local"
          );

          setIsDirty(
            false
          );

          setMessage({
            tone:
              "info",

            text:
              "Changes were saved on this device. Sign in with an online connection to sync them with your account.",
          });

          return;
        }

        await saveThresholdsToSupabase(
          user.id,
          cleanThresholds
        );

        setThresholds(
          cleanThresholds
        );

        setSyncMode(
          "online"
        );

        setIsDirty(
          false
        );

        setMessage({
          tone:
            "success",

          text:
            "Water safety settings were saved successfully.",
        });
      } catch (error) {
        console.error(
          "Settings saving error:",
          error
        );

        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(
            thresholds
          )
        );

        setSyncMode(
          "local"
        );

        setIsDirty(
          false
        );

        setMessage({
          tone:
            "warning",

          text:
            "Online sync was unavailable, so your changes were saved on this device instead.",
        });
      } finally {
        setIsSaving(
          false
        );
      }
    };

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="cray-settings-loading">

        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading settings...
        </h3>

        <p>
          Getting your account and
          water safety settings.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="cray-settings-page">

      {/* ===============================================
          HERO
      ================================================ */}

      <section className="cray-settings-hero">

        <div>

          <p className="dashboard-eyebrow">
            Settings
          </p>

          <h2>
            Set the safe conditions
            for your tanks.
          </h2>

          <p>
            Adjust the limits CrayThrive
            uses when checking temperature,
            pH, water clarity, water level,
            and ammonia.
          </p>

          <div className="cray-settings-actions">

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
                  <Loader2
                    className="spin-icon"
                    size={18}
                  />

                  Saving...
                </>
              ) : (
                <>
                  <Save
                    size={18}
                  />

                  Save Changes
                </>
              )}
            </button>

            <button
              type="button"
              className="cray-settings-secondary-button"
              onClick={
                handleResetDefaults
              }
              disabled={
                isSaving
              }
            >
              <RefreshCw
                size={18}
              />

              Restore Defaults
            </button>

            {isDirty && (
              <span className="cray-settings-unsaved">
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        <div
          className={`cray-settings-hero-card ${
            validation.valid
              ? "ready"
              : "warning"
          }`}
        >
          {validation.valid ? (
            <ShieldCheck
              size={36}
            />
          ) : (
            <AlertTriangle
              size={36}
            />
          )}

          <strong>
            {validation.valid
              ? "Ready"
              : "Check Values"}
          </strong>

          <span>
            {validation.valid
              ? "Safety ranges are valid"
              : "Some values need review"}
          </span>
        </div>
      </section>

      {/* ===============================================
          MESSAGE
      ================================================ */}

      {message && (
        <section
          className={`cray-settings-message ${message.tone}`}
        >
          {message.tone ===
          "success" ? (
            <CheckCircle2
              size={19}
            />
          ) : message.tone ===
            "warning" ? (
            <AlertTriangle
              size={19}
            />
          ) : (
            <Bell
              size={19}
            />
          )}

          <span>
            {message.text}
          </span>
        </section>
      )}

      {/* ===============================================
          INVALID RANGE
      ================================================ */}

      {!validation.valid &&
        !message && (
          <section className="cray-settings-message warning">

            <AlertTriangle
              size={19}
            />

            <span>
              {
                validation.message
              }
            </span>
          </section>
        )}

      {/* ===============================================
          ACCOUNT + SYNC
      ================================================ */}

      <section className="cray-settings-overview-grid">

        {/* ACCOUNT */}

        <article className="cray-settings-panel">

          <div className="cray-settings-panel-heading">

            <div>
              <p className="dashboard-eyebrow">
                Account
              </p>

              <h3>
                Your profile
              </h3>
            </div>

            <UserRound
              size={22}
            />
          </div>

          <div className="cray-settings-profile">

            <div className="cray-settings-avatar">
              <UserRound
                size={27}
              />
            </div>

            <div>
              <strong>
                {displayName}
              </strong>

              <span>
                {email}
              </span>

              <small>
                {role}
              </small>
            </div>
          </div>
        </article>

        {/* SAVING / SYNC */}

        <article className="cray-settings-panel">

          <div className="cray-settings-panel-heading">

            <div>
              <p className="dashboard-eyebrow">
                Saving
              </p>

              <h3>
                Settings status
              </h3>
            </div>

            <Database
              size={22}
            />
          </div>

          <div className="cray-settings-sync-card">

            <span
              className={`cray-settings-sync-icon ${syncMode}`}
            >
              {syncMode ===
              "online" ? (
                <ShieldCheck
                  size={21}
                />
              ) : (
                <Database
                  size={21}
                />
              )}
            </span>

            <div>
              <strong>
                {syncMode ===
                "online"
                  ? "Synced with your account"
                  : "Saved on this device"}
              </strong>

              <p>
                {syncMode ===
                "online"
                  ? "Your saved water safety settings can be reused by connected CrayThrive features."
                  : "These values are available on this device while online sync is unavailable."}
              </p>
            </div>
          </div>
        </article>
      </section>

      {/* ===============================================
          HOW SETTINGS WORK
      ================================================ */}

      <section className="cray-settings-panel">

        <div className="cray-settings-panel-heading">

          <div>
            <p className="dashboard-eyebrow">
              How It Works
            </p>

            <h3>
              What these settings affect
            </h3>
          </div>

          <Bell
            size={22}
          />
        </div>

        <div className="cray-settings-info-grid">

          <div>
            <ShieldCheck
              size={19}
            />

            <span>
              <strong>
                Water checks
              </strong>

              <small>
                Readings are compared with
                your saved safety limits.
              </small>
            </span>
          </div>

          <div>
            <AlertTriangle
              size={19}
            />

            <span>
              <strong>
                Alerts
              </strong>

              <small>
                Values outside your safe
                range may be marked for
                checking or urgent attention.
              </small>
            </span>
          </div>

          <div>
            <Database
              size={19}
            />

            <span>
              <strong>
                Shared settings
              </strong>

              <small>
                Online settings can be reused
                by connected mobile and
                monitoring features.
              </small>
            </span>
          </div>
        </div>
      </section>

      {/* ===============================================
          THRESHOLDS
      ================================================ */}

      <section className="cray-settings-threshold-area">

        <div className="cray-settings-threshold-heading">

          <div>
            <p className="dashboard-eyebrow">
              Tank Safety Rules
            </p>

            <h3>
              Water condition limits
            </h3>

            <span>
              Adjust only the values you need,
              then press Save Changes.
            </span>
          </div>

          <Settings
            size={23}
          />
        </div>

        <div className="cray-settings-threshold-sections">

          {thresholdSections.map(
            (section) => {
              const SectionIcon =
                section.icon;

              return (
                <article
                  className="cray-settings-threshold-section"
                  key={
                    section.id
                  }
                >

                  <div className="cray-settings-threshold-section-heading">

                    <span>
                      <SectionIcon
                        size={21}
                      />
                    </span>

                    <div>
                      <strong>
                        {
                          section.title
                        }
                      </strong>

                      <small>
                        {
                          section.description
                        }
                      </small>
                    </div>
                  </div>

                  <div className="cray-settings-threshold-grid">

                    {section.items.map(
                      (item) => (
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
                </article>
              );
            }
          )}
        </div>
      </section>

      {/* ===============================================
          BOTTOM SAVE
      ================================================ */}

      <section className="cray-settings-save-footer">

        <div>
          <strong>
            {isDirty
              ? "You have changes that are not saved yet."
              : "Your current values are saved."}
          </strong>

          <span>
            Check the values above before
            applying them to your system.
          </span>
        </div>

        <button
          type="button"
          className="dashboard-primary-button"
          onClick={
            handleSave
          }
          disabled={
            isSaving ||
            !validation.valid ||
            !isDirty
          }
        >
          {isSaving ? (
            <>
              <Loader2
                className="spin-icon"
                size={18}
              />

              Saving...
            </>
          ) : (
            <>
              <Save
                size={18}
              />

              Save Changes
            </>
          )}
        </button>
      </section>
    </div>
  );
}
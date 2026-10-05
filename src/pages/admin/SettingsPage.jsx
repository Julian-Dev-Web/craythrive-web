import { DEFAULT_THRESHOLDS, normalizeThresholds } from "../../utils/thresholdEvaluation";
import { logDiagnostic } from "../../utils/securityDiagnostics";
import { useEffect, useMemo, useState } from "react";

import {
  AlertTriangle,
  Bell,
  BookOpen,
  CheckCircle2,
  Database,
  Droplets,
  FlaskConical,
  Gauge,
  Loader2,
  RefreshCw,
  Ruler,
  Save,
  Settings,
  ShieldCheck,
  Thermometer,
  UserRound,
  UsersRound,
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


/* =========================================================
   THRESHOLD BASIS OVERVIEW
========================================================= */

const EVIDENCE_OVERVIEW = [
  {
    title:
      "Literature-based guidance",

    text:
      "Temperature and pH include published redclaw or freshwater aquaculture reference ranges beside the active CrayThrive values.",

    icon:
      BookOpen,
  },

  {
    title:
      "Sensor calibration",

    text:
      "Water clarity uses the turbidity sensor's voltage behavior and CrayThrive prototype calibration. It is not a universal biological crayfish limit.",

    icon:
      FlaskConical,
  },

  {
    title:
      "Tank-specific calibration",

    text:
      "Water level depends on the actual tank depth, sensor mounting, pump intake, and desired operating depth.",

    icon:
      Ruler,
  },

  {
    title:
      "Expert / survey validation",

    text:
      "Pending actual validation results. A threshold should not be labeled survey-approved until real validator findings support it.",

    icon:
      UsersRound,
  },
];

/* =========================================================
   THRESHOLD CONFIG
========================================================= */

const thresholdSections = [
  /* =======================================================
     TEMPERATURE
  ======================================================= */

  {
    id:
      "temperature",

    title:
      "Temperature",

    description:
      "Set the water temperature range used by CrayThrive when checking the tank.",

    icon:
      Thermometer,

    items: [
      {
        key:
          "temperatureMin",

        label:
          "Minimum Temperature",

        helper:
          "Readings below this value may need checking.",

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

        basis: {
          type:
            "Literature reference",

          source:
            "Business Queensland — Redclaw crayfish aquaculture; recent redclaw culture research",

          reference:
            "Published redclaw guidance reports optimal growth around 26–29°C. A recent culture study reports a broader 20–32°C safe range.",

          why:
            "CrayThrive uses 20°C as the lower warning boundary because it matches the lower end of the broader published range.",

          referenceValue:
            "Preferred: 26–29°C • Broader reference: 20–32°C",

          caution:
            "20°C is a lower boundary, not the preferred growth target. For normal operation, water closer to 26–29°C is more consistent with the published optimal-growth guidance.",
        },
      },

      {
        key:
          "temperatureMax",

        label:
          "Maximum Temperature",

        helper:
          "Readings above this value may need checking.",

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

        basis: {
          type:
            "Literature + operational warning point",

          source:
            "Business Queensland — Redclaw crayfish aquaculture; recent redclaw culture research",

          reference:
            "Optimal redclaw growth is reported around 26–29°C. Queensland guidance also reports deaths near hot extremes around 34–35°C.",

          why:
            "CrayThrive uses 30°C as an earlier warning point so a rising temperature can be noticed before it approaches the reported hot extreme.",

          referenceValue:
            "Preferred: 26–29°C • CrayThrive warning ceiling: 30°C",

          caution:
            "The 30°C value is an operational CrayThrive warning point. It is not presented as the exact upper biological limit from one study.",
        },
      },
    ],
  },

  /* =======================================================
     PH
  ======================================================= */

  {
    id:
      "ph",

    title:
      "pH Level",

    description:
      "Set the acceptable pH range used when checking water condition.",

    icon:
      Droplets,

    items: [
      {
        key:
          "phMin",

        label:
          "Minimum pH",

        helper:
          "The lowest pH value considered acceptable by the system.",

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

        basis: {
          type:
            "Literature reference",

          source:
            "Business Queensland — redclaw and freshwater aquaculture guidance",

          reference:
            "Redclaw-specific guidance identifies pH 7.0–8.5 as ideal. Broader freshwater aquaculture guidance uses 6.5–8.5.",

          why:
            "CrayThrive keeps 6.5 as the lower acceptable system boundary to match the broader freshwater range while still showing that 7.0 or higher is the redclaw-specific ideal.",

          referenceValue:
            "Redclaw ideal: 7.0–8.5 • Broader freshwater: 6.5–8.5",

          caution:
            "A reading from 6.5 to below 7.0 may remain inside the current CrayThrive boundary but is below the redclaw-specific ideal range.",
        },
      },

      {
        key:
          "phMax",

        label:
          "Maximum pH",

        helper:
          "The highest pH value considered acceptable by the system.",

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

        basis: {
          type:
            "Literature reference",

          source:
            "Business Queensland — redclaw and freshwater aquaculture guidance",

          reference:
            "The redclaw-specific ideal range and broader freshwater aquaculture guidance both use 8.5 as the upper reference value.",

          why:
            "The default maximum of 8.5 directly matches that published upper reference value.",

          referenceValue:
            "Published upper reference: pH 8.5",

          caution:
            "pH should still be interpreted together with ammonia and the other water-quality readings rather than treated as an isolated condition.",
        },
      },
    ],
  },

  /* =======================================================
     WATER
  ======================================================= */

  {
    id:
      "water",

    title:
      "Water Condition",

    description:
      "Set the minimum water clarity voltage and tank-specific refill level used by CrayThrive.",

    icon:
      Waves,

    items: [
      {
        key:
          "turbidityMax",

        label:
          "Water Clarity Minimum",

        helper:
          "Minimum sensor voltage considered clear. Higher voltage generally means clearer water for this analog sensor.",

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

        basis: {
          type:
            "Sensor calibration — not biological limit",

          source:
            "DFRobot analog turbidity sensor behavior + CrayThrive prototype calibration",

          reference:
            "The sensor manufacturer documents that the analog output decreases as turbidity increases. A pure-water reference can be around 4.1 ± 0.3 V under the manufacturer's documented conditions.",

          why:
            "CrayThrive uses 2.50 V as the project's operational clarity cutoff based on prototype calibration and status mapping.",

          referenceValue:
            "CrayThrive calibration: Clear at or above 2.50 V",

          caution:
            "2.50 V is not a published biological safe threshold for crayfish. Recalibrate when the sensor, power supply, probe installation, or water container changes.",
        },
      },

      {
        key:
          "waterLevelMin",

        label:
          "Minimum Water Level",

        helper:
          "The lowest tank depth before CrayThrive may treat the tank as needing refill.",

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

        basis: {
          type:
            "Tank-specific calibration",

          source:
            "CrayThrive prototype tank and ultrasonic water-level calibration",

          reference:
            "There is no single water depth in centimeters that can be applied to every crayfish tank regardless of tank dimensions, sensor location, and pump configuration.",

          why:
            "The 4.5 cm default is used as the prototype refill trigger. It tells CrayThrive when the current tank setup is getting too low.",

          referenceValue:
            "Current prototype refill trigger: 4.5 cm",

          caution:
            "This is an equipment and tank setting, not a universal biological minimum water depth for crayfish.",
        },
      },
    ],
  },

  /* =======================================================
     AMMONIA
  ======================================================= */

  {
    id:
      "ammonia",

    title:
      "Ammonia",

    description:
      "Set the highest ammonia reading CrayThrive should accept before attention is recommended.",

    icon:
      AlertTriangle,

    items: [
      {
        key:
          "ammoniaMax",

        label:
          "Maximum Ammonia",

        helper:
          "Readings above this value may require attention.",

        unit:
          "ppm",

        icon:
          AlertTriangle,

        min:
          0,

        max:
          5,

        step:
          0.01,

        basis: {
          type:
            "Research reference + prototype threshold",

          source:
            "Recent Cherax quadricarinatus water-quality studies",

          reference:
            "Published redclaw studies report low managed ammonia values, but different studies use different chemical forms. One reports ammonia nitrogen at or below 0.02 mg/L, while another lists NH4+-N below 0.5 mg/L as a safe range.",

          why:
            "The current 0.25 ppm value remains a CrayThrive prototype alert threshold. It should not be described as a direct conversion of those research values until the phone test-strip measurement and ammonia form are confirmed.",

          referenceValue:
            "Research values depend on whether the reading is NH3, NH4+, ammonia-N, or TAN",

          caution:
            "Do not directly compare the 0.25 ppm strip threshold with NH4+-N or ammonia-N limits unless the strip's measurement method and units are confirmed.",
        },
      },
    ],
  },
];

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(
    value || ""
  ).trim();
}

function formatFriendlyText(value) {
  const text =
    clean(value);

  if (!text) {
    return "User";
  }

  return text
    .replaceAll(
      "_",
      " "
    )
    .replaceAll(
      "-",
      " "
    )
    .toLowerCase()
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase()
    );
}


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
    user?.email
      ?.split("@")?.[0] ||
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
      valid:
        false,

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
      valid:
        false,

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
          thresholds[
            item.key
          ]
        );

      if (
        !Number.isFinite(
          value
        )
      ) {
        return {
          valid:
            false,

          message:
            `${item.label} must contain a valid number.`,
        };
      }

      if (
        value <
          item.min ||
        value >
          item.max
      ) {
        return {
          valid:
            false,

          message:
            `${item.label} must be between ${item.min} and ${item.max} ${item.unit}.`,
        };
      }
    }
  }

  return {
    valid:
      true,

    message:
      "",
  };
}

/* =========================================================
   AUTH / PROFILE
========================================================= */

async function getCurrentUserAndProfile() {
  const {
    data,
  } =
    await supabase.auth
      .getSession();

  const user =
    data?.session?.user;

  if (!user) {
    return {
      user:
        null,

      profile:
        null,
    };
  }

  const byId =
    await supabase
      .from(
        "profiles"
      )
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

      profile:
        null,
    };
  }

  const byEmail =
    await supabase
      .from(
        "profiles"
      )
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
    logDiagnostic(
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

    /*
     * Existing column name retained
     * for database compatibility.
     */
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
   RESEARCH / CALIBRATION BASIS CARD
========================================================= */

function ThresholdBasisCard({
  basis,
}) {
  if (!basis) {
    return null;
  }

  return (
    <div
      style={
        basisCardStyle
      }
    >
      <div
        style={
          basisCardTopStyle
        }
      >
        <span
          style={
            basisBadgeStyle
          }
        >
          <BookOpen
            size={14}
          />

          {
            basis.type
          }
        </span>

        <span
          style={
            basisDefaultBadgeStyle
          }
        >
          Why this default?
        </span>
      </div>

      <div
        style={
          basisReferenceValueStyle
        }
      >
        {
          basis.referenceValue
        }
      </div>

      <div
        style={
          basisTextGridStyle
        }
      >
        <div>
          <strong
            style={
              basisLabelStyle
            }
          >
            Reference basis
          </strong>

          <p
            style={
              basisParagraphStyle
            }
          >
            {
              basis.reference
            }
          </p>
        </div>

        <div>
          <strong
            style={
              basisLabelStyle
            }
          >
            Why CrayThrive uses this value
          </strong>

          <p
            style={
              basisParagraphStyle
            }
          >
            {
              basis.why
            }
          </p>
        </div>
      </div>

      <div
        style={
          basisSourceStyle
        }
      >
        <span>
          Source / basis
        </span>

        <strong>
          {
            basis.source
          }
        </strong>
      </div>

      {basis.caution && (
        <div
          style={
            basisCautionStyle
          }
        >
          <AlertTriangle
            size={15}
          />

          <span>
            {
              basis.caution
            }
          </span>
        </div>
      )}

      <div
        style={
          basisValidationStyle
        }
      >
        <UsersRound
          size={15}
        />

        <span>
          <strong>
            Expert / survey validation:
          </strong>{" "}
          Pending actual validation
          results. Do not label this
          threshold as survey-approved
          until actual validator
          findings support it.
        </span>
      </div>
    </div>
  );
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

  const defaultValue =
    DEFAULT_THRESHOLDS[
      item.key
    ];

  const changedFromDefault =
    Number(value) !==
    Number(
      defaultValue
    );

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

      {/* ===============================================
          CURRENT VALUE
      ================================================ */}

      <div
        style={
          activeSettingStyle
        }
      >
        <div>
          <span
            style={
              activeSettingEyebrowStyle
            }
          >
            Current Active Setting
          </span>

          <strong
            style={
              activeSettingValueStyle
            }
          >
            {value}{" "}
            {item.unit}
          </strong>
        </div>

        <span
          style={{
            ...defaultStatusBadgeStyle,

            ...(changedFromDefault
              ? changedDefaultStatusBadgeStyle
              : {}),
          }}
        >
          {changedFromDefault
            ? `Default ${defaultValue} ${item.unit}`
            : "Using Default"}
        </span>
      </div>

      {/* ===============================================
          CONTROL
      ================================================ */}

      <div className="cray-settings-threshold-control">
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
              event
                .target
                .value
            )
          }
          aria-label={
            item.label
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
                event
                  .target
                  .value
              )
            }
            aria-label={`${item.label} value`}
          />

          <span>
            {
              item.unit
            }
          </span>
        </label>
      </div>

      {/* ===============================================
          BASIS
      ================================================ */}

      <ThresholdBasisCard
        basis={
          item.basis
        }
      />
    </article>
  );
}

/* =========================================================
   EVIDENCE OVERVIEW
========================================================= */

function EvidenceOverview() {
  return (
    <section
      className="cray-settings-panel"
      style={
        evidencePanelStyle
      }
    >
      <div className="cray-settings-panel-heading">
        <div>
          <p className="dashboard-eyebrow">
            Threshold Basis
          </p>

          <h3>
            Why these default values are used
          </h3>
        </div>

        <BookOpen
          size={22}
        />
      </div>

      <p
        style={
          evidenceIntroStyle
        }
      >
        The settings below separate
        published water-quality
        guidance from sensor
        calibration and tank-specific
        operating values. This prevents
        every number from being shown
        as if it came from the same
        study.
      </p>

      <div
        style={
          evidenceGridStyle
        }
      >
        {EVIDENCE_OVERVIEW.map(
          (item) => {
            const Icon =
              item.icon;

            return (
              <div
                key={
                  item.title
                }
                style={
                  evidenceItemStyle
                }
              >
                <span
                  style={
                    evidenceIconStyle
                  }
                >
                  <Icon
                    size={18}
                  />
                </span>

                <div>
                  <strong
                    style={
                      evidenceTitleStyle
                    }
                  >
                    {
                      item.title
                    }
                  </strong>

                  <p
                    style={
                      evidenceTextStyle
                    }
                  >
                    {
                      item.text
                    }
                  </p>
                </div>
              </div>
            );
          }
        )}
      </div>

      <div
        style={
          evidenceResearchNoteStyle
        }
      >
        <ShieldCheck
          size={17}
        />

        <span>
          <strong>
            Important:
          </strong>{" "}
          Reference values explain
          where the defaults came from.
          The number currently saved in
          your account is still the
          value CrayThrive actually
          uses for alerts and condition
          checks.
        </span>
      </div>
    </section>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function SettingsPage() {
  const [
    thresholds,
    setThresholds,
  ] =
    useState(
      getLocalThresholds
    );

  const [
    profile,
    setProfile,
  ] =
    useState(null);

  const [
    user,
    setUser,
  ] =
    useState(null);

  const [
    syncMode,
    setSyncMode,
  ] =
    useState(
      "local"
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
    isDirty,
    setIsDirty,
  ] =
    useState(
      false
    );

  const [
    message,
    setMessage,
  ] =
    useState(null);

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

      [
        thresholds,
      ]
    );

  /* =======================================================
     LOAD
  ======================================================= */

  const loadSettings =
    async () => {
      setMessage(
        null
      );

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
        logDiagnostic(
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
      setMessage(
        null
      );

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

      setIsDirty(
        true
      );
    };

  /* =======================================================
     RESET
  ======================================================= */

  const handleResetDefaults =
    () => {
      setThresholds({
        ...DEFAULT_THRESHOLDS,
      });

      setIsDirty(
        true
      );

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
      setMessage(
        null
      );

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
         * Keep a local fallback.
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
        logDiagnostic(
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

  if (
    isLoading
  ) {
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
            uses when checking
            temperature, pH, water
            clarity, water level, and
            ammonia.
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
            {
              message.text
            }
          </span>
        </section>
      )}

      {/* ===============================================
          INVALID
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
                {
                  displayName
                }
              </strong>

              <span>
                {
                  email
                }
              </span>

              <small>
                {
                  role
                }
              </small>
            </div>
          </div>
        </article>

        {/* SYNC */}

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
          HOW IT WORKS
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
                Readings are compared
                with your saved safety
                limits.
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
                Values outside your
                range may be marked for
                checking or urgent
                attention.
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
                Online settings can be
                reused by connected
                mobile and monitoring
                features.
              </small>
            </span>
          </div>
        </div>
      </section>

      {/* ===============================================
          THRESHOLD BASIS
      ================================================ */}

      <EvidenceOverview />

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
              Each setting now shows
              its current value,
              original default,
              research or calibration
              basis, and validation
              status.
            </span>
          </div>

          <Settings
            size={23}
          />
        </div>

        <div className="cray-settings-threshold-sections">
          {thresholdSections.map(
            (
              section
            ) => {
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
                </article>
              );
            }
          )}
        </div>
      </section>

      {/* ===============================================
          SAVE FOOTER
      ================================================ */}

      <section className="cray-settings-save-footer">
        <div>
          <strong>
            {isDirty
              ? "You have changes that are not saved yet."
              : "Your current values are saved."}
          </strong>

          <span>
            Check both the active
            value and its research or
            calibration basis before
            applying changes to your
            system.
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

/* =========================================================
   BASIS / REFERENCE CARD STYLES
   THEME AWARE
========================================================= */

const evidencePanelStyle = {
  overflow:
    "visible",
};

const evidenceIntroStyle = {
  margin:
    "0 0 16px",

  color:
    "var(--ct-muted, var(--text, #64748b))",

  fontSize:
    "0.84rem",

  lineHeight:
    1.65,
};

const evidenceGridStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "repeat(auto-fit, minmax(220px, 1fr))",

  gap:
    "10px",
};

const evidenceItemStyle = {
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "10px",

  padding:
    "12px",

  borderRadius:
    "12px",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",
};

const evidenceIconStyle = {
  width:
    "34px",

  height:
    "34px",

  flexShrink:
    0,

  display:
    "grid",

  placeItems:
    "center",

  borderRadius:
    "10px",

  color:
    "var(--ct-brand, #008f83)",

  background:
    "var(--ct-brand-soft, rgba(0, 217, 199, 0.10))",
};

const evidenceTitleStyle = {
  display:
    "block",

  marginBottom:
    "4px",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  fontSize:
    "0.82rem",
};

const evidenceTextStyle = {
  margin:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",

  fontSize:
    "0.75rem",

  lineHeight:
    1.55,
};

const evidenceResearchNoteStyle = {
  marginTop:
    "12px",

  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "8px",

  padding:
    "11px 12px",

  borderRadius:
    "11px",

  background:
    "var(--ct-brand-soft, rgba(0, 217, 199, 0.08))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  fontSize:
    "0.76rem",

  lineHeight:
    1.55,
};

/* =========================================================
   ACTIVE SETTING
========================================================= */

const activeSettingStyle = {
  display:
    "flex",

  alignItems:
    "center",

  justifyContent:
    "space-between",

  gap:
    "10px",

  margin:
    "12px 0 10px",

  padding:
    "10px 11px",

  borderRadius:
    "11px",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  background:
    "var(--ct-surface-strong, var(--ct-surface, var(--bg, #ffffff)))",
};

const activeSettingEyebrowStyle = {
  display:
    "block",

  marginBottom:
    "2px",

  color:
    "var(--ct-muted, var(--text, #64748b))",

  fontSize:
    "0.68rem",

  fontWeight:
    700,

  textTransform:
    "uppercase",

  letterSpacing:
    "0.04em",
};

const activeSettingValueStyle = {
  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  fontSize:
    "0.95rem",
};

const defaultStatusBadgeStyle = {
  flexShrink:
    0,

  padding:
    "5px 8px",

  borderRadius:
    "999px",

  color:
    "var(--ct-brand, #008f83)",

  background:
    "var(--ct-brand-soft, rgba(0, 217, 199, 0.10))",

  fontSize:
    "0.68rem",

  fontWeight:
    700,
};

const changedDefaultStatusBadgeStyle = {
  color:
    "var(--ct-muted, var(--text, #64748b))",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",
};

/* =========================================================
   BASIS CARD
========================================================= */

const basisCardStyle = {
  marginTop:
    "14px",

  padding:
    "12px",

  borderRadius:
    "12px",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  background:
    "var(--ct-surface-strong, var(--ct-surface, var(--bg, #ffffff)))",
};

const basisCardTopStyle = {
  display:
    "flex",

  alignItems:
    "center",

  justifyContent:
    "space-between",

  gap:
    "8px",

  flexWrap:
    "wrap",
};

const basisBadgeStyle = {
  display:
    "inline-flex",

  alignItems:
    "center",

  gap:
    "5px",

  padding:
    "5px 8px",

  borderRadius:
    "999px",

  color:
    "var(--ct-brand, #008f83)",

  background:
    "var(--ct-brand-soft, rgba(0, 217, 199, 0.10))",

  fontSize:
    "0.68rem",

  fontWeight:
    700,
};

const basisDefaultBadgeStyle = {
  color:
    "var(--ct-muted, var(--text, #64748b))",

  fontSize:
    "0.68rem",

  fontWeight:
    700,
};

const basisReferenceValueStyle = {
  marginTop:
    "10px",

  padding:
    "8px 10px",

  borderRadius:
    "9px",

  background:
    "var(--ct-brand-soft, rgba(0, 217, 199, 0.07))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  fontSize:
    "0.76rem",

  fontWeight:
    700,

  lineHeight:
    1.45,
};

const basisTextGridStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "repeat(auto-fit, minmax(210px, 1fr))",

  gap:
    "10px",

  marginTop:
    "10px",
};

const basisLabelStyle = {
  display:
    "block",

  marginBottom:
    "4px",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  fontSize:
    "0.72rem",
};

const basisParagraphStyle = {
  margin:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",

  fontSize:
    "0.72rem",

  lineHeight:
    1.55,
};

const basisSourceStyle = {
  marginTop:
    "10px",

  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "2px",

  color:
    "var(--ct-muted, var(--text, #64748b))",

  fontSize:
    "0.68rem",

  lineHeight:
    1.45,
};

const basisCautionStyle = {
  marginTop:
    "10px",

  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "7px",

  padding:
    "8px 9px",

  borderRadius:
    "9px",

  background:
    "rgba(245, 158, 11, 0.09)",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  fontSize:
    "0.69rem",

  lineHeight:
    1.5,
};

const basisValidationStyle = {
  marginTop:
    "8px",

  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "7px",

  padding:
    "8px 9px",

  borderRadius:
    "9px",

  border:
    "1px dashed var(--ct-border, var(--border, #e5e4e7))",

  color:
    "var(--ct-muted, var(--text, #64748b))",

  fontSize:
    "0.69rem",

  lineHeight:
    1.5,
};

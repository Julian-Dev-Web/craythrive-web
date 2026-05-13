import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Droplets,
  FlaskConical,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Thermometer,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const thresholdTables = [
  "threshold_settings",
  "user_threshold_settings",
  "sensor_thresholds",
];

const DEFAULT_THRESHOLDS = {
  temperature: {
    safeMin: 22,
    safeMax: 28,
  },
  ph: {
    safeMin: 6.5,
    safeMax: 8.0,
  },
  turbidity: {
    safeMax: 50,
    warningMax: 100,
    criticalMax: 200,
  },
  waterLevel: {
    safeMin: 4,
    safeMax: 5,
    criticalLow: 3,
    criticalHigh: 7,
  },
  ammonia: {
    safeMax: 0.25,
    warningMax: 0.5,
    criticalMax: 1.0,
  },
};

const SENSOR_CONFIG = {
  temperature: {
    title: "Temperature",
    icon: Thermometer,
    unit: "°C",
    description:
      "Controls the safe water temperature range used for tank condition checks.",
    fields: [
      {
        key: "safeMin",
        label: "Safe minimum",
        step: "0.1",
      },
      {
        key: "safeMax",
        label: "Safe maximum",
        step: "0.1",
      },
    ],
  },
  ph: {
    title: "pH Level",
    icon: FlaskConical,
    unit: "pH",
    description:
      "Controls the safe acidity/alkalinity range for the water condition.",
    fields: [
      {
        key: "safeMin",
        label: "Safe minimum",
        step: "0.1",
      },
      {
        key: "safeMax",
        label: "Safe maximum",
        step: "0.1",
      },
    ],
  },
  turbidity: {
    title: "Turbidity",
    icon: Waves,
    unit: "NTU",
    description:
      "Controls water clarity thresholds for dirty or critical water alerts.",
    fields: [
      {
        key: "safeMax",
        label: "Safe maximum",
        step: "1",
      },
      {
        key: "warningMax",
        label: "Warning maximum",
        step: "1",
      },
      {
        key: "criticalMax",
        label: "Critical maximum",
        step: "1",
      },
    ],
  },
  waterLevel: {
    title: "Water Level",
    icon: Droplets,
    unit: "in",
    description:
      "Controls the safe water height. Default is based on the client target of around 4 to 5 inches.",
    fields: [
      {
        key: "safeMin",
        label: "Safe minimum",
        step: "0.1",
      },
      {
        key: "safeMax",
        label: "Safe maximum",
        step: "0.1",
      },
      {
        key: "criticalLow",
        label: "Critical low",
        step: "0.1",
      },
      {
        key: "criticalHigh",
        label: "Critical high",
        step: "0.1",
      },
    ],
  },
  ammonia: {
    title: "Ammonia",
    icon: Camera,
    unit: "ppm",
    description:
      "Controls ammonia result thresholds from mobile or ESP32-CAM test strip records.",
    fields: [
      {
        key: "safeMax",
        label: "Safe maximum",
        step: "0.01",
      },
      {
        key: "warningMax",
        label: "Warning maximum",
        step: "0.01",
      },
      {
        key: "criticalMax",
        label: "Critical maximum",
        step: "0.01",
      },
    ],
  },
};

function cloneDefaultThresholds() {
  return JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
}

function mergeThresholds(incoming) {
  const defaults = cloneDefaultThresholds();

  if (!incoming || typeof incoming !== "object") {
    return defaults;
  }

  Object.keys(defaults).forEach((sensorKey) => {
    defaults[sensorKey] = {
      ...defaults[sensorKey],
      ...(incoming[sensorKey] || {}),
    };
  });

  return defaults;
}

function normalizeThresholds(thresholds) {
  const normalized = {};

  Object.entries(thresholds).forEach(([sensorKey, values]) => {
    normalized[sensorKey] = {};

    Object.entries(values || {}).forEach(([fieldKey, value]) => {
      const numberValue = Number(value);
      normalized[sensorKey][fieldKey] = Number.isFinite(numberValue)
        ? numberValue
        : value;
    });
  });

  return normalized;
}

function getStorageKey(userId) {
  return `craythrive_thresholds_${userId || "local"}`;
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

async function readThresholdsFromSupabase(userId) {
  for (const tableName of thresholdTables) {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data) {
      return {
        thresholds: data.thresholds || data.settings || data.sensor_thresholds,
        source: tableName,
      };
    }
  }

  return {
    thresholds: null,
    source: "",
  };
}

async function saveThresholdsToSupabase(userId, thresholds) {
  const payloadOptions = [
    {
      user_id: userId,
      thresholds,
      updated_at: new Date().toISOString(),
    },
    {
      user_id: userId,
      settings: thresholds,
      updated_at: new Date().toISOString(),
    },
  ];

  for (const tableName of thresholdTables) {
    for (const payload of payloadOptions) {
      const { error } = await supabase
        .from(tableName)
        .upsert(payload, {
          onConflict: "user_id",
        });

      if (!error) {
        return {
          saved: true,
          source: tableName,
        };
      }
    }
  }

  return {
    saved: false,
    source: "",
  };
}

export default function SettingsPage() {
  const [thresholds, setThresholds] = useState(cloneDefaultThresholds());
  const [authUserId, setAuthUserId] = useState("");
  const [source, setSource] = useState("Default values");
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const thresholdSummary = useMemo(
    () => [
      {
        label: "Temperature",
        value: `${thresholds.temperature.safeMin} - ${thresholds.temperature.safeMax} °C`,
      },
      {
        label: "pH",
        value: `${thresholds.ph.safeMin} - ${thresholds.ph.safeMax}`,
      },
      {
        label: "Turbidity",
        value: `Safe ≤ ${thresholds.turbidity.safeMax} NTU`,
      },
      {
        label: "Water level",
        value: `${thresholds.waterLevel.safeMin} - ${thresholds.waterLevel.safeMax} in`,
      },
      {
        label: "Ammonia",
        value: `Safe ≤ ${thresholds.ammonia.safeMax} ppm`,
      },
    ],
    [thresholds]
  );

  const loadSettings = async () => {
    setStatusMessage("");

    if (!isSupabaseConfigured || !supabase) {
      const local = localStorage.getItem(getStorageKey("local"));

      if (local) {
        setThresholds(mergeThresholds(JSON.parse(local)));
        setSource("Local browser storage");
      }

      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      setAuthUserId(currentUser.id);

      if (!currentUser.id) {
        setThresholds(cloneDefaultThresholds());
        setSource("Default values");
        return;
      }

      const supabaseResult = await readThresholdsFromSupabase(currentUser.id);

      if (supabaseResult.thresholds) {
        setThresholds(mergeThresholds(supabaseResult.thresholds));
        setSource(supabaseResult.source);
        return;
      }

      const local = localStorage.getItem(getStorageKey(currentUser.id));

      if (local) {
        setThresholds(mergeThresholds(JSON.parse(local)));
        setSource("Local browser storage");
        return;
      }

      setThresholds(cloneDefaultThresholds());
      setSource("Default values");
    } catch (error) {
      console.error("Settings loading error:", error);
      setThresholds(cloneDefaultThresholds());
      setSource("Default values");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const updateThreshold = (sensorKey, fieldKey, value) => {
    setThresholds((current) => ({
      ...current,
      [sensorKey]: {
        ...current[sensorKey],
        [fieldKey]: value,
      },
    }));
  };

  const handleSave = async () => {
    setStatusMessage("");

    const normalized = normalizeThresholds(thresholds);
    const storageKey = getStorageKey(authUserId || "local");

    try {
      setIsSaving(true);

      if (isSupabaseConfigured && supabase && authUserId) {
        const result = await saveThresholdsToSupabase(authUserId, normalized);

        if (result.saved) {
          localStorage.setItem(storageKey, JSON.stringify(normalized));
          setThresholds(mergeThresholds(normalized));
          setSource(result.source);
          setStatusMessage("Threshold settings saved successfully.");
          return;
        }
      }

      localStorage.setItem(storageKey, JSON.stringify(normalized));
      setThresholds(mergeThresholds(normalized));
      setSource("Local browser storage");
      setStatusMessage(
        "Saved locally. Add a threshold_settings table later for mobile sync."
      );
    } catch (error) {
      console.error("Settings saving error:", error);
      setStatusMessage("Could not save thresholds. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setThresholds(cloneDefaultThresholds());
    setSource("Default values");
    setStatusMessage("Default thresholds restored. Click Save to apply them.");
  };

  if (isLoading) {
    return (
      <section className="settings-empty-state">
        <Loader2 className="spin-icon" size={30} />
        <h3>Loading settings...</h3>
        <p>Please wait while CrayThrive checks your threshold settings.</p>
      </section>
    );
  }

  return (
    <div className="settings-page">
      <section className="settings-header-card">
        <div>
          <p className="dashboard-eyebrow">System Configuration</p>
          <h2>Settings</h2>
          <p>
            Configure safe threshold values for your tank sensors. These values
            can be used by the dashboard, mobile app, and IoT rule logic for
            normal, warning, and critical status checks.
          </p>

          <div className="settings-header-actions">
            <button className="dashboard-primary-button" onClick={handleSave}>
              {isSaving ? (
                <Loader2 className="spin-icon" size={18} />
              ) : (
                <Save size={18} />
              )}
              Save Thresholds
            </button>

            <button
              className="settings-secondary-button"
              type="button"
              onClick={handleResetDefaults}
            >
              <RotateCcw size={18} />
              Restore Defaults
            </button>

            <button
              className="settings-secondary-button"
              type="button"
              onClick={loadSettings}
            >
              <RefreshCw size={18} />
              Reload
            </button>

            <span>Source: {source}</span>
          </div>

          {statusMessage && (
            <div className="settings-status-message">
              <CheckCircle2 size={18} />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>
      </section>

      <section className="settings-summary-grid">
        {thresholdSummary.map((item) => (
          <article className="settings-summary-card" key={item.label}>
            <span>
              <Settings2 size={22} />
            </span>
            <strong>{item.value}</strong>
            <p>{item.label}</p>
          </article>
        ))}
      </section>

      <section className="settings-note-card">
        <AlertTriangle size={22} />
        <div>
          <strong>Threshold note</strong>
          <p>
            These are starter/default values. For final deployment, adjust them
            based on actual crayfish species, tank setup, adviser feedback, and
            client testing.
          </p>
        </div>
      </section>

      <section className="threshold-card-grid">
        {Object.entries(SENSOR_CONFIG).map(([sensorKey, config]) => {
          const Icon = config.icon;

          return (
            <article className="threshold-card" key={sensorKey}>
              <div className="threshold-card-header">
                <span>
                  <Icon size={24} />
                </span>

                <div>
                  <h3>{config.title}</h3>
                  <p>{config.description}</p>
                </div>
              </div>

              <div className="threshold-field-grid">
                {config.fields.map((field) => (
                  <label className="threshold-field" key={field.key}>
                    <span>{field.label}</span>

                    <div>
                      <input
                        type="number"
                        step={field.step}
                        value={thresholds[sensorKey]?.[field.key] ?? ""}
                        onChange={(event) =>
                          updateThreshold(
                            sensorKey,
                            field.key,
                            event.target.value
                          )
                        }
                      />
                      <b>{config.unit}</b>
                    </div>
                  </label>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
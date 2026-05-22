import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Droplets,
  Gauge,
  Loader2,
  RefreshCw,
  Save,
  Settings,
  Thermometer,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const STORAGE_KEY = "craythrive_threshold_settings";
const TABLE_NAME = "threshold_settings";

const DEFAULT_THRESHOLDS = {
  temperatureMin: 20,
  temperatureMax: 30,
  phMin: 6.5,
  phMax: 8.5,
  turbidityMax: 40,
  waterLevelMin: 35,
  ammoniaMax: 0.25,
};

const thresholdRows = [
  {
    key: "temperatureMin",
    label: "Temperature Minimum",
    helper: "Lowest safe water temperature.",
    unit: "°C",
    icon: Thermometer,
    min: 10,
    max: 40,
    step: 0.1,
  },
  {
    key: "temperatureMax",
    label: "Temperature Maximum",
    helper: "Highest safe water temperature.",
    unit: "°C",
    icon: Thermometer,
    min: 10,
    max: 40,
    step: 0.1,
  },
  {
    key: "phMin",
    label: "pH Minimum",
    helper: "Lowest safe pH level.",
    unit: "pH",
    icon: Droplets,
    min: 0,
    max: 14,
    step: 0.1,
  },
  {
    key: "phMax",
    label: "pH Maximum",
    helper: "Highest safe pH level.",
    unit: "pH",
    icon: Droplets,
    min: 0,
    max: 14,
    step: 0.1,
  },
  {
    key: "turbidityMax",
    label: "Turbidity Maximum",
    helper: "Maximum dirty water/turbidity value.",
    unit: "V",
    icon: Waves,
    min: 0,
    max: 5,
    step: 0.01,
  },
  {
    key: "waterLevelMin",
    label: "Water Level Minimum",
    helper: "Minimum safe tank water level.",
    unit: "cm",
    icon: Gauge,
    min: 0,
    max: 30,
    step: 0.1,
  },
  {
    key: "ammoniaMax",
    label: "Ammonia Maximum",
    helper: "Maximum safe ammonia reading.",
    unit: "ppm",
    icon: AlertTriangle,
    min: 0,
    max: 5,
    step: 0.01,
  },
];

function getLocalThresholds() {
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

function isRangeValid(thresholds) {
  return (
    Number(thresholds.temperatureMin) < Number(thresholds.temperatureMax) &&
    Number(thresholds.phMin) < Number(thresholds.phMax)
  );
}

async function getCurrentUser() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.log("GET SESSION ERROR:", error);
    return null;
  }

  return data?.session?.user || null;
}

async function loadThresholdsFromSupabase(userId) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.log("LOAD THRESHOLDS ERROR:", error);
    return {
      thresholds: getLocalThresholds(),
      source: "localStorage",
    };
  }

  if (!data) {
    return {
      thresholds: getLocalThresholds(),
      source: "localStorage",
    };
  }

  return {
    thresholds: normalizeThresholds(data),
    source: TABLE_NAME,
  };
}

async function saveThresholdsToSupabase(userId, thresholds) {
  const payload = {
    user_id: userId,
    thresholds,

    temperature_min: Number(thresholds.temperatureMin),
    temperature_max: Number(thresholds.temperatureMax),

    ph_min: Number(thresholds.phMin),
    ph_max: Number(thresholds.phMax),

    turbidity_max: Number(thresholds.turbidityMax),
    water_level_min: Number(thresholds.waterLevelMin),
    ammonia_max: Number(thresholds.ammoniaMax),

    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(payload, {
      onConflict: "user_id",
    })
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function ThresholdControl({ item, value, onChange }) {
  const Icon = item.icon;

  return (
    <article className="modern-setting-threshold-card">
      <div className="modern-setting-threshold-top">
        <span>
          <Icon size={20} />
        </span>

        <div>
          <strong>{item.label}</strong>
          <small>{item.helper}</small>
        </div>
      </div>

      <div className="modern-setting-threshold-control">
        <input
          type="range"
          min={item.min}
          max={item.max}
          step={item.step}
          value={value}
          onChange={(event) => onChange(item.key, event.target.value)}
        />

        <label>
          <input
            type="number"
            min={item.min}
            max={item.max}
            step={item.step}
            value={value}
            onChange={(event) => onChange(item.key, event.target.value)}
          />
          <span>{item.unit}</span>
        </label>
      </div>
    </article>
  );
}

export default function ThresholdSettingsPage() {
  const [thresholds, setThresholds] = useState(getLocalThresholds);
  const [user, setUser] = useState(null);
  const [dataSource, setDataSource] = useState("localStorage");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const validThresholds = useMemo(() => isRangeValid(thresholds), [thresholds]);

  async function loadSettings() {
    setMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setDataSource("localStorage");
      setThresholds(getLocalThresholds());
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();
      setUser(currentUser);

      if (!currentUser?.id) {
        setDataSource("localStorage");
        setThresholds(getLocalThresholds());
        return;
      }

      const loaded = await loadThresholdsFromSupabase(currentUser.id);

      setThresholds(loaded.thresholds);
      setDataSource(loaded.source);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded.thresholds));
    } catch (error) {
      console.log("THRESHOLD SETTINGS LOAD ERROR:", error);
      setDataSource("localStorage");
      setThresholds(getLocalThresholds());
      setMessage("Loaded local thresholds because Supabase was not available.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function handleThresholdChange(key, value) {
    setMessage("");

    setThresholds((current) => ({
      ...current,
      [key]: Number(value),
    }));
  }

  function handleResetDefaults() {
    setThresholds(DEFAULT_THRESHOLDS);
    setMessage("Default thresholds restored. Click Save Settings to apply.");
  }

  async function handleSave() {
    setMessage("");

    if (!validThresholds) {
      setMessage("Temperature and pH minimum values must be lower than maximum values.");
      return;
    }

    try {
      setIsSaving(true);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));

      if (!isSupabaseConfigured || !supabase || !user?.id) {
        setDataSource("localStorage");
        setMessage("Saved locally only. Login or connect Supabase to sync with mobile.");
        return;
      }

      await saveThresholdsToSupabase(user.id, thresholds);

      setDataSource(TABLE_NAME);
      setMessage("Threshold settings saved to Supabase. Mobile can now fetch these values.");
    } catch (error) {
      console.log("THRESHOLD SETTINGS SAVE ERROR:", error);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));
      setDataSource("localStorage");
      setMessage("Saved locally because Supabase save failed. Check threshold_settings table.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <section className="modern-settings-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading threshold settings...</h3>
        <p>CrayThrive is preparing your safe water threshold values.</p>
      </section>
    );
  }

  return (
    <div className="modern-settings-page">
      <section className="modern-settings-hero">
        <div>
          <p className="dashboard-eyebrow">Threshold Settings</p>
          <h2>Control your safe water thresholds.</h2>
          <p>
            Adjust the values used by CrayThrive to classify tank readings as
            safe, warning, or critical. These values are saved to Supabase so the
            mobile app can use the same rules.
          </p>

          <div className="modern-settings-actions">
            <button
              type="button"
              className="dashboard-primary-button"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  Saving...
                  <Loader2 className="spin-icon" size={18} />
                </>
              ) : (
                <>
                  Save Settings
                  <Save size={18} />
                </>
              )}
            </button>

            <button
              type="button"
              className="modern-secondary-link"
              onClick={handleResetDefaults}
            >
              <RefreshCw size={18} />
              Restore Defaults
            </button>

            <span>Source: {dataSource}</span>
          </div>
        </div>

        <div className="modern-settings-hero-card">
          <Settings size={38} />
          <strong>{validThresholds ? "Ready" : "Check"}</strong>
          <span>
            {validThresholds
              ? "Threshold values are valid"
              : "Some ranges need review"}
          </span>
        </div>
      </section>

      {message && (
        <section
          className={`modern-settings-message ${
            validThresholds ? "success" : "warning"
          }`}
        >
          {validThresholds ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
          <span>{message}</span>
        </section>
      )}

      <section className="modern-settings-panel modern-settings-wide">
        <div className="modern-panel-heading">
          <div>
            <p className="dashboard-eyebrow">Safe Thresholds</p>
            <h3>Water condition rules</h3>
          </div>
          <Database size={22} />
        </div>

        <div className="modern-setting-threshold-grid">
          {thresholdRows.map((item) => (
            <ThresholdControl
              key={item.key}
              item={item}
              value={thresholds[item.key]}
              onChange={handleThresholdChange}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
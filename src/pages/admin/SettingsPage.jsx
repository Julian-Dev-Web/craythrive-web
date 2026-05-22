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
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const STORAGE_KEY = "craythrive_threshold_settings";
const THRESHOLD_TABLE = "threshold_settings";

const DEFAULT_THRESHOLDS = {
  temperatureMin: 20,
  temperatureMax: 30,
  phMin: 6.5,
  phMax: 8.5,

  // Your turbidity sensor uses voltage.
  // Higher voltage = clearer water.
  // 2.5V and above = CLEAR based on your UNO logic.
  turbidityMax: 2.5,

  // Your ESP32 uploads water_depth_cm / water_level in cm.
  // 4.5cm is the safe minimum based on your current ESP32 logic.
  waterLevelMin: 4.5,

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
    label: "Turbidity Clear Minimum",
    helper: "Minimum voltage considered clear/safe.",
    unit: "V",
    icon: Waves,
    min: 0,
    max: 5,
    step: 0.01,
  },
  {
    key: "waterLevelMin",
    label: "Water Depth Minimum",
    helper: "Minimum safe tank water depth.",
    unit: "cm",
    icon: Gauge,
    min: 0,
    max: 20,
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

    return normalizeThresholds(JSON.parse(saved));
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

function toNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeThresholds(data) {
  if (!data) return DEFAULT_THRESHOLDS;

  const source = data.thresholds || data.safe_thresholds || data;

  return {
    temperatureMin: toNumber(
      source.temperatureMin ?? source.temperature_min,
      DEFAULT_THRESHOLDS.temperatureMin
    ),
    temperatureMax: toNumber(
      source.temperatureMax ?? source.temperature_max,
      DEFAULT_THRESHOLDS.temperatureMax
    ),
    phMin: toNumber(source.phMin ?? source.ph_min, DEFAULT_THRESHOLDS.phMin),
    phMax: toNumber(source.phMax ?? source.ph_max, DEFAULT_THRESHOLDS.phMax),
    turbidityMax: toNumber(
      source.turbidityMax ?? source.turbidity_max,
      DEFAULT_THRESHOLDS.turbidityMax
    ),
    waterLevelMin: toNumber(
      source.waterLevelMin ?? source.water_level_min,
      DEFAULT_THRESHOLDS.waterLevelMin
    ),
    ammoniaMax: toNumber(
      source.ammoniaMax ?? source.ammonia_max,
      DEFAULT_THRESHOLDS.ammoniaMax
    ),
  };
}

function getProfileName(profile, user) {
  return (
    profile?.username ||
    profile?.full_name ||
    profile?.first_name ||
    user?.email?.split("@")?.[0] ||
    "CrayThrive User"
  );
}

function isRangeValid(thresholds) {
  return (
    Number(thresholds.temperatureMin) < Number(thresholds.temperatureMax) &&
    Number(thresholds.phMin) < Number(thresholds.phMax)
  );
}

async function getCurrentUserAndProfile() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  if (!user) {
    return {
      user: null,
      profile: null,
    };
  }

  const byId = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return {
      user,
      profile: byId.data,
    };
  }

  const byEmail = await supabase
    .from("profiles")
    .select("*")
    .ilike("email", user.email)
    .maybeSingle();

  return {
    user,
    profile: byEmail.error ? null : byEmail.data,
  };
}

async function loadThresholdsFromSupabase(userId) {
  const { data, error } = await supabase
    .from(THRESHOLD_TABLE)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.log("LOAD THRESHOLDS ERROR:", error);
    return {
      thresholds: getLocalThresholds(),
      tableUsed: "localStorage",
    };
  }

  if (!data) {
    return {
      thresholds: getLocalThresholds(),
      tableUsed: "localStorage",
    };
  }

  return {
    thresholds: normalizeThresholds(data),
    tableUsed: THRESHOLD_TABLE,
  };
}

async function saveThresholdsToSupabase(userId, thresholds) {
  const cleanThresholds = normalizeThresholds(thresholds);

  const payload = {
    user_id: userId,

    thresholds: cleanThresholds,

    temperature_min: Number(cleanThresholds.temperatureMin),
    temperature_max: Number(cleanThresholds.temperatureMax),

    ph_min: Number(cleanThresholds.phMin),
    ph_max: Number(cleanThresholds.phMax),

    turbidity_max: Number(cleanThresholds.turbidityMax),
    water_level_min: Number(cleanThresholds.waterLevelMin),
    ammonia_max: Number(cleanThresholds.ammoniaMax),

    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(THRESHOLD_TABLE)
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

export default function SettingsPage() {
  const [thresholds, setThresholds] = useState(getLocalThresholds);
  const [profile, setProfile] = useState(null);
  const [user, setUser] = useState(null);
  const [dataSource, setDataSource] = useState("localStorage");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const displayName = getProfileName(profile, user);
  const email = profile?.email || user?.email || "No email";
  const validThresholds = useMemo(() => isRangeValid(thresholds), [thresholds]);

  const loadSettings = async () => {
    setMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setDataSource("localStorage");
      setThresholds(getLocalThresholds());
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const result = await getCurrentUserAndProfile();

      setUser(result.user);
      setProfile(result.profile);

      if (!result.user?.id) {
        setDataSource("localStorage");
        setThresholds(getLocalThresholds());
        return;
      }

      const loaded = await loadThresholdsFromSupabase(result.user.id);

      setThresholds(loaded.thresholds);
      setDataSource(loaded.tableUsed);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded.thresholds));
    } catch (error) {
      console.error("Settings loading error:", error);

      setDataSource("localStorage");
      setThresholds(getLocalThresholds());
      setMessage("Loaded local settings because Supabase threshold table is not available.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleThresholdChange = (key, value) => {
    setMessage("");

    setThresholds((current) => ({
      ...current,
      [key]: Number(value),
    }));
  };

  const handleResetDefaults = () => {
    setThresholds(DEFAULT_THRESHOLDS);
    setMessage("Default CrayThrive safe thresholds restored. Save changes to apply.");
  };

  const handleSave = async () => {
    setMessage("");

    if (!validThresholds) {
      setMessage("Temperature and pH minimum values must be lower than maximum values.");
      return;
    }

    try {
      setIsSaving(true);

      const cleanThresholds = normalizeThresholds(thresholds);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanThresholds));

      if (!isSupabaseConfigured || !supabase || !user?.id) {
        setDataSource("localStorage");
        setMessage("Saved locally only. Login and connect Supabase to sync with mobile.");
        return;
      }

      await saveThresholdsToSupabase(user.id, cleanThresholds);

      setThresholds(cleanThresholds);
      setDataSource(THRESHOLD_TABLE);
      setMessage("Threshold settings saved to Supabase. Mobile can now fetch these values.");
    } catch (error) {
      console.error("Settings saving error:", error);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));
      setDataSource("localStorage");
      setMessage("Saved locally because Supabase threshold_settings table is not ready.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <section className="modern-settings-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading settings...</h3>
        <p>CrayThrive is preparing your profile and threshold settings.</p>
      </section>
    );
  }

  return (
    <div className="modern-settings-page">
      <section className="modern-settings-hero">
        <div>
          <p className="dashboard-eyebrow">Settings</p>
          <h2>Control your safe water thresholds.</h2>
          <p>
            Adjust the values used to classify tank readings as safe, warning,
            or critical. These settings are saved to Supabase and can be reused
            by the mobile app and alert logic.
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

      <section className="modern-settings-grid">
        <article className="modern-settings-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Account</p>
              <h3>Web dashboard profile</h3>
            </div>
            <UserRound size={22} />
          </div>

          <div className="modern-settings-profile-card">
            <div className="modern-settings-avatar">
              <UserRound size={28} />
            </div>

            <div>
              <strong>{displayName}</strong>
              <span>{email}</span>
              <small>Role: Admin dashboard access</small>
            </div>
          </div>
        </article>

        <article className="modern-settings-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Notifications</p>
              <h3>Alert behavior</h3>
            </div>
            <Bell size={22} />
          </div>

          <div className="modern-settings-info-list">
            <div>
              <ShieldCheck size={19} />
              <span>Critical alerts stay visible until the latest safe reading resolves them.</span>
            </div>

            <div>
              <Database size={19} />
              <span>Threshold values are saved in Supabase for mobile sync.</span>
            </div>

            <div>
              <AlertTriangle size={19} />
              <span>Unsafe values classify readings into warning or critical.</span>
            </div>
          </div>
        </article>
      </section>

      <section className="modern-settings-panel modern-settings-wide">
        <div className="modern-panel-heading">
          <div>
            <p className="dashboard-eyebrow">Safe Thresholds</p>
            <h3>Water condition rules</h3>
          </div>
          <Gauge size={22} />
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
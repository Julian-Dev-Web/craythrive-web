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

const DEFAULT_THRESHOLDS = {
  temperatureMin: 20,
  temperatureMax: 30,
  phMin: 6.5,
  phMax: 8.5,
  turbidityMax: 40,
  waterLevelMin: 35,
  ammoniaMax: 0.25,
};

const thresholdTableCandidates = [
  "user_settings",
  "threshold_settings",
  "tank_thresholds",
  "settings",
];

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
    unit: "NTU",
    icon: Waves,
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "waterLevelMin",
    label: "Water Level Minimum",
    helper: "Minimum safe tank water level.",
    unit: "%",
    icon: Gauge,
    min: 0,
    max: 100,
    step: 1,
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

function normalizeThresholds(data) {
  if (!data) return DEFAULT_THRESHOLDS;

  const source = data.thresholds || data.safe_thresholds || data;

  return {
    temperatureMin:
      Number(source.temperatureMin ?? source.temperature_min) ||
      DEFAULT_THRESHOLDS.temperatureMin,
    temperatureMax:
      Number(source.temperatureMax ?? source.temperature_max) ||
      DEFAULT_THRESHOLDS.temperatureMax,
    phMin: Number(source.phMin ?? source.ph_min) || DEFAULT_THRESHOLDS.phMin,
    phMax: Number(source.phMax ?? source.ph_max) || DEFAULT_THRESHOLDS.phMax,
    turbidityMax:
      Number(source.turbidityMax ?? source.turbidity_max) ||
      DEFAULT_THRESHOLDS.turbidityMax,
    waterLevelMin:
      Number(source.waterLevelMin ?? source.water_level_min) ||
      DEFAULT_THRESHOLDS.waterLevelMin,
    ammoniaMax:
      Number(source.ammoniaMax ?? source.ammonia_max) ||
      DEFAULT_THRESHOLDS.ammoniaMax,
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
  for (const tableName of thresholdTableCandidates) {
    const response = await supabase
      .from(tableName)
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!response.error && response.data) {
      return {
        thresholds: normalizeThresholds(response.data),
        tableUsed: tableName,
      };
    }

    const byOwner = await supabase
      .from(tableName)
      .select("*")
      .eq("owner_id", userId)
      .maybeSingle();

    if (!byOwner.error && byOwner.data) {
      return {
        thresholds: normalizeThresholds(byOwner.data),
        tableUsed: tableName,
      };
    }
  }

  return {
    thresholds: getLocalThresholds(),
    tableUsed: "localStorage",
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

  for (const tableName of thresholdTableCandidates) {
    const response = await supabase
      .from(tableName)
      .upsert(payload, {
        onConflict: "user_id",
      })
      .select()
      .maybeSingle();

    if (!response.error) {
      return tableName;
    }
  }

  return "localStorage";
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

      localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));

      let savedSource = "localStorage";

      if (isSupabaseConfigured && supabase && user?.id) {
        savedSource = await saveThresholdsToSupabase(user.id, thresholds);
      }

      setDataSource(savedSource);
      setMessage(
        savedSource === "localStorage"
          ? "Saved locally. Add a Supabase threshold table later to sync with mobile."
          : `Threshold settings saved to ${savedSource}.`
      );
    } catch (error) {
      console.error("Settings saving error:", error);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));
      setDataSource("localStorage");
      setMessage("Saved locally because Supabase settings table is not available yet.");
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
            Adjust the values used to classify tank readings as normal, warning,
            or critical. These settings are prepared for syncing with the mobile
            app and IoT monitoring logic.
          </p>

          <div className="modern-settings-actions">
            <button className="dashboard-primary-button" onClick={handleSave}>
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
              <span>Critical water alerts should stay visible until resolved.</span>
            </div>

            <div>
              <Database size={19} />
              <span>Threshold values can be reused by mobile and IoT logic later.</span>
            </div>

            <div>
              <AlertTriangle size={19} />
              <span>Unsafe values will help classify readings into warning or critical.</span>
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
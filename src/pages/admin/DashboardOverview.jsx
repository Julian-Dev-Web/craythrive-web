import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  Droplets,
  Loader2,
  RefreshCw,
  ShoppingBag,
  
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "seller_id",
  "buyer_id",
];

const countConfigs = [
  {
    key: "tanks",
    title: "My Tanks",
    tableNames: ["tanks"],
    icon: Droplets,
    helper: "Tank records linked to this account.",
  },
  {
    key: "readings",
    title: "Sensor Readings",
    tableNames: ["sensor_readings", "tank_readings", "readings"],
    icon: Activity,
    helper: "Temperature, pH, turbidity, and water level logs.",
  },
  {
    key: "alerts",
    title: "Alerts",
    tableNames: ["alerts", "notifications", "tank_alerts"],
    icon: AlertTriangle,
    helper: "Warnings, reminders, and tank notifications.",
  },
  {
    key: "marketplace",
    title: "Listings",
    tableNames: ["marketplace_listings", "listings", "products"],
    icon: ShoppingBag,
    helper: "Crayfish-only marketplace listings.",
  },
];

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatDate(value) {
  if (!value) return "Recently";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getDisplayName(profile, fallbackEmail) {
  return (
    profile?.username ||
    profile?.nickname ||
    profile?.display_name ||
    profile?.full_name ||
    [profile?.first_name, profile?.middle_name, profile?.last_name]
      .filter(Boolean)
      .join(" ") ||
    fallbackEmail ||
    "CrayThrive User"
  );
}

function getAlertTitle(alert) {
  return (
    alert?.title ||
    alert?.alert_title ||
    alert?.type ||
    alert?.notification_type ||
    "CrayThrive Alert"
  );
}

function getAlertMessage(alert) {
  return (
    alert?.message ||
    alert?.body ||
    alert?.description ||
    alert?.notes ||
    "New notification from your CrayThrive account."
  );
}

function getSeverity(alert) {
  return String(alert?.severity || alert?.status || "info").toLowerCase();
}

function getReadingTankName(reading) {
  return (
    reading?.tank_name ||
    reading?.tank_label ||
    reading?.tank_id ||
    "Tank Reading"
  );
}

function getReadingStatus(reading) {
  return String(reading?.status || reading?.condition || "normal").toLowerCase();
}

function getReadingValue(reading, keys) {
  for (const key of keys) {
    if (reading?.[key] !== null && reading?.[key] !== undefined) {
      return reading[key];
    }
  }

  return null;
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

async function getProfile(userId, email) {
  const byId = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return byId.data;
  }

  if (email) {
    const byEmail = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      return byEmail.data;
    }
  }

  return null;
}

async function countUserRows(tableNames, userId) {
  for (const tableName of tableNames) {
    for (const column of userFilterColumns) {
      const { count, error } = await supabase
        .from(tableName)
        .select("*", { count: "exact", head: true })
        .eq(column, userId);

      if (!error) {
        return {
          count: count || 0,
          tableUsed: tableName,
        };
      }
    }
  }

  return {
    count: 0,
    tableUsed: tableNames[0],
  };
}

async function getRecentRows(tableNames, userId, limit = 5) {
  for (const tableName of tableNames) {
    for (const column of userFilterColumns) {
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!error && Array.isArray(data)) {
        return {
          rows: data,
          tableUsed: tableName,
        };
      }
    }
  }

  return {
    rows: [],
    tableUsed: tableNames[0],
  };
}

export default function DashboardOverview() {
  const [profile, setProfile] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [counts, setCounts] = useState({});
  const [tableMap, setTableMap] = useState({});
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [recentReadings, setRecentReadings] = useState([]);
  const [latestAmmonia, setLatestAmmonia] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const displayName = useMemo(
    () => getDisplayName(profile, authEmail),
    [profile, authEmail]
  );

  const loadDashboard = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      if (!currentUser.id) {
        setIsLoading(false);
        return;
      }

      const profileData = await getProfile(currentUser.id, currentUser.email);
      setProfile(profileData);
      setAuthEmail(currentUser.email);

      const countResults = await Promise.all(
        countConfigs.map(async (config) => {
          const result = await countUserRows(config.tableNames, currentUser.id);

          return {
            key: config.key,
            count: result.count,
            tableUsed: result.tableUsed,
          };
        })
      );

      const nextCounts = {};
      const nextTableMap = {};

      countResults.forEach((item) => {
        nextCounts[item.key] = item.count;
        nextTableMap[item.key] = item.tableUsed;
      });

      setCounts(nextCounts);
      setTableMap(nextTableMap);

      const alertsResult = await getRecentRows(
        ["alerts", "notifications", "tank_alerts"],
        currentUser.id,
        5
      );

      const readingsResult = await getRecentRows(
        ["sensor_readings", "tank_readings", "readings"],
        currentUser.id,
        5
      );

      const ammoniaResult = await getRecentRows(
        ["ammonia_readings", "ammonia_results"],
        currentUser.id,
        1
      );

      setRecentAlerts(alertsResult.rows);
      setRecentReadings(readingsResult.rows);
      setLatestAmmonia(ammoniaResult.rows[0] || null);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Dashboard overview loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  return (
    <div className="dashboard-overview">
      <section className="dashboard-hero-card">
        <div>
          <p className="dashboard-eyebrow">Welcome back</p>
          <h2>{displayName}</h2>
          <p>
            This dashboard shows tank monitoring, sensor readings, alerts,
            ammonia records, and marketplace activity connected to your
            CrayThrive mobile account.
          </p>

          <div className="dashboard-hero-actions">
            <button className="dashboard-primary-button" onClick={loadDashboard}>
              {isLoading ? (
                <Loader2 className="spin-icon" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
              Refresh Data
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : "Waiting for first sync"}
            </span>
          </div>
        </div>


      </section>

      <section className="dashboard-stat-grid">
        {countConfigs.map((config) => {
          const Icon = config.icon;

          return (
            <article className="dashboard-stat-card" key={config.key}>
              <div className="dashboard-stat-top">
                <span className="dashboard-stat-icon">
                  <Icon size={24} />
                </span>

                <span className="dashboard-table-label">
                  {tableMap[config.key] || config.tableNames[0]}
                </span>
              </div>

              <strong>{formatCount(counts[config.key])}</strong>
              <h3>{config.title}</h3>
              <p>{config.helper}</p>
            </article>
          );
        })}
      </section>

      <section className="dashboard-insight-grid">
        <article className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <p className="dashboard-eyebrow">Recent Alerts</p>
              <h3>Latest notifications</h3>
            </div>
            <Bell size={22} />
          </div>

          <div className="overview-list">
            {recentAlerts.length === 0 ? (
              <div className="overview-empty">
                <CheckCircle2 size={24} />
                <strong>No alerts yet</strong>
                <span>
                  Tank warnings, ammonia alerts, and marketplace notifications
                  will appear here.
                </span>
              </div>
            ) : (
              recentAlerts.map((alert, index) => (
                <div className="overview-alert-item" key={alert.id || index}>
                  <span className={`overview-dot severity-${getSeverity(alert)}`} />

                  <div>
                    <strong>{getAlertTitle(alert)}</strong>
                    <p>{getAlertMessage(alert)}</p>
                    <small>{formatDate(alert.created_at)}</small>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <p className="dashboard-eyebrow">Sensor Readings</p>
              <h3>Latest tank data</h3>
            </div>
            <Activity size={22} />
          </div>

          <div className="overview-list">
            {recentReadings.length === 0 ? (
              <div className="overview-empty">
                <Droplets size={24} />
                <strong>No readings yet</strong>
                <span>
                  Sensor data from the mobile app or IoT devices will appear
                  here.
                </span>
              </div>
            ) : (
              recentReadings.map((reading, index) => {
                const temp = getReadingValue(reading, [
                  "temperature",
                  "temp",
                  "water_temperature",
                ]);

                const ph = getReadingValue(reading, ["ph", "pH", "ph_level"]);

                const turbidity = getReadingValue(reading, [
                  "turbidity",
                  "turbidity_level",
                  "ntu",
                ]);

                const waterLevel = getReadingValue(reading, [
                  "water_level",
                  "level",
                  "water_height",
                ]);

                return (
                  <div
                    className="overview-reading-item"
                    key={reading.id || index}
                  >
                    <div>
                      <strong>{getReadingTankName(reading)}</strong>
                      <small>{formatDate(reading.created_at)}</small>
                    </div>

                    <div className="reading-chip-row">
                      {temp !== null && <span>{temp}°C</span>}
                      {ph !== null && <span>pH {ph}</span>}
                      {turbidity !== null && <span>{turbidity} NTU</span>}
                      {waterLevel !== null && <span>{waterLevel}</span>}
                      <span className={`reading-status ${getReadingStatus(reading)}`}>
                        {getReadingStatus(reading)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="dashboard-panel dashboard-ammonia-panel">
          <div className="dashboard-panel-header">
            <div>
              <p className="dashboard-eyebrow">Ammonia Reader</p>
              <h3>Latest ammonia result</h3>
            </div>
            <Camera size={22} />
          </div>

          {latestAmmonia ? (
            <div className="ammonia-summary">
              <strong>
                {getReadingValue(latestAmmonia, [
                  "ammonia_level",
                  "ammonia",
                  "nh3",
                  "result",
                ]) || "Recorded"}
              </strong>
              <span>
                {String(
                  latestAmmonia.status ||
                    latestAmmonia.condition ||
                    latestAmmonia.chart_label ||
                    "Result saved"
                )}
              </span>
              <p>{formatDate(latestAmmonia.created_at)}</p>
            </div>
          ) : (
            <div className="overview-empty">
              <Camera size={24} />
              <strong>No ammonia result yet</strong>
              <span>
                ESP32-CAM or mobile ammonia check results will appear here.
              </span>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
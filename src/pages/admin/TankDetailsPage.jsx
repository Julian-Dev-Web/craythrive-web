import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Camera,
  Droplets,
  FlaskConical,
  Loader2,
  RefreshCw,
  Settings2,
  Thermometer,
  Waves,
  Zap,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const tankTableNames = ["tanks", "user_tanks", "tank_profiles"];
const readingTableNames = ["sensor_readings", "tank_readings", "readings"];
const ammoniaTableNames = ["ammonia_readings", "ammonia_results"];
const alertTableNames = ["alerts", "notifications", "tank_alerts"];
const controlLogTableNames = ["control_logs", "tank_control_logs", "device_logs"];

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
];

const tankIdColumns = ["tank_id", "tankId", "tank", "id"];

function clean(value) {
  return String(value || "").trim();
}

function formatDate(value) {
  if (!value) return "No date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getTankId(tank) {
  return tank?.id || tank?.tank_id || tank?.uuid || tank?.tankId || "";
}

function getTankName(tank) {
  return (
    tank?.name ||
    tank?.tank_name ||
    tank?.title ||
    tank?.label ||
    tank?.tank_label ||
    "Unnamed Tank"
  );
}

function getTankType(tank) {
  return (
    tank?.type ||
    tank?.tank_type ||
    tank?.stage ||
    tank?.tank_stage ||
    tank?.category ||
    "General"
  );
}

function getTankCount(tank) {
  return (
    tank?.crayfish_count ||
    tank?.stock_count ||
    tank?.quantity ||
    tank?.count ||
    tank?.total_crayfish ||
    "N/A"
  );
}

function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined) return row[key];
  }

  return null;
}

function getStatus(row) {
  return clean(row?.status || row?.condition || row?.severity || "normal").toLowerCase();
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
    "New alert from this tank."
  );
}

function getControlAction(log) {
  return (
    log?.action_type ||
    log?.action ||
    log?.control_type ||
    log?.command ||
    "Control Action"
  );
}

function getControlStatus(log) {
  return log?.action_status || log?.status || log?.result || "Recorded";
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

async function findTankById(tankId, userId) {
  for (const tableName of tankTableNames) {
    for (const userColumn of userFilterColumns) {
      const byId = await supabase
        .from(tableName)
        .select("*")
        .eq("id", tankId)
        .eq(userColumn, userId)
        .maybeSingle();

      if (!byId.error && byId.data) return byId.data;

      const byTankId = await supabase
        .from(tableName)
        .select("*")
        .eq("tank_id", tankId)
        .eq(userColumn, userId)
        .maybeSingle();

      if (!byTankId.error && byTankId.data) return byTankId.data;
    }
  }

  return null;
}

async function fetchRowsByTank(tableNames, tankId, userId, limit = 8) {
  for (const tableName of tableNames) {
    for (const tankColumn of tankIdColumns) {
      for (const userColumn of userFilterColumns) {
        const withDate = await supabase
          .from(tableName)
          .select("*")
          .eq(tankColumn, tankId)
          .eq(userColumn, userId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (!withDate.error && Array.isArray(withDate.data)) {
          return {
            rows: withDate.data,
            tableUsed: tableName,
          };
        }

        const withoutDate = await supabase
          .from(tableName)
          .select("*")
          .eq(tankColumn, tankId)
          .eq(userColumn, userId)
          .limit(limit);

        if (!withoutDate.error && Array.isArray(withoutDate.data)) {
          return {
            rows: withoutDate.data,
            tableUsed: tableName,
          };
        }
      }
    }
  }

  return {
    rows: [],
    tableUsed: tableNames[0],
  };
}

export default function TankDetailsPage() {
  const { tankId } = useParams();

  const [tank, setTank] = useState(null);
  const [readings, setReadings] = useState([]);
  const [ammoniaReadings, setAmmoniaReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [controlLogs, setControlLogs] = useState([]);
  const [sources, setSources] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const latestReading = readings[0] || {};
  const latestAmmonia = ammoniaReadings[0] || {};

  const summaryCards = useMemo(
    () => [
      {
        label: "Temperature",
        value:
          getValue(latestReading, ["temperature", "temp", "water_temperature"]) !==
          null
            ? `${getValue(latestReading, [
                "temperature",
                "temp",
                "water_temperature",
              ])}°C`
            : "N/A",
        icon: Thermometer,
      },
      {
        label: "pH Level",
        value: getValue(latestReading, ["ph", "pH", "ph_level"]) || "N/A",
        icon: FlaskConical,
      },
      {
        label: "Turbidity",
        value:
          getValue(latestReading, ["turbidity", "turbidity_level", "ntu"]) ||
          "N/A",
        icon: Waves,
      },
      {
        label: "Water Level",
        value:
          getValue(latestReading, ["water_level", "level", "water_height"]) ||
          "N/A",
        icon: Droplets,
      },
    ],
    [latestReading]
  );

  const ammoniaValue =
    getValue(latestAmmonia, [
      "ammonia_level",
      "ammonia",
      "nh3",
      "result",
      "value",
    ]) || "No record";

  const loadTankDetails = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      if (!currentUser.id || !tankId) {
        setTank(null);
        return;
      }

      const foundTank = await findTankById(tankId, currentUser.id);

      const [readingResult, ammoniaResult, alertResult, controlResult] =
        await Promise.all([
          fetchRowsByTank(readingTableNames, tankId, currentUser.id, 10),
          fetchRowsByTank(ammoniaTableNames, tankId, currentUser.id, 8),
          fetchRowsByTank(alertTableNames, tankId, currentUser.id, 8),
          fetchRowsByTank(controlLogTableNames, tankId, currentUser.id, 8),
        ]);

      setTank(foundTank);
      setReadings(readingResult.rows);
      setAmmoniaReadings(ammoniaResult.rows);
      setAlerts(alertResult.rows);
      setControlLogs(controlResult.rows);
      setSources({
        readings: readingResult.tableUsed,
        ammonia: ammoniaResult.tableUsed,
        alerts: alertResult.tableUsed,
        controls: controlResult.tableUsed,
      });
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Tank details loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTankDetails();
  }, [tankId]);

  if (isLoading) {
    return (
      <section className="tank-details-empty">
        <Loader2 className="spin-icon" size={30} />
        <h3>Loading tank details...</h3>
        <p>Please wait while CrayThrive loads this tank record.</p>
      </section>
    );
  }

  if (!tank) {
    return (
      <section className="tank-details-empty">
        <AlertTriangle size={34} />
        <h3>Tank not found</h3>
        <p>
          This tank may not exist, may not belong to this account, or the mobile
          app uses a different tank identifier.
        </p>
        <Link to="/admin/tanks" className="tank-details-back-button">
          <ArrowLeft size={18} />
          Back to tanks
        </Link>
      </section>
    );
  }

  return (
    <div className="tank-details-page">
      <section className="tank-details-hero">
        <div>
          <Link to="/admin/tanks" className="tank-details-back-link">
            <ArrowLeft size={18} />
            Back to tanks
          </Link>

          <p className="dashboard-eyebrow">Tank Details</p>
          <h2>{getTankName(tank)}</h2>

          <div className="tank-details-meta">
            <span>{getTankType(tank)}</span>
            <span>ID: {getTankId(tank)}</span>
            <span>Count: {getTankCount(tank)}</span>
          </div>

          <p>
            Full monitoring view for this tank, including recent sensor
            readings, ammonia results, alerts, and control activity.
          </p>

          <div className="tanks-header-actions">
            <button
              className="dashboard-primary-button"
              onClick={loadTankDetails}
            >
              <RefreshCw size={18} />
              Refresh Details
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : "Waiting for sync"}
            </span>
          </div>
        </div>

        <div className="tank-details-status-card">
          <strong>{getStatus(latestReading)}</strong>
          <span>Latest condition</span>
          <p>{formatDate(latestReading.created_at || tank.updated_at)}</p>
        </div>
      </section>

      <section className="tank-detail-stat-grid">
        {summaryCards.map((item) => {
          const Icon = item.icon;

          return (
            <article className="tank-detail-stat-card" key={item.label}>
              <span>
                <Icon size={22} />
              </span>
              <strong>{item.value}</strong>
              <p>{item.label}</p>
            </article>
          );
        })}
      </section>

      <section className="tank-detail-main-grid">
        <article className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <p className="dashboard-eyebrow">Sensor History</p>
              <h3>Latest readings</h3>
            </div>
            <Activity size={22} />
          </div>

          <div className="tank-table-list">
            {readings.length === 0 ? (
              <div className="tank-mini-empty">
                No sensor readings yet. Source: {sources.readings}
              </div>
            ) : (
              readings.map((reading, index) => (
                <div className="tank-table-row" key={reading.id || index}>
                  <div>
                    <strong>{formatDate(reading.created_at)}</strong>
                    <span>{getStatus(reading)}</span>
                  </div>
                  <div>
                    <span>
                      Temp:{" "}
                      {getValue(reading, [
                        "temperature",
                        "temp",
                        "water_temperature",
                      ]) || "N/A"}
                    </span>
                    <span>
                      pH: {getValue(reading, ["ph", "pH", "ph_level"]) || "N/A"}
                    </span>
                    <span>
                      Turbidity:{" "}
                      {getValue(reading, [
                        "turbidity",
                        "turbidity_level",
                        "ntu",
                      ]) || "N/A"}
                    </span>
                    <span>
                      Level:{" "}
                      {getValue(reading, [
                        "water_level",
                        "level",
                        "water_height",
                      ]) || "N/A"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <p className="dashboard-eyebrow">Ammonia</p>
              <h3>Camera readings</h3>
            </div>
            <Camera size={22} />
          </div>

          <div className="tank-ammonia-focus">
            <strong>{ammoniaValue}</strong>
            <span>
              {latestAmmonia.status ||
                latestAmmonia.condition ||
                latestAmmonia.chart_label ||
                "Latest result"}
            </span>
            <p>{formatDate(latestAmmonia.created_at)}</p>
          </div>

          <div className="tank-table-list compact">
            {ammoniaReadings.length === 0 ? (
              <div className="tank-mini-empty">
                No ammonia readings yet. Source: {sources.ammonia}
              </div>
            ) : (
              ammoniaReadings.slice(0, 5).map((row, index) => (
                <div className="tank-small-row" key={row.id || index}>
                  <span>{formatDate(row.created_at)}</span>
                  <strong>
                    {getValue(row, [
                      "ammonia_level",
                      "ammonia",
                      "nh3",
                      "result",
                      "value",
                    ]) || "Recorded"}
                  </strong>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <p className="dashboard-eyebrow">Alerts</p>
              <h3>Recent alerts</h3>
            </div>
            <AlertTriangle size={22} />
          </div>

          <div className="tank-table-list">
            {alerts.length === 0 ? (
              <div className="tank-mini-empty">
                No alerts for this tank. Source: {sources.alerts}
              </div>
            ) : (
              alerts.map((alert, index) => (
                <div className="tank-alert-row" key={alert.id || index}>
                  <span className={`overview-dot severity-${getStatus(alert)}`} />
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
              <p className="dashboard-eyebrow">Controls</p>
              <h3>Control logs</h3>
            </div>
            <Settings2 size={22} />
          </div>

          <div className="tank-table-list">
            {controlLogs.length === 0 ? (
              <div className="tank-mini-empty">
                No control logs yet. Source: {sources.controls}
              </div>
            ) : (
              controlLogs.map((log, index) => (
                <div className="tank-control-row" key={log.id || index}>
                  <span>
                    <Zap size={18} />
                  </span>
                  <div>
                    <strong>{getControlAction(log)}</strong>
                    <p>{getControlStatus(log)}</p>
                    <small>{formatDate(log.created_at)}</small>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
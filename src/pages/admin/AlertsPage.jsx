import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Droplets,
  Eye,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const alertTableNames = ["alerts", "notifications", "tank_alerts"];
const tankTableNames = ["tanks", "user_tanks", "tank_profiles"];

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
];

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
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

function getAlertId(alert, index) {
  return alert?.id || alert?.alert_id || alert?.notification_id || `alert-${index}`;
}

function getAlertTankId(alert) {
  return alert?.tank_id || alert?.tankId || alert?.tank || "";
}

function getAlertTitle(alert) {
  return (
    alert?.title ||
    alert?.alert_title ||
    alert?.notification_title ||
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
    alert?.content ||
    "New notification from your CrayThrive account."
  );
}

function getAlertType(alert) {
  return (
    alert?.type ||
    alert?.alert_type ||
    alert?.notification_type ||
    alert?.category ||
    "general"
  );
}

function getAlertSeverity(alert) {
  const raw = lower(alert?.severity || alert?.level || alert?.priority || alert?.status);

  if (raw.includes("critical") || raw.includes("danger") || raw.includes("high")) {
    return "critical";
  }

  if (raw.includes("warn") || raw.includes("medium")) {
    return "warning";
  }

  if (raw.includes("resolved")) return "resolved";
  if (raw.includes("success") || raw.includes("normal") || raw.includes("info")) {
    return "info";
  }

  return "info";
}

function getAlertStatus(alert) {
  const raw = lower(alert?.status || alert?.alert_status || "");

  if (raw.includes("resolved")) return "resolved";
  if (raw.includes("archive")) return "archived";
  if (raw.includes("read")) return "read";

  const isRead =
    alert?.is_read === true ||
    alert?.read === true ||
    alert?.seen === true ||
    alert?.viewed === true;

  return isRead ? "read" : "unread";
}

function getAlertTankName(alert, tankMap) {
  const tankId = getAlertTankId(alert);

  return (
    alert?.tank_name ||
    alert?.tank_label ||
    tankMap[tankId]?.name ||
    tankId ||
    "No linked tank"
  );
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

async function fetchUserRows(tableNames, userId, limit = 250) {
  for (const tableName of tableNames) {
    for (const userColumn of userFilterColumns) {
      const ordered = await supabase
        .from(tableName)
        .select("*")
        .eq(userColumn, userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!ordered.error && Array.isArray(ordered.data)) {
        return {
          rows: ordered.data,
          tableUsed: tableName,
          userColumnUsed: userColumn,
        };
      }

      const plain = await supabase
        .from(tableName)
        .select("*")
        .eq(userColumn, userId)
        .limit(limit);

      if (!plain.error && Array.isArray(plain.data)) {
        return {
          rows: plain.data,
          tableUsed: tableName,
          userColumnUsed: userColumn,
        };
      }
    }
  }

  return {
    rows: [],
    tableUsed: tableNames[0],
    userColumnUsed: "",
  };
}

async function tryUpdateAlert(tableName, alert, payloads) {
  const id = alert?.id || alert?.alert_id || alert?.notification_id;

  if (!tableName || !id) return false;

  for (const payload of payloads) {
    const { error } = await supabase.from(tableName).update(payload).eq("id", id);

    if (!error) return true;
  }

  return false;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [tableUsed, setTableUsed] = useState("alerts");
  const [searchTerm, setSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tankFilter, setTankFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadAlerts = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      if (!currentUser.id) {
        setAlerts([]);
        setTanks([]);
        return;
      }

      const [alertResult, tankResult] = await Promise.all([
        fetchUserRows(alertTableNames, currentUser.id, 300),
        fetchUserRows(tankTableNames, currentUser.id, 120),
      ]);

      const sortedAlerts = [...alertResult.rows].sort((a, b) => {
        const aDate = new Date(a.created_at || a.updated_at || 0).getTime();
        const bDate = new Date(b.created_at || b.updated_at || 0).getTime();
        return bDate - aDate;
      });

      setAlerts(sortedAlerts);
      setTanks(tankResult.rows);
      setTableUsed(alertResult.tableUsed);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Alerts loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  const tankMap = useMemo(() => {
    const map = {};

    tanks.forEach((tank) => {
      const id = getTankId(tank);

      if (id) {
        map[id] = {
          id,
          name: getTankName(tank),
        };
      }
    });

    return map;
  }, [tanks]);

  const typeOptions = useMemo(() => {
    const unique = new Set();

    alerts.forEach((alert) => {
      unique.add(getAlertType(alert));
    });

    return Array.from(unique).filter(Boolean);
  }, [alerts]);

  const tankOptions = useMemo(() => {
    const map = new Map();

    tanks.forEach((tank) => {
      const id = getTankId(tank);
      if (id) map.set(id, getTankName(tank));
    });

    alerts.forEach((alert) => {
      const id = getAlertTankId(alert);
      if (id && !map.has(id)) map.set(id, id);
    });

    return Array.from(map.entries()).map(([id, name]) => ({
      id,
      name,
    }));
  }, [alerts, tanks]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      const search = lower(searchTerm);
      const title = lower(getAlertTitle(alert));
      const message = lower(getAlertMessage(alert));
      const type = lower(getAlertType(alert));
      const severity = getAlertSeverity(alert);
      const status = getAlertStatus(alert);
      const tankId = getAlertTankId(alert);
      const tankName = lower(getAlertTankName(alert, tankMap));

      const matchesSearch =
        !search ||
        title.includes(search) ||
        message.includes(search) ||
        type.includes(search) ||
        tankName.includes(search) ||
        lower(tankId).includes(search);

      const matchesSeverity =
        severityFilter === "all" || severity === severityFilter;

      const matchesType = typeFilter === "all" || type === lower(typeFilter);

      const matchesStatus =
        statusFilter === "all" || status === statusFilter;

      const matchesTank = tankFilter === "all" || tankId === tankFilter;

      return (
        matchesSearch &&
        matchesSeverity &&
        matchesType &&
        matchesStatus &&
        matchesTank
      );
    });
  }, [
    alerts,
    tankMap,
    searchTerm,
    severityFilter,
    typeFilter,
    statusFilter,
    tankFilter,
  ]);

  const stats = useMemo(() => {
    return alerts.reduce(
      (acc, alert) => {
        const severity = getAlertSeverity(alert);
        const status = getAlertStatus(alert);

        acc.total += 1;
        acc[severity] = (acc[severity] || 0) + 1;

        if (status === "unread") acc.unread += 1;
        if (status === "resolved") acc.resolved += 1;

        return acc;
      },
      {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
        unread: 0,
        resolved: 0,
      }
    );
  }, [alerts]);

  const handleMarkRead = async (alert) => {
    await tryUpdateAlert(tableUsed, alert, [
      { is_read: true },
      { read: true },
      { seen: true },
      { viewed: true },
      { status: "read" },
    ]);

    setAlerts((current) =>
      current.map((item) =>
        getAlertId(item, 0) === getAlertId(alert, 0)
          ? { ...item, is_read: true, status: item.status || "read" }
          : item
      )
    );
  };

  const handleResolve = async (alert) => {
    await tryUpdateAlert(tableUsed, alert, [
      { status: "resolved" },
      { alert_status: "resolved" },
      { resolved_at: new Date().toISOString() },
    ]);

    setAlerts((current) =>
      current.map((item) =>
        getAlertId(item, 0) === getAlertId(alert, 0)
          ? { ...item, status: "resolved" }
          : item
      )
    );
  };

  return (
    <div className="alerts-page">
      <section className="alerts-header-card">
        <div>
          <p className="dashboard-eyebrow">System Notifications</p>
          <h2>Alerts</h2>
          <p>
            Review tank warnings, ammonia alerts, feeding reminders, pump
            activity, and marketplace notifications connected to your
            CrayThrive mobile account.
          </p>

          <div className="alerts-header-actions">
            <button className="dashboard-primary-button" onClick={loadAlerts}>
              {isLoading ? (
                <Loader2 className="spin-icon" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
              Refresh Alerts
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : `Source table: ${tableUsed}`}
            </span>
          </div>
        </div>
      </section>

      <section className="alerts-summary-grid">
        <article className="alerts-summary-card">
          <span>
            <Bell size={22} />
          </span>
          <strong>{stats.total}</strong>
          <p>Total alerts</p>
        </article>

        <article className="alerts-summary-card">
          <span>
            <ShieldAlert size={22} />
          </span>
          <strong>{stats.critical || 0}</strong>
          <p>Critical</p>
        </article>

        <article className="alerts-summary-card">
          <span>
            <AlertTriangle size={22} />
          </span>
          <strong>{stats.warning || 0}</strong>
          <p>Warning</p>
        </article>

        <article className="alerts-summary-card">
          <span>
            <Clock3 size={22} />
          </span>
          <strong>{stats.unread || 0}</strong>
          <p>Unread</p>
        </article>
      </section>

      <section className="alerts-toolbar">
        <label className="alerts-search-box">
          <Search size={18} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search alert title, type, tank, message..."
          />
        </label>

        <label className="alerts-filter">
          <Filter size={18} />
          <select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
          >
            <option value="all">All severity</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>

        <label className="alerts-filter">
          <Bell size={18} />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All types</option>
            {typeOptions.map((type) => (
              <option value={type} key={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="alerts-filter">
          <Eye size={18} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All status</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
            <option value="resolved">Resolved</option>
            <option value="archived">Archived</option>
          </select>
        </label>

        <label className="alerts-filter">
          <Droplets size={18} />
          <select
            value={tankFilter}
            onChange={(event) => setTankFilter(event.target.value)}
          >
            <option value="all">All tanks</option>
            {tankOptions.map((tank) => (
              <option value={tank.id} key={tank.id}>
                {tank.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {isLoading ? (
        <section className="alerts-empty-state">
          <Loader2 className="spin-icon" size={30} />
          <h3>Loading alerts...</h3>
          <p>Please wait while CrayThrive checks your alerts.</p>
        </section>
      ) : filteredAlerts.length === 0 ? (
        <section className="alerts-empty-state">
          <CheckCircle2 size={34} />
          <h3>No alerts found</h3>
          <p>
            No alerts matched your filters. Tank alerts and marketplace
            notifications will appear here once synced.
          </p>
        </section>
      ) : (
        <section className="alerts-list-card">
          <div className="alerts-list-header">
            <div>
              <p className="dashboard-eyebrow">Alert History</p>
              <h3>Latest alerts</h3>
            </div>

            <span>{filteredAlerts.length} result(s)</span>
          </div>

          <div className="alerts-list">
            {filteredAlerts.map((alert, index) => {
              const severity = getAlertSeverity(alert);
              const status = getAlertStatus(alert);

              return (
                <article className="alert-row-card" key={getAlertId(alert, index)}>
                  <span className={`alert-severity-dot ${severity}`} />

                  <div className="alert-row-content">
                    <div className="alert-row-top">
                      <div>
                        <span className={`alert-severity-pill ${severity}`}>
                          {severity}
                        </span>
                        <span className={`alert-status-pill ${status}`}>
                          {status}
                        </span>
                      </div>

                      <small>{formatDate(alert.created_at || alert.updated_at)}</small>
                    </div>

                    <h3>{getAlertTitle(alert)}</h3>
                    <p>{getAlertMessage(alert)}</p>

                    <div className="alert-meta-row">
                      <span>Type: {getAlertType(alert)}</span>
                      <span>Tank: {getAlertTankName(alert, tankMap)}</span>
                    </div>

                    <div className="alert-actions">
                      <button type="button" onClick={() => handleMarkRead(alert)}>
                        Mark as read
                      </button>

                      <button
                        type="button"
                        className="resolve"
                        onClick={() => handleResolve(alert)}
                      >
                        Mark resolved
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}   
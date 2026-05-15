import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Database,
  Droplets,
  Filter,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Siren,
  Waves,
  XCircle,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const alertTables = ["alerts", "notifications", "tank_alerts"];

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "recipient_id",
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

function getValue(row, keys, fallback = "N/A") {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "") {
      return row[key];
    }
  }

  return fallback;
}

function getAlertTitle(row, index) {
  return (
    row?.title ||
    row?.alert_title ||
    row?.notification_title ||
    row?.type ||
    row?.alert_type ||
    `Alert ${index + 1}`
  );
}

function getAlertMessage(row) {
  return (
    row?.message ||
    row?.description ||
    row?.body ||
    row?.alert_message ||
    row?.notification_message ||
    "No alert message provided."
  );
}

function getAlertSeverity(row) {
  const raw = lower(row?.severity || row?.status || row?.priority || row?.level);

  if (raw.includes("critical") || raw.includes("danger") || raw.includes("high")) {
    return "critical";
  }

  if (raw.includes("warning") || raw.includes("medium") || raw.includes("dirty")) {
    return "warning";
  }

  if (raw.includes("low") || raw.includes("info")) {
    return "info";
  }

  if (raw.includes("resolved") || raw.includes("safe") || raw.includes("normal")) {
    return "normal";
  }

  return raw || "info";
}

function getAlertStatus(row) {
  const raw = lower(row?.status || row?.alert_status || row?.read_status);

  if (raw.includes("resolved") || raw.includes("done") || raw.includes("read")) {
    return "resolved";
  }

  if (raw.includes("critical") || raw.includes("danger")) return "open";
  if (raw.includes("warning")) return "open";
  if (raw.includes("open") || raw.includes("unread") || raw.includes("active")) {
    return "open";
  }

  return raw || "open";
}

function getAlertCategory(row) {
  const raw = lower(
    row?.category ||
      row?.type ||
      row?.alert_type ||
      row?.sensor_type ||
      row?.notification_type
  );

  if (raw.includes("temp")) return "temperature";
  if (raw.includes("ph")) return "ph";
  if (raw.includes("turb")) return "turbidity";
  if (raw.includes("water") || raw.includes("level")) return "water_level";
  if (raw.includes("ammonia")) return "ammonia";
  if (raw.includes("market") || raw.includes("order")) return "marketplace";

  return raw || "general";
}

function getCategoryIcon(category) {
  if (category === "temperature") return Gauge;
  if (category === "ph") return Droplets;
  if (category === "turbidity") return Waves;
  if (category === "water_level") return Droplets;
  if (category === "ammonia") return AlertTriangle;
  if (category === "marketplace") return Bell;

  return Siren;
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id =
      row?.id ||
      row?.uuid ||
      row?.alert_id ||
      row?.notification_id ||
      row?.created_at ||
      `row-${index}`;

    map.set(id, row);
  });

  return Array.from(map.values());
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

async function fetchRows(tableNames, userId, limit = 220) {
  for (const tableName of tableNames) {
    const mergedRows = [];
    let successful = false;

    for (const column of userFilterColumns) {
      const ordered = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!ordered.error && Array.isArray(ordered.data)) {
        successful = true;
        mergedRows.push(...ordered.data);
        continue;
      }

      const plain = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .limit(limit);

      if (!plain.error && Array.isArray(plain.data)) {
        successful = true;
        mergedRows.push(...plain.data);
      }
    }

    if (successful) {
      return {
        rows: uniqueRows(mergedRows),
        tableUsed: tableName,
      };
    }
  }

  return {
    rows: [],
    tableUsed: tableNames[0],
  };
}

function SummaryCard({ icon: Icon, label, value, helper, tone = "default" }) {
  return (
    <article className={`modern-alert-summary-card ${tone}`}>
      <span>
        <Icon size={22} />
      </span>

      <div>
        <strong>{value}</strong>
        <p>{label}</p>
        <small>{helper}</small>
      </div>
    </article>
  );
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [source, setSource] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

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
        return;
      }

      const result = await fetchRows(alertTables, currentUser.id);

      setAlerts(result.rows);
      setSource(result.tableUsed);
    } catch (error) {
      console.error("Alerts loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  const enrichedAlerts = useMemo(() => {
    return alerts.map((alert, index) => {
      const severity = getAlertSeverity(alert);
      const status = getAlertStatus(alert);
      const category = getAlertCategory(alert);
      const title = getAlertTitle(alert, index);
      const message = getAlertMessage(alert);
      const date = alert?.created_at || alert?.updated_at || alert?.timestamp || alert?.date;

      return {
        alert,
        index,
        severity,
        status,
        category,
        title,
        message,
        date,
      };
    });
  }, [alerts]);

  const categories = useMemo(() => {
    return Array.from(new Set(enrichedAlerts.map((item) => item.category))).filter(Boolean);
  }, [enrichedAlerts]);

  const filteredAlerts = useMemo(() => {
    return enrichedAlerts.filter((item) => {
      const search = searchTerm.trim().toLowerCase();

      const matchesSearch =
        !search ||
        item.title.toLowerCase().includes(search) ||
        item.message.toLowerCase().includes(search) ||
        item.severity.toLowerCase().includes(search) ||
        item.category.toLowerCase().includes(search);

      const matchesSeverity =
        severityFilter === "all" || item.severity === severityFilter;

      const matchesCategory =
        categoryFilter === "all" || item.category === categoryFilter;

      return matchesSearch && matchesSeverity && matchesCategory;
    });
  }, [enrichedAlerts, searchTerm, severityFilter, categoryFilter]);

  const summary = useMemo(() => {
    const critical = enrichedAlerts.filter((item) => item.severity === "critical").length;
    const warning = enrichedAlerts.filter((item) => item.severity === "warning").length;
    const resolved = enrichedAlerts.filter((item) => item.status === "resolved").length;
    const open = enrichedAlerts.filter((item) => item.status !== "resolved").length;

    return {
      total: enrichedAlerts.length,
      critical,
      warning,
      resolved,
      open,
    };
  }, [enrichedAlerts]);

  const latestCritical = useMemo(() => {
    return enrichedAlerts.find((item) => item.severity === "critical") || null;
  }, [enrichedAlerts]);

  if (isLoading) {
    return (
      <section className="modern-alert-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading alerts...</h3>
        <p>CrayThrive is syncing warning and notification records.</p>
      </section>
    );
  }

  return (
    <div className="modern-alerts-page">
      <section className="modern-alerts-hero">
        <div>
          <p className="dashboard-eyebrow">Alerts Center</p>
          <h2>Review water risks before they become problems.</h2>
          <p>
            Monitor critical warnings, sensor alerts, ammonia concerns, and
            marketplace notifications from your CrayThrive account.
          </p>

          <div className="modern-alert-actions">
            <button className="dashboard-primary-button" onClick={loadAlerts}>
              <RefreshCw size={18} />
              Refresh Alerts
            </button>

            <span>Source: {source || "alerts"}</span>
          </div>
        </div>

        <div className={`modern-alert-hero-card ${summary.critical > 0 ? "danger" : ""}`}>
          {summary.critical > 0 ? <Siren size={38} /> : <ShieldCheck size={38} />}
          <strong>{summary.critical > 0 ? summary.critical : summary.open}</strong>
          <span>
            {summary.critical > 0 ? "Critical alert(s)" : "Open alert(s)"}
          </span>
        </div>
      </section>

      <section className="modern-alert-summary-grid">
        <SummaryCard
          icon={Bell}
          label="Total Alerts"
          value={summary.total}
          helper="All synced alert records"
        />

        <SummaryCard
          icon={Siren}
          label="Critical"
          value={summary.critical}
          helper="Needs immediate attention"
          tone="danger"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Warnings"
          value={summary.warning}
          helper="Needs monitoring"
          tone="warning"
        />

        <SummaryCard
          icon={Clock3}
          label="Open"
          value={summary.open}
          helper="Not yet resolved"
        />

        <SummaryCard
          icon={CheckCircle2}
          label="Resolved"
          value={summary.resolved}
          helper="Already handled"
          tone="success"
        />
      </section>

      <section className="modern-alert-grid">
        <article className="modern-alert-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Priority Alert</p>
              <h3>Most important item</h3>
            </div>
            <Siren size={22} />
          </div>

          {latestCritical ? (
            <div className="modern-priority-alert">
              <b className={`modern-alert-severity ${latestCritical.severity}`}>
                {latestCritical.severity}
              </b>

              <strong>{latestCritical.title}</strong>
              <p>{latestCritical.message}</p>

              <span>{formatDate(latestCritical.date)}</span>
            </div>
          ) : (
            <div className="modern-alert-empty-small">
              <ShieldCheck size={30} />
              <strong>No critical alert</strong>
              <span>Your system has no critical alert records right now.</span>
            </div>
          )}
        </article>

        <article className="modern-alert-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Category Count</p>
              <h3>Alert sources</h3>
            </div>
            <Database size={22} />
          </div>

          <div className="modern-alert-category-list">
            {categories.length === 0 ? (
              <div className="modern-alert-empty-small">
                <Bell size={30} />
                <strong>No category data</strong>
                <span>Alert categories will appear once records are synced.</span>
              </div>
            ) : (
              categories.map((category) => {
                const Icon = getCategoryIcon(category);
                const count = enrichedAlerts.filter(
                  (item) => item.category === category
                ).length;

                return (
                  <div className="modern-alert-category-row" key={category}>
                    <span>
                      <Icon size={18} />
                    </span>

                    <div>
                      <strong>{category.replace("_", " ")}</strong>
                      <small>{count} alert(s)</small>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </section>

      <section className="modern-alert-toolbar">
        <div className="modern-alert-search">
          <Search size={18} />
          <input
            placeholder="Search alert title, message, category, or severity..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <label className="modern-alert-filter">
          <Filter size={18} />
          <select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
          >
            <option value="all">All Severity</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
            <option value="normal">Normal</option>
          </select>
        </label>

        <label className="modern-alert-filter">
          <Database size={18} />
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All Categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </section>

      {filteredAlerts.length === 0 ? (
        <section className="modern-alert-empty">
          <Bell size={34} />
          <h3>No alerts found</h3>
          <p>
            No alert records matched your filters. Sensor and system warnings
            will appear here once synced.
          </p>
        </section>
      ) : (
        <section className="modern-alert-list">
          {filteredAlerts.map((item) => {
            const Icon = getCategoryIcon(item.category);

            return (
              <article className="modern-alert-card" key={item.alert?.id || item.index}>
                <div className={`modern-alert-icon ${item.severity}`}>
                  <Icon size={22} />
                </div>

                <div className="modern-alert-content">
                  <div className="modern-alert-card-top">
                    <div>
                      <strong>{item.title}</strong>
                      <span>{formatDate(item.date)}</span>
                    </div>

                    <div className="modern-alert-chip-row">
                      <b className={`modern-alert-severity ${item.severity}`}>
                        {item.severity}
                      </b>

                      <small className={`modern-alert-status ${item.status}`}>
                        {item.status}
                      </small>
                    </div>
                  </div>

                  <p>{item.message}</p>

                  <div className="modern-alert-meta">
                    <span>Category: {item.category.replace("_", " ")}</span>
                    <span>Tank: {getValue(item.alert, ["tank_name", "tank_id"], "N/A")}</span>
                    <span>
                      Value: {getValue(item.alert, ["value", "reading_value", "sensor_value"], "N/A")}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
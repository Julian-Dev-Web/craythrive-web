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
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const alertTables = ["alerts", "notifications", "tank_alerts"];

const ALERTS_PER_PAGE = 10;

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "recipient_id",
  "farmer_id",
];

const categoryOptions = [
  { value: "all", label: "All Categories" },
  { value: "temperature", label: "Temperature" },
  { value: "ph", label: "pH" },
  { value: "turbidity", label: "Turbidity" },
  { value: "water_level", label: "Water Level" },
  { value: "ammonia", label: "Ammonia" },
  { value: "marketplace", label: "Marketplace" },
  { value: "general", label: "General" },
];

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function normalizeText(value) {
  return lower(value).replaceAll("_", " ").replaceAll("-", " ");
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
  const raw = normalizeText(
    row?.severity ||
      row?.priority ||
      row?.level ||
      row?.status ||
      row?.alert_status ||
      row?.type ||
      ""
  );

  if (
    raw.includes("critical") ||
    raw.includes("danger") ||
    raw.includes("high") ||
    raw.includes("unsafe")
  ) {
    return "critical";
  }

  if (
    raw.includes("warning") ||
    raw.includes("medium") ||
    raw.includes("dirty") ||
    raw.includes("low")
  ) {
    return "warning";
  }

  if (
    raw.includes("resolved") ||
    raw.includes("normal") ||
    raw.includes("safe") ||
    raw.includes("read") ||
    raw.includes("done")
  ) {
    return "normal";
  }

  return "info";
}

function getAlertStatus(row) {
  const raw = normalizeText(
    row?.status ||
      row?.alert_status ||
      row?.read_status ||
      row?.notification_status ||
      ""
  );

  if (
    row?.is_read === true ||
    row?.resolved_at ||
    raw.includes("resolved") ||
    raw.includes("read") ||
    raw.includes("done") ||
    raw.includes("handled")
  ) {
    return "resolved";
  }

  return "open";
}

function getAlertCategory(row) {
  const raw = normalizeText(
    row?.category ||
      row?.type ||
      row?.alert_type ||
      row?.sensor_type ||
      row?.notification_type ||
      row?.title ||
      row?.message ||
      ""
  );

  if (raw.includes("temp")) return "temperature";
  if (raw.includes("ph")) return "ph";
  if (raw.includes("turb")) return "turbidity";
  if (raw.includes("water") || raw.includes("level") || raw.includes("depth")) {
    return "water_level";
  }
  if (raw.includes("ammonia")) return "ammonia";
  if (
    raw.includes("market") ||
    raw.includes("order") ||
    raw.includes("listing") ||
    raw.includes("reservation")
  ) {
    return "marketplace";
  }

  return "general";
}

function getAlertDate(row) {
  return row?.created_at || row?.updated_at || row?.timestamp || row?.date || "";
}

function getSeverityRank(severity) {
  if (severity === "critical") return 1;
  if (severity === "warning") return 2;
  if (severity === "info") return 3;
  return 4;
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

    map.set(String(id), row);
  });

  return Array.from(map.values());
}

async function getCurrentUserWithRole() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  if (!user) {
    return {
      id: "",
      email: "",
      role: "",
      isAdmin: false,
    };
  }

  let profile = null;

  const byId = await supabase
    .from("profiles")
    .select("id,email,role")
    .eq("id", user.id)
    .maybeSingle();

  if (!byId.error && byId.data) {
    profile = byId.data;
  }

  if (!profile && user.email) {
    const byEmail = await supabase
      .from("profiles")
      .select("id,email,role")
      .ilike("email", user.email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      profile = byEmail.data;
    }
  }

  const role = lower(profile?.role);

  return {
    id: user.id || "",
    email: user.email || "",
    role,
    isAdmin: role === "admin",
  };
}

async function fetchAdminRows(tableNames, limit = 500) {
  for (const tableName of tableNames) {
    const ordered = await supabase
      .from(tableName)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!ordered.error && Array.isArray(ordered.data)) {
      return {
        rows: uniqueRows(ordered.data),
        tableUsed: tableName,
      };
    }

    const plain = await supabase.from(tableName).select("*").limit(limit);

    if (!plain.error && Array.isArray(plain.data)) {
      return {
        rows: uniqueRows(plain.data),
        tableUsed: tableName,
      };
    }
  }

  return {
    rows: [],
    tableUsed: tableNames[0],
  };
}

async function fetchUserRows(tableNames, userId, limit = 300) {
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
  const [scopeLabel, setScopeLabel] = useState("User view");
  const [searchTerm, setSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [alertsPage, setAlertsPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const loadAlerts = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUserWithRole();

      if (!currentUser.id) {
        setAlerts([]);
        setScopeLabel("No session");
        return;
      }

      const result = currentUser.isAdmin
        ? await fetchAdminRows(alertTables)
        : await fetchUserRows(alertTables, currentUser.id);

      setAlerts(result.rows);
      setSource(result.tableUsed);
      setScopeLabel(
        currentUser.isAdmin ? "Admin all-records view" : "User account view"
      );
    } catch (error) {
      console.error("Alerts loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  useEffect(() => {
    setAlertsPage(1);
  }, [searchTerm, severityFilter, statusFilter, categoryFilter]);

  const enrichedAlerts = useMemo(() => {
    return alerts.map((alert, index) => {
      const severity = getAlertSeverity(alert);
      const status = getAlertStatus(alert);
      const category = getAlertCategory(alert);
      const title = getAlertTitle(alert, index);
      const message = getAlertMessage(alert);
      const date = getAlertDate(alert);

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

  const filteredAlerts = useMemo(() => {
    const filtered = enrichedAlerts.filter((item) => {
      const search = searchTerm.trim().toLowerCase();

      const searchableText = [
        item.title,
        item.message,
        item.severity,
        item.status,
        item.category,
        getValue(item.alert, ["tank_name", "tank_id"], ""),
        getValue(item.alert, ["value", "reading_value", "sensor_value"], ""),
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !search || searchableText.includes(search);

      const matchesSeverity =
        severityFilter === "all" || item.severity === severityFilter;

      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      const matchesCategory =
        categoryFilter === "all" || item.category === categoryFilter;

      return matchesSearch && matchesSeverity && matchesStatus && matchesCategory;
    });

    return filtered.sort((a, b) => {
      const openRankA = a.status === "open" ? 0 : 1;
      const openRankB = b.status === "open" ? 0 : 1;

      if (openRankA !== openRankB) return openRankA - openRankB;

      const severityDifference =
        getSeverityRank(a.severity) - getSeverityRank(b.severity);

      if (severityDifference !== 0) return severityDifference;

      return new Date(b.date || 0) - new Date(a.date || 0);
    });
  }, [enrichedAlerts, searchTerm, severityFilter, statusFilter, categoryFilter]);

  const totalAlertPages = Math.max(
    1,
    Math.ceil(filteredAlerts.length / ALERTS_PER_PAGE)
  );

  const currentAlertPage = Math.min(alertsPage, totalAlertPages);

  const paginatedAlerts = filteredAlerts.slice(
    (currentAlertPage - 1) * ALERTS_PER_PAGE,
    currentAlertPage * ALERTS_PER_PAGE
  );

  const showingStart =
    filteredAlerts.length === 0
      ? 0
      : (currentAlertPage - 1) * ALERTS_PER_PAGE + 1;

  const showingEnd = Math.min(
    currentAlertPage * ALERTS_PER_PAGE,
    filteredAlerts.length
  );

  const summary = useMemo(() => {
    const critical = enrichedAlerts.filter((item) => item.severity === "critical").length;
    const warning = enrichedAlerts.filter((item) => item.severity === "warning").length;
    const resolved = enrichedAlerts.filter((item) => item.status === "resolved").length;
    const open = enrichedAlerts.filter((item) => item.status === "open").length;

    return {
      total: enrichedAlerts.length,
      critical,
      warning,
      resolved,
      open,
    };
  }, [enrichedAlerts]);

  const categories = useMemo(() => {
    return Array.from(new Set(enrichedAlerts.map((item) => item.category))).filter(Boolean);
  }, [enrichedAlerts]);

  const latestCritical =
    enrichedAlerts.find(
      (item) => item.status === "open" && item.severity === "critical"
    ) || null;

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
            Monitor open alerts, resolved notifications, sensor warnings,
            ammonia concerns, and marketplace notices in one alert center.
          </p>

          <div className="modern-alert-actions">
            <button className="dashboard-primary-button" onClick={loadAlerts}>
              <RefreshCw size={18} />
              Refresh Alerts
            </button>

            <span>
              Source: {source || "alerts"} • {scopeLabel}
            </span>
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
          helper="Not yet resolved/read"
        />

        <SummaryCard
          icon={CheckCircle2}
          label="Resolved"
          value={summary.resolved}
          helper="Already handled/read"
          tone="success"
        />
      </section>

      <section className="modern-alert-grid">
        <article className="modern-alert-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Priority Alert</p>
              <h3>Most important open item</h3>
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
              <strong>No critical open alert</strong>
              <span>Your system has no critical open alert right now.</span>
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
            placeholder="Search alert title, message, tank, value, or status..."
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
          <Clock3 size={18} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>

        <label className="modern-alert-filter">
          <Database size={18} />
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
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
        <section className="modern-alert-list-card">
          <div className="modern-alert-list">
            {paginatedAlerts.map((item) => {
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
                      <span>
                        Tank: {getValue(item.alert, ["tank_name", "tank_id"], "N/A")}
                      </span>
                      <span>
                        Value:{" "}
                        {getValue(
                          item.alert,
                          ["value", "reading_value", "sensor_value"],
                          "N/A"
                        )}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="modern-alert-pagination">
            <span>
              Showing {showingStart}-{showingEnd} of {filteredAlerts.length}
            </span>

            <div>
              <button
                type="button"
                disabled={currentAlertPage === 1}
                onClick={() => setAlertsPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </button>

              <strong>
                Page {currentAlertPage} of {totalAlertPages}
              </strong>

              <button
                type="button"
                disabled={currentAlertPage === totalAlertPages}
                onClick={() =>
                  setAlertsPage((page) => Math.min(totalAlertPages, page + 1))
                }
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
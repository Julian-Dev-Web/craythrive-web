import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Droplets,
  Filter,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  Thermometer,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  formatReadingTime,
  normalizeSensorReading,
  toNumberOrNull,
} from "../../utils/sensorReadingUtils";

const readingTables = ["sensor_readings", "tank_readings", "readings"];

const READINGS_PER_PAGE = 10;

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
];

const sensorOptions = [
  { value: "all", label: "All Sensors" },
  { value: "temperature", label: "Temperature" },
  { value: "ph", label: "pH Status" },
  { value: "turbidity", label: "Turbidity Status" },
  { value: "water_depth", label: "Water Depth" },
  { value: "issues", label: "Issues Only" },
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

function normalizeStatusText(value) {
  return lower(value).replaceAll("_", " ").replaceAll("-", " ");
}

function getStatusSeverity(statuses) {
  const joined = statuses.map(normalizeStatusText).join(" ");

  if (
    joined.includes("critical") ||
    joined.includes("danger") ||
    joined.includes("unsafe") ||
    joined.includes("high ph") ||
    joined.includes("low ph") ||
    joined.includes("warm") ||
    joined.includes("cold")
  ) {
    return "critical";
  }

  if (
    joined.includes("warning") ||
    joined.includes("dirty") ||
    joined.includes("slightly") ||
    joined.includes("needs") ||
    joined.includes("moderate")
  ) {
    return "warning";
  }

  if (
    joined.includes("ideal") ||
    joined.includes("safe") ||
    joined.includes("normal") ||
    joined.includes("clear") ||
    joined.includes("measured")
  ) {
    return "normal";
  }

  return "normal";
}

function getSeverityRank(severity) {
  if (severity === "critical") return 1;
  if (severity === "warning") return 2;
  if (severity === "normal") return 3;
  return 4;
}

function getOverallReadingStatus(normalizedReading) {
  return getStatusSeverity([
    normalizedReading.temperatureStatus,
    normalizedReading.phStatus,
    normalizedReading.turbidityStatus,
    normalizedReading.waterStatus,
  ]);
}

function getSensorFocus(item, sensorFilter) {
  const normalized = item.normalized;

  if (sensorFilter === "temperature") {
    return {
      label: "Temperature",
      value: normalized.temperatureLabel,
      status: normalized.temperatureStatus,
      severity: getStatusSeverity([normalized.temperatureStatus]),
      hasValue:
        normalized.temperatureValue !== null &&
        normalized.temperatureValue !== undefined &&
        normalized.temperatureValue !== "",
    };
  }

  if (sensorFilter === "ph") {
    return {
      label: "pH Status",
      value: normalized.phStatus,
      status: normalized.phStatus,
      severity: getStatusSeverity([normalized.phStatus]),
      hasValue: normalized.phStatus !== "No Reading",
    };
  }

  if (sensorFilter === "turbidity") {
    return {
      label: "Turbidity Status",
      value: normalized.turbidityStatus,
      status: normalized.turbidityStatus,
      severity: getStatusSeverity([normalized.turbidityStatus]),
      hasValue: normalized.turbidityStatus !== "No Reading",
    };
  }

  if (sensorFilter === "water_depth") {
    return {
      label: "Water Depth",
      value: normalized.waterLabel,
      status: normalized.waterStatus,
      severity: getStatusSeverity([normalized.waterStatus]),
      hasValue:
        normalized.waterValue !== null &&
        normalized.waterValue !== undefined &&
        normalized.waterValue !== "",
    };
  }

  return {
    label: "Overall",
    value: item.status,
    status: item.status,
    severity: item.status,
    hasValue: true,
  };
}

function averageFromNormalized(items, key) {
  const values = items
    .map((item) => toNumberOrNull(item.normalized[key]))
    .filter((value) => value !== null);

  if (!values.length) return "N/A";

  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(2);
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id =
      row?.id ||
      row?.uuid ||
      row?.reading_id ||
      row?.created_at ||
      row?.device_uid ||
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
    <article className={`modern-reading-summary-card ${tone}`}>
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

function MetricCard({ icon: Icon, label, value, status }) {
  const severity = status ? getStatusSeverity([status]) : "normal";

  return (
    <div className="modern-reading-metric">
      <Icon size={20} />
      <strong>{value}</strong>
      <span>{label}</span>

      {status && (
        <b className={`modern-reading-status ${severity}`}>{status}</b>
      )}
    </div>
  );
}

export default function SensorReadingsPage() {
  const [readings, setReadings] = useState([]);
  const [source, setSource] = useState("");
  const [scopeLabel, setScopeLabel] = useState("User view");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sensorFilter, setSensorFilter] = useState("all");
  const [readingsPage, setReadingsPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const loadReadings = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUserWithRole();

      if (!currentUser.id) {
        setReadings([]);
        setScopeLabel("No session");
        return;
      }

      const result = currentUser.isAdmin
        ? await fetchAdminRows(readingTables)
        : await fetchUserRows(readingTables, currentUser.id);

      setReadings(result.rows);
      setSource(result.tableUsed);
      setScopeLabel(
        currentUser.isAdmin ? "Admin all-records view" : "User account view"
      );
    } catch (error) {
      console.error("Readings loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReadings();
  }, []);

  useEffect(() => {
    setReadingsPage(1);
  }, [searchTerm, statusFilter, sensorFilter]);

  const enrichedReadings = useMemo(() => {
    return readings.map((reading, index) => {
      const normalized = normalizeSensorReading(reading);
      const status = getOverallReadingStatus(normalized);

      const tankName =
        reading?.tank_name ||
        reading?.tank_label ||
        reading?.name ||
        reading?.tank_id ||
        reading?.iot_device_id ||
        normalized.deviceUid ||
        `Reading ${index + 1}`;

      const date =
        normalized.createdAt ||
        reading?.timestamp ||
        reading?.date ||
        reading?.updated_at;

      return {
        reading,
        normalized,
        index,
        status,
        tankName: String(tankName),
        date,
      };
    });
  }, [readings]);

  const filteredReadings = useMemo(() => {
    const filtered = enrichedReadings.filter((item) => {
      const search = searchTerm.trim().toLowerCase();
      const normalized = item.normalized;
      const focus = getSensorFocus(item, sensorFilter);

      const searchableText = [
        item.tankName,
        item.status,
        focus.label,
        focus.value,
        focus.status,
        normalized.temperatureLabel,
        normalized.temperatureStatus,
        normalized.phLabel,
        normalized.phStatus,
        normalized.phNumberLabel,
        normalized.turbidityLabel,
        normalized.turbidityStatus,
        normalized.turbidityNumberLabel,
        normalized.waterLabel,
        normalized.waterStatus,
        normalized.deviceUid,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !search || searchableText.includes(search);

      const selectedSeverity =
        sensorFilter === "all" || sensorFilter === "issues"
          ? item.status
          : focus.severity;

      const matchesStatus =
        statusFilter === "all" || selectedSeverity === statusFilter;

      const matchesSensor =
        sensorFilter === "all" ||
        (sensorFilter === "issues" &&
          ["warning", "critical"].includes(item.status)) ||
        focus.hasValue;

      return matchesSearch && matchesStatus && matchesSensor;
    });

    return filtered.sort((a, b) => {
      const focusA = getSensorFocus(a, sensorFilter);
      const focusB = getSensorFocus(b, sensorFilter);

      const severityA =
        sensorFilter === "all" || sensorFilter === "issues"
          ? a.status
          : focusA.severity;

      const severityB =
        sensorFilter === "all" || sensorFilter === "issues"
          ? b.status
          : focusB.severity;

      const rankDifference =
        getSeverityRank(severityA) - getSeverityRank(severityB);

      if (rankDifference !== 0) return rankDifference;

      return new Date(b.date || 0) - new Date(a.date || 0);
    });
  }, [enrichedReadings, searchTerm, statusFilter, sensorFilter]);

  const totalReadingPages = Math.max(
    1,
    Math.ceil(filteredReadings.length / READINGS_PER_PAGE)
  );

  const currentReadingPage = Math.min(readingsPage, totalReadingPages);

  const paginatedReadings = filteredReadings.slice(
    (currentReadingPage - 1) * READINGS_PER_PAGE,
    currentReadingPage * READINGS_PER_PAGE
  );

  const showingStart =
    filteredReadings.length === 0
      ? 0
      : (currentReadingPage - 1) * READINGS_PER_PAGE + 1;

  const showingEnd = Math.min(
    currentReadingPage * READINGS_PER_PAGE,
    filteredReadings.length
  );

  const summary = useMemo(() => {
    const normal = enrichedReadings.filter((item) => item.status === "normal").length;
    const warning = enrichedReadings.filter((item) => item.status === "warning").length;
    const critical = enrichedReadings.filter(
      (item) => item.status === "critical"
    ).length;

    return {
      total: enrichedReadings.length,
      normal,
      warning,
      critical,
      avgTemp: averageFromNormalized(enrichedReadings, "temperatureValue"),
      avgWaterDepth: averageFromNormalized(enrichedReadings, "waterValue"),
    };
  }, [enrichedReadings]);

  const latestReading = enrichedReadings[0] || null;

  const selectedSensorLabel =
    sensorOptions.find((option) => option.value === sensorFilter)?.label ||
    "All Sensors";

  if (isLoading) {
    return (
      <section className="modern-reading-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading readings...</h3>
        <p>CrayThrive is syncing your sensor records from Supabase.</p>
      </section>
    );
  }

  return (
    <div className="modern-readings-page">
      <section className="modern-readings-hero">
        <div>
          <p className="dashboard-eyebrow">Sensor Readings</p>
          <h2>Track your tank water condition in one view.</h2>
          <p>
            Review live and historical readings for temperature, pH status,
            turbidity status, and water depth. Selecting a sensor now sorts
            that sensor&apos;s warning and critical readings first.
          </p>

          <div className="modern-readings-actions">
            <button className="dashboard-primary-button" onClick={loadReadings}>
              <RefreshCw size={18} />
              Refresh Readings
            </button>

            <span>
              Source: {source || "sensor_readings"} • {scopeLabel}
            </span>
          </div>
        </div>

        <div className="modern-readings-live-card">
          <Activity size={36} />
          <strong>{summary.total}</strong>
          <span>Total synced readings</span>
        </div>
      </section>

      <section className="modern-reading-summary-grid">
        <SummaryCard
          icon={Database}
          label="Total Readings"
          value={summary.total}
          helper="Synced sensor logs"
        />

        <SummaryCard
          icon={CheckCircle2}
          label="Normal"
          value={summary.normal}
          helper="Safe condition records"
          tone="success"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Warnings"
          value={summary.warning}
          helper="Needs monitoring"
          tone="warning"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Critical"
          value={summary.critical}
          helper="Needs immediate review"
          tone="danger"
        />
      </section>

      <section className="modern-readings-grid">
        <article className="modern-readings-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Latest Status Snapshot</p>
              <h3>Readable sensor condition</h3>
            </div>
            <Gauge size={22} />
          </div>

          <div className="modern-reading-metric-grid">
            <MetricCard
              icon={Thermometer}
              label="Avg Temperature"
              value={summary.avgTemp === "N/A" ? "N/A" : `${summary.avgTemp}°C`}
              status={latestReading?.normalized?.temperatureStatus || "No Reading"}
            />

            <MetricCard
              icon={Droplets}
              label="Latest pH Status"
              value={latestReading?.normalized?.phStatus || "No Reading"}
              status={latestReading?.normalized?.phStatus || "No Reading"}
            />

            <MetricCard
              icon={Waves}
              label="Latest Turbidity Status"
              value={latestReading?.normalized?.turbidityStatus || "No Reading"}
              status={latestReading?.normalized?.turbidityStatus || "No Reading"}
            />

            <MetricCard
              icon={Gauge}
              label="Avg Water Depth"
              value={
                summary.avgWaterDepth === "N/A"
                  ? "N/A"
                  : `${summary.avgWaterDepth} cm`
              }
              status={latestReading?.normalized?.waterStatus || "No Reading"}
            />
          </div>
        </article>

        <article className="modern-readings-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Latest Sync</p>
              <h3>Newest reading snapshot</h3>
            </div>
            <Activity size={22} />
          </div>

          {latestReading ? (
            <div className="modern-latest-reading">
              <strong>{latestReading.tankName}</strong>
              <span>{formatReadingTime(latestReading.date)}</span>

              <div>
                <b className={`modern-reading-status ${latestReading.status}`}>
                  {latestReading.status}
                </b>
              </div>
            </div>
          ) : (
            <div className="modern-reading-empty-small">
              <span>No latest reading yet.</span>
            </div>
          )}
        </article>
      </section>

      <section className="modern-reading-toolbar">
        <div className="modern-reading-search">
          <Search size={18} />
          <input
            placeholder="Search by tank, device, value, or status..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <label className="modern-reading-filter">
          <Filter size={18} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All Status</option>
            <option value="normal">Normal</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>

        <label className="modern-reading-filter">
          <Database size={18} />
          <select
            value={sensorFilter}
            onChange={(event) => setSensorFilter(event.target.value)}
          >
            {sensorOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {filteredReadings.length === 0 ? (
        <section className="modern-reading-empty">
          <Database size={34} />
          <h3>No readings found</h3>
          <p>
            No readings matched your current filters. Sync sensor data from the
            mobile/IoT side or adjust the filters.
          </p>
        </section>
      ) : (
        <section className="modern-reading-table-card">
          <div className="modern-reading-table-header">
            <span>Tank / Device</span>
            <span>Temperature</span>
            <span>pH Status</span>
            <span>Turbidity Status</span>
            <span>Water Depth</span>
            <span>{selectedSensorLabel}</span>
            <span>Date</span>
          </div>

          <div className="modern-reading-table-body">
            {paginatedReadings.map((item) => {
              const normalized = item.normalized;
              const row = item.reading;
              const focus = getSensorFocus(item, sensorFilter);

              return (
                <div
                  className="modern-reading-table-row"
                  key={row?.id || item.index}
                >
                  <span data-label="Tank / Device">
                    {item.tankName}
                    {normalized.deviceUid ? ` • ${normalized.deviceUid}` : ""}
                  </span>

                  <span data-label="Temperature">
                    {normalized.temperatureLabel}
                    <small>{normalized.temperatureStatus}</small>
                  </span>

                  <span data-label="pH Status">
                    <b
                      className={`modern-reading-status ${getStatusSeverity([
                        normalized.phStatus,
                      ])}`}
                    >
                      {normalized.phStatus}
                    </b>
                  </span>

                  <span data-label="Turbidity Status">
                    <b
                      className={`modern-reading-status ${getStatusSeverity([
                        normalized.turbidityStatus,
                      ])}`}
                    >
                      {normalized.turbidityStatus}
                    </b>
                  </span>

                  <span data-label="Water Depth">
                    {normalized.waterLabel}
                    <small>{normalized.waterStatus}</small>
                  </span>

                  <span data-label={selectedSensorLabel}>
                    <b className={`modern-reading-status ${focus.severity}`}>
                      {sensorFilter === "all" || sensorFilter === "issues"
                        ? item.status
                        : focus.status}
                    </b>
                  </span>

                  <span data-label="Date">{formatDate(item.date)}</span>
                </div>
              );
            })}
          </div>

          <div className="modern-reading-pagination">
            <span>
              Showing {showingStart}-{showingEnd} of {filteredReadings.length}
            </span>

            <div>
              <button
                type="button"
                disabled={currentReadingPage === 1}
                onClick={() =>
                  setReadingsPage((page) => Math.max(1, page - 1))
                }
              >
                Previous
              </button>

              <strong>
                Page {currentReadingPage} of {totalReadingPages}
              </strong>

              <button
                type="button"
                disabled={currentReadingPage === totalReadingPages}
                onClick={() =>
                  setReadingsPage((page) =>
                    Math.min(totalReadingPages, page + 1)
                  )
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
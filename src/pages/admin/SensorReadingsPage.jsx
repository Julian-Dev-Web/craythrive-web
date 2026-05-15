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

const readingTables = ["sensor_readings", "tank_readings", "readings"];

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

function getValue(row, keys, fallback = "N/A") {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "") {
      return row[key];
    }
  }

  return fallback;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getReadingStatus(row) {
  const raw = lower(
    row?.status || row?.condition || row?.water_status || row?.severity
  );

  if (raw.includes("critical") || raw.includes("danger")) return "critical";
  if (raw.includes("warning") || raw.includes("dirty")) return "warning";
  if (raw.includes("normal") || raw.includes("safe") || raw.includes("good")) {
    return "normal";
  }

  const temp = toNumber(
    getValue(row, ["temperature", "temp", "water_temperature"], null)
  );

  const ph = toNumber(getValue(row, ["ph", "pH", "ph_level"], null));

  const turbidity = toNumber(
    getValue(row, ["turbidity", "turbidity_level", "ntu"], null)
  );

  const waterLevel = toNumber(
    getValue(row, ["water_level", "level", "water_height"], null)
  );

  if (
    (temp !== null && (temp < 18 || temp > 32)) ||
    (ph !== null && (ph < 6 || ph > 9)) ||
    (turbidity !== null && turbidity > 70) ||
    (waterLevel !== null && waterLevel < 20)
  ) {
    return "critical";
  }

  if (
    (temp !== null && (temp < 20 || temp > 30)) ||
    (ph !== null && (ph < 6.5 || ph > 8.5)) ||
    (turbidity !== null && turbidity > 40) ||
    (waterLevel !== null && waterLevel < 35)
  ) {
    return "warning";
  }

  return "normal";
}

function average(rows, keys) {
  const values = rows
    .map((row) => toNumber(getValue(row, keys, null)))
    .filter((value) => value !== null);

  if (!values.length) return "N/A";

  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(2);
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id =
      row?.id || row?.uuid || row?.reading_id || row?.created_at || `row-${index}`;

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

function MetricCard({ icon: Icon, label, value, unit }) {
  return (
    <div className="modern-reading-metric">
      <Icon size={20} />
      <strong>
        {value}
        {value !== "N/A" ? unit : ""}
      </strong>
      <span>{label}</span>
    </div>
  );
}

export default function SensorReadingsPage() {
  const [readings, setReadings] = useState([]);
  const [source, setSource] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sensorFilter, setSensorFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const loadReadings = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      if (!currentUser.id) {
        setReadings([]);
        return;
      }

      const result = await fetchRows(readingTables, currentUser.id);

      setReadings(result.rows);
      setSource(result.tableUsed);
    } catch (error) {
      console.error("Readings loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReadings();
  }, []);

  const enrichedReadings = useMemo(() => {
    return readings.map((reading, index) => {
      const status = getReadingStatus(reading);

      const tankName =
        reading?.tank_name ||
        reading?.tank_label ||
        reading?.name ||
        reading?.tank_id ||
        `Reading ${index + 1}`;

      const date =
        reading?.created_at || reading?.timestamp || reading?.date || reading?.updated_at;

      return {
        reading,
        index,
        status,
        tankName: String(tankName),
        date,
      };
    });
  }, [readings]);

  const filteredReadings = useMemo(() => {
    return enrichedReadings.filter((item) => {
      const search = searchTerm.trim().toLowerCase();

      const temperature = getValue(item.reading, [
        "temperature",
        "temp",
        "water_temperature",
      ]);

      const ph = getValue(item.reading, ["ph", "pH", "ph_level"]);

      const turbidity = getValue(item.reading, [
        "turbidity",
        "turbidity_level",
        "ntu",
      ]);

      const waterLevel = getValue(item.reading, [
        "water_level",
        "level",
        "water_height",
      ]);

      const matchesSearch =
        !search ||
        item.tankName.toLowerCase().includes(search) ||
        item.status.includes(search) ||
        String(temperature).toLowerCase().includes(search) ||
        String(ph).toLowerCase().includes(search) ||
        String(turbidity).toLowerCase().includes(search) ||
        String(waterLevel).toLowerCase().includes(search);

      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      const matchesSensor =
        sensorFilter === "all" ||
        (sensorFilter === "temperature" && temperature !== "N/A") ||
        (sensorFilter === "ph" && ph !== "N/A") ||
        (sensorFilter === "turbidity" && turbidity !== "N/A") ||
        (sensorFilter === "water_level" && waterLevel !== "N/A");

      return matchesSearch && matchesStatus && matchesSensor;
    });
  }, [enrichedReadings, searchTerm, statusFilter, sensorFilter]);

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
      avgTemp: average(readings, ["temperature", "temp", "water_temperature"]),
      avgPh: average(readings, ["ph", "pH", "ph_level"]),
      avgTurbidity: average(readings, ["turbidity", "turbidity_level", "ntu"]),
      avgWaterLevel: average(readings, ["water_level", "level", "water_height"]),
    };
  }, [enrichedReadings, readings]);

  const latestReading = enrichedReadings[0]?.reading || null;

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
            Review live and historical readings for temperature, pH, turbidity,
            and water level. This page is designed to help you quickly spot
            warnings and critical water conditions.
          </p>

          <div className="modern-readings-actions">
            <button className="dashboard-primary-button" onClick={loadReadings}>
              <RefreshCw size={18} />
              Refresh Readings
            </button>

            <span>Source: {source || "sensor_readings"}</span>
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
              <p className="dashboard-eyebrow">Average Metrics</p>
              <h3>Overall water condition</h3>
            </div>
            <Gauge size={22} />
          </div>

          <div className="modern-reading-metric-grid">
            <MetricCard
              icon={Thermometer}
              label="Temperature"
              value={summary.avgTemp}
              unit="°C"
            />
            <MetricCard icon={Droplets} label="pH Level" value={summary.avgPh} unit="" />
            <MetricCard
              icon={Waves}
              label="Turbidity"
              value={summary.avgTurbidity}
              unit=""
            />
            <MetricCard
              icon={Gauge}
              label="Water Level"
              value={summary.avgWaterLevel}
              unit=""
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
              <strong>
                {latestReading?.tank_name ||
                  latestReading?.tank_label ||
                  latestReading?.tank_id ||
                  "Latest Reading"}
              </strong>

              <span>
                {formatDate(
                  latestReading?.created_at ||
                    latestReading?.timestamp ||
                    latestReading?.date
                )}
              </span>

              <div>
                <b className={`modern-reading-status ${getReadingStatus(latestReading)}`}>
                  {getReadingStatus(latestReading)}
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
            placeholder="Search by tank, value, or status..."
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
            <option value="all">All Sensors</option>
            <option value="temperature">Temperature</option>
            <option value="ph">pH Level</option>
            <option value="turbidity">Turbidity</option>
            <option value="water_level">Water Level</option>
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
            <span>Tank / Source</span>
            <span>Temperature</span>
            <span>pH</span>
            <span>Turbidity</span>
            <span>Water Level</span>
            <span>Status</span>
            <span>Date</span>
          </div>

          <div className="modern-reading-table-body">
            {filteredReadings.map((item) => {
              const row = item.reading;

              const temperature = getValue(row, [
                "temperature",
                "temp",
                "water_temperature",
              ]);

              const ph = getValue(row, ["ph", "pH", "ph_level"]);

              const turbidity = getValue(row, [
                "turbidity",
                "turbidity_level",
                "ntu",
              ]);

              const waterLevel = getValue(row, [
                "water_level",
                "level",
                "water_height",
              ]);

              return (
                <div className="modern-reading-table-row" key={row?.id || item.index}>
                  <span data-label="Tank / Source">{item.tankName}</span>
                  <span data-label="Temperature">
                    {temperature !== "N/A" ? `${temperature}°C` : "N/A"}
                  </span>
                  <span data-label="pH">{ph}</span>
                  <span data-label="Turbidity">{turbidity}</span>
                  <span data-label="Water Level">{waterLevel}</span>
                  <span data-label="Status">
                    <b className={`modern-reading-status ${item.status}`}>
                      {item.status}
                    </b>
                  </span>
                  <span data-label="Date">
                    {formatDate(row?.created_at || row?.timestamp || row?.date)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
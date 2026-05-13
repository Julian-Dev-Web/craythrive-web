import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Database,
  Droplets,
  Filter,
  FlaskConical,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  Thermometer,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const readingTableNames = ["sensor_readings", "tank_readings", "readings"];
const tankTableNames = ["tanks", "user_tanks", "tank_profiles"];

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
];

const tankIdKeys = ["tank_id", "tankId", "tank", "id"];

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

function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined) return row[key];
  }

  return null;
}

function getReadingId(reading, index) {
  return reading?.id || reading?.reading_id || reading?.uuid || `reading-${index}`;
}

function getReadingTankId(reading) {
  return (
    reading?.tank_id ||
    reading?.tankId ||
    reading?.tank ||
    reading?.tank_uuid ||
    ""
  );
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

function getReadingTankName(reading, tankMap) {
  const tankId = getReadingTankId(reading);
  return (
    reading?.tank_name ||
    reading?.tank_label ||
    tankMap[tankId]?.name ||
    tankId ||
    "Unlinked Tank"
  );
}

function getReadingStatus(reading) {
  const raw = lower(
    reading?.status ||
      reading?.condition ||
      reading?.severity ||
      reading?.water_status ||
      "normal"
  );

  if (raw.includes("critical") || raw.includes("danger")) return "critical";
  if (raw.includes("warn") || raw.includes("dirty")) return "warning";
  if (raw.includes("safe") || raw.includes("good") || raw.includes("normal")) {
    return "normal";
  }

  return raw || "normal";
}

function getTemperature(reading) {
  return getValue(reading, ["temperature", "temp", "water_temperature"]);
}

function getPh(reading) {
  return getValue(reading, ["ph", "pH", "ph_level"]);
}

function getTurbidity(reading) {
  return getValue(reading, ["turbidity", "turbidity_level", "ntu"]);
}

function getWaterLevel(reading) {
  return getValue(reading, ["water_level", "level", "water_height"]);
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

export default function SensorReadingsPage() {
  const [readings, setReadings] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [tableUsed, setTableUsed] = useState("sensor_readings");
  const [searchTerm, setSearchTerm] = useState("");
  const [tankFilter, setTankFilter] = useState("all");
  const [sensorFilter, setSensorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

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
        setTanks([]);
        return;
      }

      const [readingResult, tankResult] = await Promise.all([
        fetchUserRows(readingTableNames, currentUser.id, 250),
        fetchUserRows(tankTableNames, currentUser.id, 120),
      ]);

      const sortedReadings = [...readingResult.rows].sort((a, b) => {
        const aDate = new Date(a.created_at || a.updated_at || 0).getTime();
        const bDate = new Date(b.created_at || b.updated_at || 0).getTime();
        return bDate - aDate;
      });

      setReadings(sortedReadings);
      setTanks(tankResult.rows);
      setTableUsed(readingResult.tableUsed);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Sensor readings loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReadings();
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

  const tankOptions = useMemo(() => {
    const options = new Map();

    tanks.forEach((tank) => {
      const id = getTankId(tank);
      if (id) options.set(id, getTankName(tank));
    });

    readings.forEach((reading) => {
      const id = getReadingTankId(reading);
      if (id && !options.has(id)) {
        options.set(id, id);
      }
    });

    return Array.from(options.entries()).map(([id, name]) => ({
      id,
      name,
    }));
  }, [tanks, readings]);

  const filteredReadings = useMemo(() => {
    return readings.filter((reading) => {
      const search = lower(searchTerm);
      const tankId = getReadingTankId(reading);
      const tankName = lower(getReadingTankName(reading, tankMap));
      const status = getReadingStatus(reading);

      const temp = getTemperature(reading);
      const ph = getPh(reading);
      const turbidity = getTurbidity(reading);
      const waterLevel = getWaterLevel(reading);

      const createdAt = reading.created_at || reading.updated_at;
      const createdDate = createdAt ? new Date(createdAt) : null;

      const matchesSearch =
        !search ||
        tankName.includes(search) ||
        lower(tankId).includes(search) ||
        lower(status).includes(search);

      const matchesTank = tankFilter === "all" || String(tankId) === tankFilter;

      const matchesStatus = statusFilter === "all" || status === statusFilter;

      const matchesSensor =
        sensorFilter === "all" ||
        (sensorFilter === "temperature" && temp !== null) ||
        (sensorFilter === "ph" && ph !== null) ||
        (sensorFilter === "turbidity" && turbidity !== null) ||
        (sensorFilter === "water_level" && waterLevel !== null);

      const matchesFrom =
        !dateFrom ||
        !createdDate ||
        createdDate >= new Date(`${dateFrom}T00:00:00`);

      const matchesTo =
        !dateTo ||
        !createdDate ||
        createdDate <= new Date(`${dateTo}T23:59:59`);

      return (
        matchesSearch &&
        matchesTank &&
        matchesStatus &&
        matchesSensor &&
        matchesFrom &&
        matchesTo
      );
    });
  }, [
    readings,
    tankMap,
    searchTerm,
    tankFilter,
    sensorFilter,
    statusFilter,
    dateFrom,
    dateTo,
  ]);

  const latestReading = filteredReadings[0] || readings[0] || {};

  const stats = [
    {
      label: "Total readings",
      value: filteredReadings.length,
      icon: Database,
    },
    {
      label: "Latest temp",
      value:
        getTemperature(latestReading) !== null
          ? `${getTemperature(latestReading)}°C`
          : "N/A",
      icon: Thermometer,
    },
    {
      label: "Latest pH",
      value: getPh(latestReading) !== null ? getPh(latestReading) : "N/A",
      icon: FlaskConical,
    },
    {
      label: "Latest water level",
      value:
        getWaterLevel(latestReading) !== null
          ? getWaterLevel(latestReading)
          : "N/A",
      icon: Droplets,
    },
  ];

  return (
    <div className="readings-page">
      <section className="readings-header-card">
        <div>
          <p className="dashboard-eyebrow">Sensor Monitoring</p>
          <h2>Sensor Readings</h2>
          <p>
            Review tank sensor data synced from your CrayThrive mobile account
            and IoT devices. Filter readings by tank, sensor type, status, and
            date range.
          </p>

          <div className="readings-header-actions">
            <button className="dashboard-primary-button" onClick={loadReadings}>
              {isLoading ? (
                <Loader2 className="spin-icon" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
              Refresh Readings
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : `Source table: ${tableUsed}`}
            </span>
          </div>
        </div>
      </section>

      <section className="reading-summary-grid">
        {stats.map((item) => {
          const Icon = item.icon;

          return (
            <article className="reading-summary-card" key={item.label}>
              <span>
                <Icon size={22} />
              </span>
              <strong>{item.value}</strong>
              <p>{item.label}</p>
            </article>
          );
        })}
      </section>

      <section className="reading-toolbar">
        <label className="reading-search-box">
          <Search size={18} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search tank, ID, or status..."
          />
        </label>

        <label className="reading-filter">
          <Filter size={18} />
          <select
            value={tankFilter}
            onChange={(event) => setTankFilter(event.target.value)}
          >
            <option value="all">All tanks</option>
            {tankOptions.map((tank) => (
              <option key={tank.id} value={tank.id}>
                {tank.name}
              </option>
            ))}
          </select>
        </label>

        <label className="reading-filter">
          <Activity size={18} />
          <select
            value={sensorFilter}
            onChange={(event) => setSensorFilter(event.target.value)}
          >
            <option value="all">All sensors</option>
            <option value="temperature">Temperature</option>
            <option value="ph">pH</option>
            <option value="turbidity">Turbidity</option>
            <option value="water_level">Water Level</option>
          </select>
        </label>

        <label className="reading-filter">
          <Gauge size={18} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All status</option>
            <option value="normal">Normal</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>

        <label className="reading-date-box">
          <CalendarDays size={18} />
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>

        <label className="reading-date-box">
          <CalendarDays size={18} />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
      </section>

      {isLoading ? (
        <section className="reading-empty-state">
          <Loader2 className="spin-icon" size={30} />
          <h3>Loading sensor readings...</h3>
          <p>Please wait while CrayThrive checks your readings.</p>
        </section>
      ) : filteredReadings.length === 0 ? (
        <section className="reading-empty-state">
          <AlertTriangle size={34} />
          <h3>No readings found</h3>
          <p>
            No records matched your filters. Try clearing filters or syncing
            sensor data from the mobile app.
          </p>
        </section>
      ) : (
        <section className="reading-table-card">
          <div className="reading-table-header">
            <div>
              <p className="dashboard-eyebrow">Reading History</p>
              <h3>Latest records</h3>
            </div>
            <span>{filteredReadings.length} result(s)</span>
          </div>

          <div className="reading-table">
            <div className="reading-table-row reading-table-head">
              <span>Tank</span>
              <span>Temperature</span>
              <span>pH</span>
              <span>Turbidity</span>
              <span>Water Level</span>
              <span>Status</span>
              <span>Date</span>
            </div>

            {filteredReadings.map((reading, index) => {
              const status = getReadingStatus(reading);

              return (
                <div
                  className="reading-table-row"
                  key={getReadingId(reading, index)}
                >
                  <span>{getReadingTankName(reading, tankMap)}</span>
                  <span>
                    {getTemperature(reading) !== null
                      ? `${getTemperature(reading)}°C`
                      : "N/A"}
                  </span>
                  <span>{getPh(reading) !== null ? getPh(reading) : "N/A"}</span>
                  <span>
                    {getTurbidity(reading) !== null
                      ? getTurbidity(reading)
                      : "N/A"}
                  </span>
                  <span>
                    {getWaterLevel(reading) !== null
                      ? getWaterLevel(reading)
                      : "N/A"}
                  </span>
                  <span>
                    <b className={`reading-status-pill ${status}`}>
                      {status}
                    </b>
                  </span>
                  <span>{formatDate(reading.created_at || reading.updated_at)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
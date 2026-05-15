import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Droplets,
  Filter,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Thermometer,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const tankTables = ["tanks", "user_tanks", "tank_profiles"];
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
  if (!value) return "No sync yet";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No sync yet";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getTankName(tank, index) {
  return (
    tank?.name ||
    tank?.tank_name ||
    tank?.title ||
    tank?.label ||
    `Tank ${index + 1}`
  );
}

function getTankId(tank, index) {
  return tank?.id || tank?.tank_id || tank?.uuid || `tank-${index}`;
}

function getTankType(tank) {
  return tank?.type || tank?.tank_type || tank?.category || "Crayfish Tank";
}

function getTankStatus(tank, reading) {
  const raw = lower(
    tank?.status ||
      tank?.condition ||
      reading?.status ||
      reading?.condition ||
      reading?.water_status
  );

  if (raw.includes("critical") || raw.includes("danger")) return "critical";
  if (raw.includes("warning") || raw.includes("dirty")) return "warning";
  if (raw.includes("normal") || raw.includes("safe") || raw.includes("good")) {
    return "normal";
  }

  return raw || "normal";
}

function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "") {
      return row[key];
    }
  }

  return "N/A";
}

function getLatestReadingForTank(tank, readings) {
  const tankId = getTankId(tank, 0);

  const matched = readings
    .filter((reading) => {
      const readingTankId =
        reading?.tank_id ||
        reading?.tankId ||
        reading?.tank_uuid ||
        reading?.tank_profile_id;

      return String(readingTankId) === String(tankId);
    })
    .sort(
      (a, b) =>
        new Date(b?.created_at || b?.timestamp || 0) -
        new Date(a?.created_at || a?.timestamp || 0)
    );

  return matched[0] || null;
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id = row?.id || row?.uuid || row?.tank_id || `row-${index}`;
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

async function fetchRows(tableNames, userId, limit = 200) {
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

function SummaryCard({ icon: Icon, label, value, helper }) {
  return (
    <article className="modern-tank-summary-card">
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

export default function TanksPage() {
  const [tanks, setTanks] = useState([]);
  const [readings, setReadings] = useState([]);
  const [sources, setSources] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const loadTanks = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      if (!currentUser.id) {
        setTanks([]);
        setReadings([]);
        return;
      }

      const [tankResult, readingResult] = await Promise.all([
        fetchRows(tankTables, currentUser.id),
        fetchRows(readingTables, currentUser.id),
      ]);

      setTanks(tankResult.rows);
      setReadings(readingResult.rows);
      setSources({
        tanks: tankResult.tableUsed,
        readings: readingResult.tableUsed,
      });
    } catch (error) {
      console.error("Tanks loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTanks();
  }, []);

  const enrichedTanks = useMemo(() => {
    return tanks.map((tank, index) => {
      const latestReading = getLatestReadingForTank(tank, readings);

      return {
        tank,
        index,
        latestReading,
        id: getTankId(tank, index),
        name: getTankName(tank, index),
        type: getTankType(tank),
        status: getTankStatus(tank, latestReading),
      };
    });
  }, [tanks, readings]);

  const tankTypes = useMemo(() => {
    const types = Array.from(new Set(enrichedTanks.map((item) => item.type)));
    return types.filter(Boolean);
  }, [enrichedTanks]);

  const filteredTanks = useMemo(() => {
    return enrichedTanks.filter((item) => {
      const search = searchTerm.trim().toLowerCase();

      const matchesSearch =
        !search ||
        item.name.toLowerCase().includes(search) ||
        item.type.toLowerCase().includes(search) ||
        item.status.toLowerCase().includes(search);

      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      const matchesType = typeFilter === "all" || item.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [enrichedTanks, searchTerm, statusFilter, typeFilter]);

  const summary = useMemo(() => {
    const critical = enrichedTanks.filter((item) => item.status === "critical").length;
    const warning = enrichedTanks.filter((item) => item.status === "warning").length;
    const normal = enrichedTanks.filter((item) => item.status === "normal").length;

    return {
      total: enrichedTanks.length,
      normal,
      warning,
      critical,
    };
  }, [enrichedTanks]);

  if (isLoading) {
    return (
      <section className="modern-tank-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading tanks...</h3>
        <p>CrayThrive is syncing your tank records from Supabase.</p>
      </section>
    );
  }

  return (
    <div className="modern-tanks-page">
      <section className="modern-tanks-hero">
        <div>
          <p className="dashboard-eyebrow">Tank Management</p>
          <h2>Monitor every crayfish tank clearly.</h2>
          <p>
            View your tank list, latest water readings, tank health status, and
            important tank metadata synced from the same mobile account.
          </p>

          <div className="modern-tanks-actions">
            <button className="dashboard-primary-button" onClick={loadTanks}>
              <RefreshCw size={18} />
              Refresh Tanks
            </button>

            <button className="modern-secondary-link" type="button">
              <Plus size={18} />
              Add Tank Soon
            </button>

            <span>
              Source: {sources.tanks || "tanks"} / {sources.readings || "readings"}
            </span>
          </div>
        </div>

        <div className="modern-tanks-hero-card">
          <Droplets size={38} />
          <strong>{summary.total}</strong>
          <span>Total synced tanks</span>
        </div>
      </section>

      <section className="modern-tank-summary-grid">
        <SummaryCard
          icon={Droplets}
          label="Total Tanks"
          value={summary.total}
          helper="All tank records"
        />

        <SummaryCard
          icon={CheckCircle2}
          label="Normal"
          value={summary.normal}
          helper="Healthy tanks"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Warning"
          value={summary.warning}
          helper="Needs monitoring"
        />

        <SummaryCard
          icon={Gauge}
          label="Critical"
          value={summary.critical}
          helper="Needs immediate review"
        />
      </section>

      <section className="modern-tank-toolbar">
        <div className="modern-tank-search">
          <Search size={18} />
          <input
            placeholder="Search tank name, type, or status..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <label className="modern-tank-filter">
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

        <label className="modern-tank-filter">
          <Database size={18} />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All Types</option>
            {tankTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </section>

      {filteredTanks.length === 0 ? (
        <section className="modern-tank-empty">
          <Droplets size={34} />
          <h3>No tanks found</h3>
          <p>
            No tank records matched your current filters. Add tanks from the
            mobile app or adjust the filter values.
          </p>
        </section>
      ) : (
        <section className="modern-tank-grid">
          {filteredTanks.map((item) => {
            const reading = item.latestReading;

            const temperature = getValue(reading, [
              "temperature",
              "temp",
              "water_temperature",
            ]);

            const ph = getValue(reading, ["ph", "pH", "ph_level"]);

            const turbidity = getValue(reading, [
              "turbidity",
              "turbidity_level",
              "ntu",
            ]);

            const waterLevel = getValue(reading, [
              "water_level",
              "level",
              "water_height",
            ]);

            const lastSync =
              reading?.created_at ||
              reading?.timestamp ||
              item.tank?.updated_at ||
              item.tank?.created_at;

            return (
              <article className="modern-tank-card" key={item.id}>
                <div className="modern-tank-card-top">
                  <div>
                    <span className="modern-tank-type">{item.type}</span>
                    <h3>{item.name}</h3>
                  </div>

                  <b className={`modern-tank-status ${item.status}`}>
                    {item.status}
                  </b>
                </div>

                <div className="modern-tank-meta">
                  <span>Capacity: {getValue(item.tank, ["capacity", "size", "volume"])}</span>
                  <span>Stock: {getValue(item.tank, ["stock", "count", "crayfish_count"])}</span>
                  <span>Last sync: {formatDate(lastSync)}</span>
                </div>

                <div className="modern-tank-reading-grid">
                  <div>
                    <Thermometer size={19} />
                    <strong>{temperature !== "N/A" ? `${temperature}°C` : "N/A"}</strong>
                    <span>Temperature</span>
                  </div>

                  <div>
                    <Droplets size={19} />
                    <strong>{ph}</strong>
                    <span>pH Level</span>
                  </div>

                  <div>
                    <Waves size={19} />
                    <strong>{turbidity}</strong>
                    <span>Turbidity</span>
                  </div>

                  <div>
                    <Gauge size={19} />
                    <strong>{waterLevel}</strong>
                    <span>Water Level</span>
                  </div>
                </div>

                <Link to={`/admin/tanks/${item.id}`} className="modern-tank-link">
                  View Tank Details
                  <ArrowRight size={18} />
                </Link>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
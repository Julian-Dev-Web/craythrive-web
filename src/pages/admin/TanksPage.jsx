import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Droplets,
  Filter,
  FlaskConical,
  Loader2,
  RefreshCw,
  Search,
  Thermometer,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const tankTableNames = ["tanks", "user_tanks", "tank_profiles"];
const readingTableNames = ["sensor_readings", "tank_readings", "readings"];
const ammoniaTableNames = ["ammonia_readings", "ammonia_results"];
const alertTableNames = ["alerts", "notifications", "tank_alerts"];

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
];

const tankIdColumns = ["tank_id", "tankId", "tank"];

function normalizeText(value) {
  return String(value || "").trim();
}

function lower(value) {
  return normalizeText(value).toLowerCase();
}

function formatDate(value) {
  if (!value) return "No update yet";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "No update yet";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
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
    null
  );
}

function getTankStatus(tank, latestReading, alertCount) {
  const rawStatus =
    tank?.status ||
    tank?.condition ||
    tank?.tank_status ||
    latestReading?.status ||
    latestReading?.condition ||
    latestReading?.severity ||
    "";

  const status = lower(rawStatus);

  if (alertCount > 0 && !status) return "warning";
  if (status.includes("critical") || status.includes("danger")) return "critical";
  if (status.includes("warn")) return "warning";
  if (status.includes("dirty")) return "warning";
  if (status.includes("normal") || status.includes("safe") || status.includes("good")) {
    return "normal";
  }

  return alertCount > 0 ? "warning" : "normal";
}

function getReadingValue(reading, keys) {
  for (const key of keys) {
    if (reading?.[key] !== null && reading?.[key] !== undefined) {
      return reading[key];
    }
  }

  return null;
}

function getAmmoniaValue(ammonia) {
  return getReadingValue(ammonia, [
    "ammonia_level",
    "ammonia",
    "nh3",
    "result",
    "value",
  ]);
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

async function fetchUserRowsFromTables(tableNames, userId, limit = 100) {
  for (const tableName of tableNames) {
    for (const column of userFilterColumns) {
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .limit(limit);

      if (!error && Array.isArray(data)) {
        return {
          rows: data,
          tableUsed: tableName,
          userColumnUsed: column,
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

async function fetchLatestByTank(tableNames, tankId, userId) {
  if (!tankId) return null;

  for (const tableName of tableNames) {
    for (const tankColumn of tankIdColumns) {
      for (const userColumn of userFilterColumns) {
        const withDate = await supabase
          .from(tableName)
          .select("*")
          .eq(tankColumn, tankId)
          .eq(userColumn, userId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (!withDate.error && Array.isArray(withDate.data)) {
          return withDate.data[0] || null;
        }

        const withoutDate = await supabase
          .from(tableName)
          .select("*")
          .eq(tankColumn, tankId)
          .eq(userColumn, userId)
          .limit(1);

        if (!withoutDate.error && Array.isArray(withoutDate.data)) {
          return withoutDate.data[0] || null;
        }
      }
    }
  }

  return null;
}

async function countAlertsByTank(tankId, userId) {
  if (!tankId) return 0;

  for (const tableName of alertTableNames) {
    for (const tankColumn of tankIdColumns) {
      for (const userColumn of userFilterColumns) {
        const { count, error } = await supabase
          .from(tableName)
          .select("*", { count: "exact", head: true })
          .eq(tankColumn, tankId)
          .eq(userColumn, userId);

        if (!error) {
          return count || 0;
        }
      }
    }
  }

  return 0;
}

export default function TanksPage() {
  const [tanks, setTanks] = useState([]);
  const [tankMeta, setTankMeta] = useState({});
  const [tableUsed, setTableUsed] = useState("tanks");
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

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
        setTankMeta({});
        return;
      }

      const result = await fetchUserRowsFromTables(
        tankTableNames,
        currentUser.id
      );

      const sortedTanks = [...result.rows].sort((a, b) => {
        const aDate = new Date(a.updated_at || a.created_at || 0).getTime();
        const bDate = new Date(b.updated_at || b.created_at || 0).getTime();
        return bDate - aDate;
      });

      const metaPairs = await Promise.all(
        sortedTanks.map(async (tank) => {
          const tankId = getTankId(tank);

          const [latestReading, latestAmmonia, alertCount] = await Promise.all([
            fetchLatestByTank(readingTableNames, tankId, currentUser.id),
            fetchLatestByTank(ammoniaTableNames, tankId, currentUser.id),
            countAlertsByTank(tankId, currentUser.id),
          ]);

          return [
            tankId,
            {
              latestReading,
              latestAmmonia,
              alertCount,
              status: getTankStatus(tank, latestReading, alertCount),
            },
          ];
        })
      );

      setTanks(sortedTanks);
      setTankMeta(Object.fromEntries(metaPairs));
      setTableUsed(result.tableUsed);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Tank loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTanks();
  }, []);

  const tankTypes = useMemo(() => {
    const unique = new Set();

    tanks.forEach((tank) => {
      const type = getTankType(tank);
      if (type) unique.add(type);
    });

    return Array.from(unique);
  }, [tanks]);

  const filteredTanks = useMemo(() => {
    return tanks.filter((tank) => {
      const tankId = getTankId(tank);
      const meta = tankMeta[tankId] || {};
      const name = lower(getTankName(tank));
      const type = lower(getTankType(tank));
      const status = lower(meta.status || "normal");
      const search = lower(searchTerm);

      const matchesSearch =
        !search ||
        name.includes(search) ||
        type.includes(search) ||
        lower(tankId).includes(search);

      const matchesType =
        typeFilter === "all" || type === lower(typeFilter);

      const matchesStatus =
        statusFilter === "all" || status === lower(statusFilter);

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [tanks, tankMeta, searchTerm, typeFilter, statusFilter]);

  const statusCounts = useMemo(() => {
    return tanks.reduce(
      (acc, tank) => {
        const tankId = getTankId(tank);
        const status = tankMeta[tankId]?.status || "normal";

        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;

        return acc;
      },
      {
        total: 0,
        normal: 0,
        warning: 0,
        critical: 0,
      }
    );
  }, [tanks, tankMeta]);

  return (
    <div className="tanks-page">
      <section className="tanks-header-card">
        <div>
          <p className="dashboard-eyebrow">Tank Management</p>
          <h2>My Tanks</h2>
          <p>
            View all tanks connected to your CrayThrive mobile account. Each
            tank card shows latest readings, ammonia result, alert count, and
            current condition.
          </p>

          <div className="tanks-header-actions">
            <button className="dashboard-primary-button" onClick={loadTanks}>
              {isLoading ? (
                <Loader2 className="spin-icon" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
              Refresh Tanks
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : `Source table: ${tableUsed}`}
            </span>
          </div>
        </div>
      </section>

      <section className="tank-summary-grid">
        <article className="tank-summary-card">
          <span>
            <Droplets size={22} />
          </span>
          <strong>{statusCounts.total}</strong>
          <p>Total tanks</p>
        </article>

        <article className="tank-summary-card">
          <span>
            <CheckCircle2 size={22} />
          </span>
          <strong>{statusCounts.normal || 0}</strong>
          <p>Normal</p>
        </article>

        <article className="tank-summary-card">
          <span>
            <AlertTriangle size={22} />
          </span>
          <strong>{statusCounts.warning || 0}</strong>
          <p>Warning</p>
        </article>

        <article className="tank-summary-card">
          <span>
            <AlertTriangle size={22} />
          </span>
          <strong>{statusCounts.critical || 0}</strong>
          <p>Critical</p>
        </article>
      </section>

      <section className="tank-toolbar">
        <label className="tank-search-box">
          <Search size={18} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search tank name, type, or ID..."
          />
        </label>

        <label className="tank-filter">
          <Filter size={18} />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All types</option>
            {tankTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="tank-filter">
          <Waves size={18} />
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
      </section>

      {isLoading ? (
        <section className="tank-empty-state">
          <Loader2 className="spin-icon" size={30} />
          <h3>Loading tanks...</h3>
          <p>Please wait while CrayThrive checks your tank records.</p>
        </section>
      ) : filteredTanks.length === 0 ? (
        <section className="tank-empty-state">
          <Droplets size={34} />
          <h3>No tanks found</h3>
          <p>
            No tank records matched your filters. Add tanks from the mobile app
            or refresh after syncing your account.
          </p>
        </section>
      ) : (
        <section className="tank-card-grid">
          {filteredTanks.map((tank) => {
            const tankId = getTankId(tank);
            const meta = tankMeta[tankId] || {};
            const reading = meta.latestReading || {};
            const ammonia = meta.latestAmmonia || {};
            const status = meta.status || "normal";

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

            const ammoniaValue = getAmmoniaValue(ammonia);

            return (
              <article className="tank-card" key={tankId || getTankName(tank)}>
                <div className="tank-card-top">
                  <div>
                    <span className="tank-type-pill">{getTankType(tank)}</span>
                    <h3>{getTankName(tank)}</h3>
                  </div>

                  <span className={`tank-status-pill ${status}`}>
                    {status}
                  </span>
                </div>

                <div className="tank-meta-row">
                  <span>ID: {tankId || "No ID"}</span>
                  <span>
                    Count:{" "}
                    {getTankCount(tank) !== null ? getTankCount(tank) : "N/A"}
                  </span>
                </div>

                <div className="tank-reading-grid">
                  <div>
                    <Thermometer size={18} />
                    <strong>{temp !== null ? `${temp}°C` : "N/A"}</strong>
                    <span>Temperature</span>
                  </div>

                  <div>
                    <FlaskConical size={18} />
                    <strong>{ph !== null ? ph : "N/A"}</strong>
                    <span>pH</span>
                  </div>

                  <div>
                    <Waves size={18} />
                    <strong>{turbidity !== null ? turbidity : "N/A"}</strong>
                    <span>Turbidity</span>
                  </div>

                  <div>
                    <Droplets size={18} />
                    <strong>{waterLevel !== null ? waterLevel : "N/A"}</strong>
                    <span>Water level</span>
                  </div>
                </div>

                <div className="tank-extra-row">
                  <div>
                    <span>Ammonia</span>
                    <strong>{ammoniaValue !== null ? ammoniaValue : "No record"}</strong>
                  </div>

                  <div>
                    <span>Alerts</span>
                    <strong>{meta.alertCount || 0}</strong>
                  </div>

                  <div>
                    <span>Updated</span>
                    <strong>
                      {formatDate(
                        reading.created_at ||
                          ammonia.created_at ||
                          tank.updated_at ||
                          tank.created_at
                      )}
                    </strong>
                  </div>
                </div>

                <Link className="tank-details-link" to={`/admin/tanks/${tankId}`}>
                  Open tank details
                  <ArrowRight size={17} />
                </Link>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
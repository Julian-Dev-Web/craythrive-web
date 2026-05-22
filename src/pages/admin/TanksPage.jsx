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
  RefreshCw,
  Search,
  Thermometer,
  UserRound,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  formatReadingTime,
  normalizeSensorReading,
} from "../../utils/sensorReadingUtils";

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

function getOverallReadingStatus(normalizedReading) {
  return getStatusSeverity([
    normalizedReading.temperatureStatus,
    normalizedReading.phStatus,
    normalizedReading.turbidityStatus,
    normalizedReading.waterStatus,
  ]);
}

function getTankId(tank, index) {
  return tank?.id || tank?.tank_id || tank?.uuid || `tank-${index}`;
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

function getTankType(tank) {
  return tank?.type || tank?.tank_type || tank?.category || "Crayfish Tank";
}

function getTankOwnerId(tank) {
  return (
    tank?.user_id ||
    tank?.owner_id ||
    tank?.profile_id ||
    tank?.created_by ||
    tank?.farmer_id ||
    ""
  );
}

function getProfileName(profile) {
  return (
    profile?.username ||
    profile?.full_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.email ||
    "Unknown owner"
  );
}

function getTankMatchKeys(tank) {
  return [
    tank?.id,
    tank?.tank_id,
    tank?.uuid,
    tank?.iot_device_id,
    tank?.device_id,
    tank?.device_uid,
    tank?.tank_code,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));
}

function getReadingMatchKeys(reading) {
  return [
    reading?.tank_id,
    reading?.tankId,
    reading?.tank_uuid,
    reading?.tank_profile_id,
    reading?.iot_device_id,
    reading?.device_id,
    reading?.device_uid,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));
}

function getReadingDate(reading) {
  return (
    reading?.created_at ||
    reading?.timestamp ||
    reading?.date ||
    reading?.updated_at ||
    ""
  );
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function getReadingPhValue(reading) {
  return toNumberOrNull(reading?.ph_value ?? reading?.ph);
}

function isSafePhStatus(status) {
  const value = normalizeStatusText(status);

  return (
    value.includes("ideal") ||
    value.includes("safe") ||
    value.includes("normal")
  );
}

function isUnsafePhStatus(status) {
  const value = normalizeStatusText(status);

  return (
    value.includes("unsafe") ||
    value.includes("critical") ||
    value.includes("danger") ||
    value.includes("high ph") ||
    value.includes("low ph") ||
    value.includes("high alkaline") ||
    value.includes("low alkaline") ||
    value.includes("acidic")
  );
}

function isUnsafePhReading(reading) {
  if (!reading) return false;

  const phValue = getReadingPhValue(reading);
  const phStatus = reading?.ph_status || "";

  if (isSafePhStatus(phStatus)) return false;

  if (phValue !== null && (phValue < 6.5 || phValue > 8.5)) {
    return true;
  }

  return isUnsafePhStatus(phStatus);
}

function sortReadingsNewestFirst(readings = []) {
  return [...readings].sort((a, b) => {
    return new Date(getReadingDate(b)) - new Date(getReadingDate(a));
  });
}

function pickStableLatestReading(readings = []) {
  const sorted = sortReadingsNewestFirst(readings);

  if (sorted.length === 0) return null;

  const latest = sorted[0];

  // If latest pH is safe or not pH-danger, use it normally.
  if (!isUnsafePhReading(latest)) {
    return latest;
  }

  // If latest pH is unsafe, require 3 consecutive unsafe pH readings.
  // Example:
  // 10.16, 7.50, 7.49 = spike only, use newest safe reading
  // 10.16, 10.12, 10.15 = confirmed unsafe, use latest unsafe reading
  const latestThree = sorted.slice(0, 3);

  const confirmedUnsafePh =
    latestThree.length >= 3 && latestThree.every(isUnsafePhReading);

  if (confirmedUnsafePh) {
    return latest;
  }

  const newestSafeReading = sorted.find((reading) => {
    return !isUnsafePhReading(reading);
  });

  return newestSafeReading || latest;
}

function getLatestReadingForTank(tank, readings) {
  const tankKeys = getTankMatchKeys(tank);

  const matched = readings.filter((reading) => {
    const readingKeys = getReadingMatchKeys(reading);
    return readingKeys.some((key) => tankKeys.includes(key));
  });

  return pickStableLatestReading(matched);
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id =
      row?.id ||
      row?.uuid ||
      row?.tank_id ||
      row?.reading_id ||
      row?.user_id ||
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

async function fetchAdminRows(tableNames, limit = 300) {
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

async function fetchUserRows(tableNames, userId, limit = 220) {
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

async function fetchProfiles(currentUser) {
  if (currentUser.isAdmin) {
    return fetchAdminRows(["profiles"], 400);
  }

  const byId = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return {
      rows: [byId.data],
      tableUsed: "profiles",
    };
  }

  if (currentUser.email) {
    const byEmail = await supabase
      .from("profiles")
      .select("*")
      .ilike("email", currentUser.email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      return {
        rows: [byEmail.data],
        tableUsed: "profiles",
      };
    }
  }

  return {
    rows: [],
    tableUsed: "profiles",
  };
}

async function fetchRowsByScope(tableNames, currentUser, limit = 250) {
  if (currentUser.isAdmin) {
    return fetchAdminRows(tableNames, limit);
  }

  return fetchUserRows(tableNames, currentUser.id, limit);
}

function SummaryCard({ icon: Icon, label, value, helper, tone = "default" }) {
  return (
    <article className={`modern-tank-summary-card ${tone}`}>
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

function SensorMiniCard({ icon: Icon, label, value, status }) {
  const severity = getStatusSeverity([status]);

  return (
    <div>
      <Icon size={19} />
      <strong>{value}</strong>
      <span>{label}</span>
      <b className={`modern-tank-status ${severity}`}>{status}</b>
    </div>
  );
}

export default function TanksPage() {
  const [tanks, setTanks] = useState([]);
  const [readings, setReadings] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [sources, setSources] = useState({});
  const [scopeLabel, setScopeLabel] = useState("User view");
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

      const currentUser = await getCurrentUserWithRole();

      if (!currentUser.id) {
        setTanks([]);
        setReadings([]);
        setProfiles([]);
        setScopeLabel("No session");
        return;
      }

      const [tankResult, readingResult, profileResult] = await Promise.all([
        fetchRowsByScope(tankTables, currentUser, 300),
        fetchRowsByScope(readingTables, currentUser, 300),
        fetchProfiles(currentUser),
      ]);

      setTanks(tankResult.rows);
      setReadings(readingResult.rows);
      setProfiles(profileResult.rows);
      setSources({
        tanks: tankResult.tableUsed,
        readings: readingResult.tableUsed,
        profiles: profileResult.tableUsed,
      });
      setScopeLabel(
        currentUser.isAdmin ? "Admin all-records view" : "User account view"
      );
    } catch (error) {
      console.error("Tanks loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTanks();
  }, []);

  const profileMap = useMemo(() => {
    const map = new Map();

    profiles.forEach((profile) => {
      if (profile?.id) map.set(String(profile.id), profile);
      if (profile?.user_id) map.set(String(profile.user_id), profile);
      if (profile?.email) {
        map.set(String(profile.email).toLowerCase(), profile);
      }
    });

    return map;
  }, [profiles]);

  const enrichedTanks = useMemo(() => {
    return tanks.map((tank, index) => {
      const latestReading = getLatestReadingForTank(tank, readings);
      const normalized = normalizeSensorReading(latestReading);

      const readingStatus = latestReading
        ? getOverallReadingStatus(normalized)
        : "normal";

      const ownerId = getTankOwnerId(tank);
      const owner =
        profileMap.get(String(ownerId)) ||
        profileMap.get(String(tank?.email || "").toLowerCase()) ||
        null;

      return {
        tank,
        index,
        latestReading,
        normalized,
        id: getTankId(tank, index),
        name: getTankName(tank, index),
        type: getTankType(tank),
        ownerName: owner ? getProfileName(owner) : "Unknown owner",
        ownerEmail: owner?.email || tank?.email || "",
        status: readingStatus,
        lastSync:
          normalized.createdAt ||
          latestReading?.created_at ||
          tank?.updated_at ||
          tank?.created_at ||
          null,
      };
    });
  }, [tanks, readings, profileMap]);

  const tankTypes = useMemo(() => {
    return Array.from(new Set(enrichedTanks.map((item) => item.type))).filter(
      Boolean
    );
  }, [enrichedTanks]);

  const filteredTanks = useMemo(() => {
    return enrichedTanks.filter((item) => {
      const search = searchTerm.trim().toLowerCase();

      const searchableText = [
        item.name,
        item.type,
        item.ownerName,
        item.ownerEmail,
        item.status,
        item.normalized.temperatureLabel,
        item.normalized.temperatureStatus,
        item.normalized.phStatus,
        item.normalized.turbidityStatus,
        item.normalized.waterStatus,
        item.normalized.deviceUid,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !search || searchableText.includes(search);
      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;
      const matchesType = typeFilter === "all" || item.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [enrichedTanks, searchTerm, statusFilter, typeFilter]);

  const summary = useMemo(() => {
    const normal = enrichedTanks.filter((item) => item.status === "normal").length;
    const warning = enrichedTanks.filter((item) => item.status === "warning").length;
    const critical = enrichedTanks.filter((item) => item.status === "critical").length;
    const withReadings = enrichedTanks.filter((item) => item.latestReading).length;

    return {
      total: enrichedTanks.length,
      normal,
      warning,
      critical,
      withReadings,
    };
  }, [enrichedTanks]);

  if (isLoading) {
    return (
      <section className="modern-tank-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading tanks...</h3>
        <p>CrayThrive is syncing tank and latest sensor records.</p>
      </section>
    );
  }

  return (
    <div className="modern-tanks-page">
      <section className="modern-tanks-hero">
        <div>
          <p className="dashboard-eyebrow">Tank Monitoring</p>
          <h2>Monitor every crayfish tank clearly.</h2>
          <p>
            View tank records, owner details, latest IoT readings, and readable
            status strings for temperature, pH, turbidity, and water depth.
          </p>

          <div className="modern-tanks-actions">
            <button className="dashboard-primary-button" onClick={loadTanks}>
              <RefreshCw size={18} />
              Refresh Tanks
            </button>

            <span>
              Source: {sources.tanks || "tanks"} /{" "}
              {sources.readings || "sensor_readings"} • {scopeLabel}
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
          icon={Database}
          label="With Readings"
          value={summary.withReadings}
          helper="Tanks with latest IoT data"
        />

        <SummaryCard
          icon={CheckCircle2}
          label="Normal"
          value={summary.normal}
          helper="Healthy tank status"
          tone="success"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Warning"
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

      <section className="modern-tank-toolbar">
        <div className="modern-tank-search">
          <Search size={18} />
          <input
            placeholder="Search tank, owner, device, or status..."
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
            No tank records matched your current filters. Add tanks or sync IoT
            data first.
          </p>
        </section>
      ) : (
        <section className="modern-tank-grid">
          {filteredTanks.map((item) => (
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
                <span>
                  <UserRound size={14} />
                  {item.ownerName}
                </span>

                <span>
                  Device: {item.normalized.deviceUid || item.tank?.device_uid || "N/A"}
                </span>

                <span>Last sync: {formatReadingTime(item.lastSync)}</span>
              </div>

              <div className="modern-tank-reading-grid">
                <SensorMiniCard
                  icon={Thermometer}
                  label="Temperature"
                  value={item.normalized.temperatureLabel}
                  status={item.normalized.temperatureStatus}
                />

                <SensorMiniCard
                  icon={Droplets}
                  label="pH Status"
                  value={item.normalized.phStatus}
                  status={item.normalized.phStatus}
                />

                <SensorMiniCard
                  icon={Waves}
                  label="Turbidity Status"
                  value={item.normalized.turbidityStatus}
                  status={item.normalized.turbidityStatus}
                />

                <SensorMiniCard
                  icon={Gauge}
                  label="Water Depth"
                  value={item.normalized.waterLabel}
                  status={item.normalized.waterStatus}
                />
              </div>

              {!item.latestReading && (
                <div className="modern-tank-no-reading">
                  <AlertTriangle size={17} />
                  <span>No matching sensor reading found for this tank yet.</span>
                </div>
              )}

              <Link to={`/admin/tanks/${item.id}`} className="modern-tank-link">
                View Tank Details
                <ArrowRight size={18} />
              </Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
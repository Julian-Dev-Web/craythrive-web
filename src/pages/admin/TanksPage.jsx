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

/* =========================================================
   TABLES
========================================================= */

const tankTables = [
  "tanks",
  "user_tanks",
  "tank_profiles",
];

const readingTables = [
  "sensor_readings",
  "tank_readings",
  "readings",
];

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
];

/* =========================================================
   GENERAL HELPERS
========================================================= */

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function normalizeStatusText(value) {
  return lower(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}

function formatFriendlyText(value) {
  const text = clean(value);

  if (!text) {
    return "No Reading";
  }

  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

/* =========================================================
   pH NUMERIC VALUE
========================================================= */

function getPhNumericLabel(reading) {
  const raw = reading?.ph_value ?? reading?.ph;
  const numberValue = Number(raw);

  return Number.isFinite(numberValue)
    ? numberValue.toFixed(1)
    : null;
}

/* =========================================================
   STATUS
========================================================= */

function getStatusSeverity(statuses) {
  const joined = statuses
    .map(normalizeStatusText)
    .join(" ");

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

function getFriendlyTankStatus(status) {
  switch (status) {
    case "critical":
      return "Urgent";

    case "warning":
      return "Check";

    case "no-data":
      return "No Data";

    default:
      return "Good";
  }
}

/* =========================================================
   TANK HELPERS
========================================================= */

function getTankId(tank, index) {
  return (
    tank?.id ||
    tank?.tank_id ||
    tank?.uuid ||
    `tank-${index}`
  );
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
  return (
    tank?.type ||
    tank?.tank_type ||
    tank?.category ||
    "Crayfish Tank"
  );
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
    [profile?.first_name, profile?.last_name]
      .filter(Boolean)
      .join(" ") ||
    profile?.email ||
    "Unknown owner"
  );
}

/* =========================================================
   MATCH TANK TO SENSOR READINGS
========================================================= */

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
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== ""
    )
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
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== ""
    )
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

/* =========================================================
   pH SPIKE PROTECTION
========================================================= */

function toNumberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue)
    ? numberValue
    : null;
}

function getReadingPhValue(reading) {
  return toNumberOrNull(
    reading?.ph_value ??
      reading?.ph
  );
}

function isSafePhStatus(status) {
  const value =
    normalizeStatusText(status);

  return (
    value.includes("ideal") ||
    value.includes("safe") ||
    value.includes("normal")
  );
}

function isUnsafePhStatus(status) {
  const value =
    normalizeStatusText(status);

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
  if (!reading) {
    return false;
  }

  const phValue =
    getReadingPhValue(reading);

  const phStatus =
    reading?.ph_status || "";

  if (isSafePhStatus(phStatus)) {
    return false;
  }

  if (
    phValue !== null &&
    (phValue < 6.5 || phValue > 8.5)
  ) {
    return true;
  }

  return isUnsafePhStatus(phStatus);
}

function sortReadingsNewestFirst(
  readings = []
) {
  return [...readings].sort(
    (a, b) =>
      new Date(getReadingDate(b)) -
      new Date(getReadingDate(a))
  );
}

function pickStableLatestReading(
  readings = []
) {
  const sorted =
    sortReadingsNewestFirst(readings);

  if (sorted.length === 0) {
    return null;
  }

  const latest = sorted[0];

  if (!isUnsafePhReading(latest)) {
    return latest;
  }

  /*
   * Require three consecutive unsafe pH
   * readings before treating the newest
   * unsafe reading as confirmed.
   */
  const latestThree =
    sorted.slice(0, 3);

  const confirmedUnsafePh =
    latestThree.length >= 3 &&
    latestThree.every(
      isUnsafePhReading
    );

  if (confirmedUnsafePh) {
    return latest;
  }

  const newestSafeReading =
    sorted.find(
      (reading) =>
        !isUnsafePhReading(reading)
    );

  return newestSafeReading || latest;
}

function getLatestReadingForTank(
  tank,
  readings
) {
  const tankKeys =
    getTankMatchKeys(tank);

  const matched =
    readings.filter((reading) => {
      const readingKeys =
        getReadingMatchKeys(reading);

      return readingKeys.some(
        (key) =>
          tankKeys.includes(key)
      );
    });

  return pickStableLatestReading(
    matched
  );
}

/* =========================================================
   UNIQUE RECORDS
========================================================= */

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

  return Array.from(
    map.values()
  );
}

/* =========================================================
   CURRENT USER
========================================================= */

async function getCurrentUserWithRole() {
  const { data } =
    await supabase.auth.getSession();

  const user =
    data?.session?.user;

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

  if (
    !byId.error &&
    byId.data
  ) {
    profile = byId.data;
  }

  if (
    !profile &&
    user.email
  ) {
    const byEmail =
      await supabase
        .from("profiles")
        .select("id,email,role")
        .ilike(
          "email",
          user.email
        )
        .maybeSingle();

    if (
      !byEmail.error &&
      byEmail.data
    ) {
      profile =
        byEmail.data;
    }
  }

  const role =
    lower(profile?.role);

  return {
    id: user.id || "",
    email: user.email || "",
    role,
    isAdmin:
      role === "admin",
  };
}

/* =========================================================
   DATABASE FETCH
========================================================= */

async function fetchAdminRows(
  tableNames,
  limit = 300
) {
  for (const tableName of tableNames) {
    const ordered =
      await supabase
        .from(tableName)
        .select("*")
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .limit(limit);

    if (
      !ordered.error &&
      Array.isArray(
        ordered.data
      )
    ) {
      return {
        rows: uniqueRows(
          ordered.data
        ),
        tableUsed:
          tableName,
      };
    }

    const plain =
      await supabase
        .from(tableName)
        .select("*")
        .limit(limit);

    if (
      !plain.error &&
      Array.isArray(
        plain.data
      )
    ) {
      return {
        rows: uniqueRows(
          plain.data
        ),
        tableUsed:
          tableName,
      };
    }
  }

  return {
    rows: [],
    tableUsed:
      tableNames[0],
  };
}

async function fetchUserRows(
  tableNames,
  userId,
  limit = 220
) {
  for (const tableName of tableNames) {
    const mergedRows = [];

    let successful = false;

    for (
      const column
      of userFilterColumns
    ) {
      const ordered =
        await supabase
          .from(tableName)
          .select("*")
          .eq(
            column,
            userId
          )
          .order(
            "created_at",
            {
              ascending:
                false,
            }
          )
          .limit(limit);

      if (
        !ordered.error &&
        Array.isArray(
          ordered.data
        )
      ) {
        successful = true;

        mergedRows.push(
          ...ordered.data
        );

        continue;
      }

      const plain =
        await supabase
          .from(tableName)
          .select("*")
          .eq(
            column,
            userId
          )
          .limit(limit);

      if (
        !plain.error &&
        Array.isArray(
          plain.data
        )
      ) {
        successful = true;

        mergedRows.push(
          ...plain.data
        );
      }
    }

    if (successful) {
      return {
        rows:
          uniqueRows(
            mergedRows
          ),

        tableUsed:
          tableName,
      };
    }
  }

  return {
    rows: [],
    tableUsed:
      tableNames[0],
  };
}

async function fetchProfiles(
  currentUser
) {
  if (currentUser.isAdmin) {
    return fetchAdminRows(
      ["profiles"],
      400
    );
  }

  const byId =
    await supabase
      .from("profiles")
      .select("*")
      .eq(
        "id",
        currentUser.id
      )
      .maybeSingle();

  if (
    !byId.error &&
    byId.data
  ) {
    return {
      rows: [byId.data],
      tableUsed:
        "profiles",
    };
  }

  if (currentUser.email) {
    const byEmail =
      await supabase
        .from("profiles")
        .select("*")
        .ilike(
          "email",
          currentUser.email
        )
        .maybeSingle();

    if (
      !byEmail.error &&
      byEmail.data
    ) {
      return {
        rows: [
          byEmail.data,
        ],
        tableUsed:
          "profiles",
      };
    }
  }

  return {
    rows: [],
    tableUsed:
      "profiles",
  };
}

async function fetchRowsByScope(
  tableNames,
  currentUser,
  limit = 250
) {
  if (currentUser.isAdmin) {
    return fetchAdminRows(
      tableNames,
      limit
    );
  }

  return fetchUserRows(
    tableNames,
    currentUser.id,
    limit
  );
}

/* =========================================================
   SMALL UI COMPONENTS
========================================================= */

function SummaryCard({
  icon: Icon,
  label,
  value,
  helper,
  tone = "default",
}) {
  return (
    <article
      className={`modern-tank-summary-card ${tone}`}
    >
      <span>
        <Icon size={21} />
      </span>

      <div>
        <strong>
          {value}
        </strong>

        <p>
          {label}
        </p>

        <small>
          {helper}
        </small>
      </div>
    </article>
  );
}

function SensorMiniCard({
  icon: Icon,
  label,
  value,
  status,
}) {
  const hasStatus =
    clean(status) &&
    lower(status) !== "no reading";

  const severity =
    hasStatus
      ? getStatusSeverity(
          [status]
        )
      : "no-data";

  return (
    <div className="modern-tank-sensor-card">
      <Icon size={19} />

      <span>
        {label}
      </span>

      <strong>
        {formatFriendlyText(
          value
        )}
      </strong>

      <b
        className={`modern-tank-status ${severity}`}
      >
        {hasStatus
          ? formatFriendlyText(
              status
            )
          : "No Reading"}
      </b>
    </div>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function TanksPage() {
  const [tanks, setTanks] =
    useState([]);

  const [readings, setReadings] =
    useState([]);

  const [profiles, setProfiles] =
    useState([]);

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("all");

  const [
    typeFilter,
    setTypeFilter,
  ] = useState("all");

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  /* =======================================================
     LOAD
  ======================================================= */

  const loadTanks = async () => {
    if (
      !isSupabaseConfigured ||
      !supabase
    ) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser =
        await getCurrentUserWithRole();

      if (!currentUser.id) {
        setTanks([]);
        setReadings([]);
        setProfiles([]);

        return;
      }

      const [
        tankResult,
        readingResult,
        profileResult,
      ] = await Promise.all([
        fetchRowsByScope(
          tankTables,
          currentUser,
          300
        ),

        fetchRowsByScope(
          readingTables,
          currentUser,
          300
        ),

        fetchProfiles(
          currentUser
        ),
      ]);

      setTanks(
        tankResult.rows
      );

      setReadings(
        readingResult.rows
      );

      setProfiles(
        profileResult.rows
      );
    } catch (error) {
      console.error(
        "Tanks loading error:",
        error
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTanks();
  }, []);

  /* =======================================================
     PROFILE LOOKUP
  ======================================================= */

  const profileMap =
    useMemo(() => {
      const map =
        new Map();

      profiles.forEach(
        (profile) => {
          if (profile?.id) {
            map.set(
              String(
                profile.id
              ),
              profile
            );
          }

          if (
            profile?.user_id
          ) {
            map.set(
              String(
                profile.user_id
              ),
              profile
            );
          }

          if (
            profile?.email
          ) {
            map.set(
              String(
                profile.email
              ).toLowerCase(),
              profile
            );
          }
        }
      );

      return map;
    }, [profiles]);

  /* =======================================================
     ENRICH TANKS
  ======================================================= */

  const enrichedTanks =
    useMemo(() => {
      return tanks.map(
        (tank, index) => {
          const latestReading =
            getLatestReadingForTank(
              tank,
              readings
            );

          const normalized =
            normalizeSensorReading(
              latestReading
            );

          /*
           * A tank with no reading should
           * NOT be shown as "normal".
           */
          const readingStatus =
            latestReading
              ? getOverallReadingStatus(
                  normalized
                )
              : "no-data";

          const ownerId =
            getTankOwnerId(
              tank
            );

          const owner =
            profileMap.get(
              String(
                ownerId
              )
            ) ||
            profileMap.get(
              String(
                tank?.email ||
                  ""
              ).toLowerCase()
            ) ||
            null;

          return {
            tank,

            index,

            latestReading,

            normalized,

            id:
              getTankId(
                tank,
                index
              ),

            name:
              getTankName(
                tank,
                index
              ),

            type:
              getTankType(
                tank
              ),

            ownerName:
              owner
                ? getProfileName(
                    owner
                  )
                : "Unknown owner",

            ownerEmail:
              owner?.email ||
              tank?.email ||
              "",

            status:
              readingStatus,

            lastSync:
              normalized.createdAt ||
              latestReading
                ?.created_at ||
              tank?.updated_at ||
              tank?.created_at ||
              null,
          };
        }
      );
    }, [
      tanks,
      readings,
      profileMap,
    ]);

  /* =======================================================
     TYPES
  ======================================================= */

  const tankTypes =
    useMemo(() => {
      return Array.from(
        new Set(
          enrichedTanks.map(
            (item) =>
              item.type
          )
        )
      ).filter(Boolean);
    }, [enrichedTanks]);

  /* =======================================================
     FILTERING
  ======================================================= */

  const filteredTanks =
    useMemo(() => {
      return enrichedTanks.filter(
        (item) => {
          const search =
            searchTerm
              .trim()
              .toLowerCase();

          const searchableText =
            [
              item.name,
              item.type,
              item.ownerName,
              item.ownerEmail,
              item.status,

              item.normalized
                .temperatureLabel,

              item.normalized
                .temperatureStatus,

              item.normalized
                .phStatus,

              item.normalized
                .turbidityStatus,

              item.normalized
                .waterStatus,

              item.normalized
                .deviceUid,
            ]
              .join(" ")
              .toLowerCase();

          const matchesSearch =
            !search ||
            searchableText.includes(
              search
            );

          const matchesStatus =
            statusFilter ===
              "all" ||
            item.status ===
              statusFilter;

          const matchesType =
            typeFilter ===
              "all" ||
            item.type ===
              typeFilter;

          return (
            matchesSearch &&
            matchesStatus &&
            matchesType
          );
        }
      );
    }, [
      enrichedTanks,
      searchTerm,
      statusFilter,
      typeFilter,
    ]);

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary =
    useMemo(() => {
      const normal =
        enrichedTanks.filter(
          (item) =>
            item.status ===
            "normal"
        ).length;

      const warning =
        enrichedTanks.filter(
          (item) =>
            item.status ===
            "warning"
        ).length;

      const critical =
        enrichedTanks.filter(
          (item) =>
            item.status ===
            "critical"
        ).length;

      const noData =
        enrichedTanks.filter(
          (item) =>
            item.status ===
            "no-data"
        ).length;

      return {
        total:
          enrichedTanks.length,

        normal,

        warning,

        critical,

        noData,
      };
    }, [enrichedTanks]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="modern-tank-loading">
        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading your tanks...
        </h3>

        <p>
          Getting the latest
          tank information.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="modern-tanks-page">

      {/* ===============================================
          HEADER
      ================================================ */}

      <section className="modern-tanks-hero">

        <div>
          <p className="dashboard-eyebrow">
            My Tanks
          </p>

          <h2>
            Check your tanks at a glance.
          </h2>

          <p>
            Quickly see which tanks are doing
            well and which ones may need your
            attention.
          </p>

          <div className="modern-tanks-actions">

            <button
              type="button"
              className="dashboard-primary-button"
              onClick={loadTanks}
            >
              <RefreshCw
                size={18}
              />

              Refresh
            </button>

            <span>
              {summary.total === 1
                ? "1 tank registered"
                : `${summary.total} tanks registered`}
            </span>
          </div>
        </div>

        <div className="modern-tanks-hero-card">

          <Droplets
            size={34}
          />

          <strong>
            {summary.total}
          </strong>

          <span>
            Total Tanks
          </span>
        </div>
      </section>

      {/* ===============================================
          SIMPLE SUMMARY
      ================================================ */}

      <section className="modern-tank-summary-grid">

        <SummaryCard
          icon={CheckCircle2}
          label="Doing Well"
          value={summary.normal}
          helper="No current issues"
          tone="success"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Needs Checking"
          value={summary.warning}
          helper="Keep an eye on these tanks"
          tone="warning"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Urgent"
          value={summary.critical}
          helper="Check these tanks soon"
          tone="danger"
        />

        <SummaryCard
          icon={Database}
          label="No Recent Data"
          value={summary.noData}
          helper="Waiting for sensor readings"
        />
      </section>

      {/* ===============================================
          SEARCH / FILTER
      ================================================ */}

      <section className="modern-tank-toolbar">

        <div className="modern-tank-search">

          <Search size={18} />

          <input
            type="search"
            placeholder="Search tank name or type..."
            value={searchTerm}
            onChange={(event) =>
              setSearchTerm(
                event.target.value
              )
            }
          />
        </div>

        <label className="modern-tank-filter">

          <Filter size={18} />

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value
              )
            }
          >
            <option value="all">
              All Conditions
            </option>

            <option value="normal">
              Doing Well
            </option>

            <option value="warning">
              Needs Checking
            </option>

            <option value="critical">
              Urgent
            </option>

            <option value="no-data">
              No Recent Data
            </option>
          </select>
        </label>

        <label className="modern-tank-filter">

          <Droplets size={18} />

          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(
                event.target.value
              )
            }
          >
            <option value="all">
              All Tank Types
            </option>

            {tankTypes.map(
              (type) => (
                <option
                  key={type}
                  value={type}
                >
                  {type}
                </option>
              )
            )}
          </select>
        </label>
      </section>

      {/* ===============================================
          EMPTY
      ================================================ */}

      {filteredTanks.length === 0 ? (
        <section className="modern-tank-empty">

          <Droplets
            size={34}
          />

          <h3>
            No tanks found
          </h3>

          <p>
            Try changing your search or filter
            to find another tank.
          </p>
        </section>
      ) : (

        /* =============================================
            TANK LIST
        ============================================== */

        <section className="modern-tank-grid">

          {filteredTanks.map(
            (item) => (
              <article
                className="modern-tank-card"
                key={item.id}
              >

                {/* HEADER */}

                <div className="modern-tank-card-top">

                  <div>
                    <span className="modern-tank-type">
                      {formatFriendlyText(
                        item.type
                      )}
                    </span>

                    <h3>
                      {item.name}
                    </h3>
                  </div>

                  <b
                    className={`modern-tank-status ${item.status}`}
                  >
                    {getFriendlyTankStatus(
                      item.status
                    )}
                  </b>
                </div>

                {/* LAST UPDATE */}

                <div className="modern-tank-friendly-sync">

                  {item.latestReading ? (
                    <>
                      Latest update:{" "}
                      <strong>
                        {formatReadingTime(
                          item.lastSync
                        )}
                      </strong>
                    </>
                  ) : (
                    "Waiting for sensor data"
                  )}
                </div>

                {/* SENSOR CARDS */}

                <div className="modern-tank-reading-grid">

                  <SensorMiniCard
                    icon={
                      Thermometer
                    }
                    label="Temperature"
                    value={
                      item.normalized
                        .temperatureLabel
                    }
                    status={
                      item.normalized
                        .temperatureStatus
                    }
                  />

                  <SensorMiniCard
                    icon={
                      Droplets
                    }
                    label="pH Level"
                    value={
                      getPhNumericLabel(
                        item.latestReading
                      ) ||
                      item.normalized
                        .phStatus
                    }
                    status={
                      item.normalized
                        .phStatus
                    }
                  />

                  <SensorMiniCard
                    icon={
                      Waves
                    }
                    label="Water Clarity"
                    value={
                      item.normalized
                        .turbidityStatus
                    }
                    status={
                      item.normalized
                        .turbidityStatus
                    }
                  />

                  <SensorMiniCard
                    icon={
                      Gauge
                    }
                    label="Water Level"
                    value={
                      item.normalized
                        .waterLabel
                    }
                    status={
                      item.normalized
                        .waterStatus
                    }
                  />
                </div>

                {/* NO DATA WARNING */}

                {!item.latestReading && (
                  <div className="modern-tank-no-reading">

                    <AlertTriangle
                      size={17}
                    />

                    <span>
                      No recent sensor reading
                      is available for this tank.
                    </span>
                  </div>
                )}

                {/* OPTIONAL TECHNICAL INFO */}

                <details className="modern-tank-more-info">

                  <summary>
                    More information
                  </summary>

                  <div className="modern-tank-more-content">

                    <div>
                      <UserRound
                        size={16}
                      />

                      <span>
                        <small>
                          Owner
                        </small>

                        <strong>
                          {item.ownerName}
                        </strong>
                      </span>
                    </div>

                    <div>
                      <Database
                        size={16}
                      />

                      <span>
                        <small>
                          Connected Device
                        </small>

                        <strong>
                          {item.normalized
                            .deviceUid ||
                            item.tank
                              ?.device_uid ||
                            "Not connected"}
                        </strong>
                      </span>
                    </div>
                  </div>
                </details>

                {/* DETAILS */}

                <Link
                  to={`/admin/tanks/${item.id}`}
                  className="modern-tank-link"
                >
                  View Tank

                  <ArrowRight
                    size={18}
                  />
                </Link>
              </article>
            )
          )}
        </section>
      )}
    </div>
  );
}
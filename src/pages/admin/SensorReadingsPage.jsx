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

/* =========================================================
   TABLES
========================================================= */

const readingTables = [
  "sensor_readings",
  "tank_readings",
  "readings",
];

const tankTables = [
  "tanks",
  "user_tanks",
  "tank_profiles",
];

const READINGS_PER_PAGE = 10;

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
];

/* =========================================================
   FILTER OPTIONS
========================================================= */

const sensorOptions = [
  {
    value: "all",
    label: "All Water Data",
  },
  {
    value: "temperature",
    label: "Temperature",
  },
  {
    value: "ph",
    label: "pH Level",
  },
  {
    value: "turbidity",
    label: "Water Clarity",
  },
  {
    value: "water_depth",
    label: "Water Level",
  },
  {
    value: "issues",
    label: "Needs Attention",
  },
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

function formatDate(value) {
  if (!value) {
    return "No date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No date";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

function getFriendlyStatus(status) {
  if (status === "critical") {
    return "Urgent";
  }

  if (status === "warning") {
    return "Check";
  }

  return "Good";
}

function getSeverityRank(severity) {
  if (severity === "critical") {
    return 1;
  }

  if (severity === "warning") {
    return 2;
  }

  if (severity === "normal") {
    return 3;
  }

  return 4;
}

/* =========================================================
   SENSOR FOCUS
========================================================= */

function getSensorFocus(item, sensorFilter) {
  const normalized = item.normalized;

  if (sensorFilter === "temperature") {
    return {
      label: "Temperature",
      value: normalized.temperatureLabel,
      status: normalized.temperatureStatus,
      severity: getStatusSeverity([
        normalized.temperatureStatus,
      ]),
      hasValue:
        normalized.temperatureValue !== null &&
        normalized.temperatureValue !== undefined &&
        normalized.temperatureValue !== "",
    };
  }

  if (sensorFilter === "ph") {
    return {
      label: "pH Level",
      value: normalized.phStatus,
      status: normalized.phStatus,
      severity: getStatusSeverity([
        normalized.phStatus,
      ]),
      hasValue:
        normalized.phStatus !== "No Reading",
    };
  }

  if (sensorFilter === "turbidity") {
    return {
      label: "Water Clarity",
      value: normalized.turbidityStatus,
      status: normalized.turbidityStatus,
      severity: getStatusSeverity([
        normalized.turbidityStatus,
      ]),
      hasValue:
        normalized.turbidityStatus !== "No Reading",
    };
  }

  if (sensorFilter === "water_depth") {
    return {
      label: "Water Level",
      value: normalized.waterLabel,
      status: normalized.waterStatus,
      severity: getStatusSeverity([
        normalized.waterStatus,
      ]),
      hasValue:
        normalized.waterValue !== null &&
        normalized.waterValue !== undefined &&
        normalized.waterValue !== "",
    };
  }

  return {
    label: "Overall Status",
    value: item.status,
    status: item.status,
    severity: item.status,
    hasValue: true,
  };
}

/* =========================================================
   AVERAGES
========================================================= */

function averageFromNormalized(items, key) {
  const values = items
    .map((item) =>
      toNumberOrNull(
        item.normalized[key]
      )
    )
    .filter(
      (value) =>
        value !== null
    );

  if (!values.length) {
    return "N/A";
  }

  const total = values.reduce(
    (sum, value) =>
      sum + value,
    0
  );

  return (
    total / values.length
  ).toFixed(2);
}

/* =========================================================
   TANK NAME RESOLUTION
========================================================= */

function getTankIdValues(tank) {
  return [
    tank?.id,
    tank?.tank_id,
    tank?.uuid,
    tank?.device_uid,
    tank?.iot_device_id,
    tank?.device_id,
  ]
    .filter(Boolean)
    .map(String);
}

function getReadingTankValues(reading) {
  return [
    reading?.tank_id,
    reading?.tankId,
    reading?.tank_uuid,
    reading?.tank_profile_id,
    reading?.device_uid,
    reading?.iot_device_id,
    reading?.device_id,
  ]
    .filter(Boolean)
    .map(String);
}

function getTankDisplayName(
  reading,
  tanks,
  index
) {
  const directName =
    reading?.tank_name ||
    reading?.tank_label ||
    reading?.tank_display_name ||
    reading?.name;

  if (directName) {
    return directName;
  }

  const readingKeys =
    getReadingTankValues(
      reading
    );

  const matchedTank =
    tanks.find((tank) => {
      const tankKeys =
        getTankIdValues(
          tank
        );

      return readingKeys.some(
        (key) =>
          tankKeys.includes(
            key
          )
      );
    });

  if (matchedTank) {
    return (
      matchedTank?.name ||
      matchedTank?.tank_name ||
      matchedTank?.title ||
      matchedTank?.label ||
      `Tank ${index + 1}`
    );
  }

  return `Tank ${index + 1}`;
}

/* =========================================================
   UNIQUE ROWS
========================================================= */

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach(
    (row, index) => {
      const id =
        row?.id ||
        row?.uuid ||
        row?.reading_id ||
        row?.tank_id ||
        row?.created_at ||
        row?.device_uid ||
        `row-${index}`;

      map.set(
        String(id),
        row
      );
    }
  );

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

  const byId =
    await supabase
      .from("profiles")
      .select(
        "id,email,role"
      )
      .eq(
        "id",
        user.id
      )
      .maybeSingle();

  if (
    !byId.error &&
    byId.data
  ) {
    profile =
      byId.data;
  }

  if (
    !profile &&
    user.email
  ) {
    const byEmail =
      await supabase
        .from("profiles")
        .select(
          "id,email,role"
        )
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
    lower(
      profile?.role
    );

  return {
    id:
      user.id || "",

    email:
      user.email || "",

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
  limit = 500
) {
  for (
    const tableName
    of tableNames
  ) {
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
        rows:
          uniqueRows(
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
        rows:
          uniqueRows(
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
  limit = 300
) {
  for (
    const tableName
    of tableNames
  ) {
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
        successful =
          true;

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
        successful =
          true;

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

/* =========================================================
   SMALL COMPONENTS
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
      className={`modern-reading-summary-card ${tone}`}
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

function MetricCard({
  icon: Icon,
  label,
  value,
  status,
}) {
  const severity =
    status
      ? getStatusSeverity(
          [status]
        )
      : "normal";

  return (
    <div className="modern-reading-metric">

      <span className="modern-reading-metric-icon">
        <Icon size={20} />
      </span>

      <div>
        <small>
          {label}
        </small>

        <strong>
          {formatFriendlyText(
            value
          )}
        </strong>

        {status && (
          <b
            className={`modern-reading-status ${severity}`}
          >
            {formatFriendlyText(
              status
            )}
          </b>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function SensorReadingsPage() {
  const [
    readings,
    setReadings,
  ] = useState([]);

  const [
    tanks,
    setTanks,
  ] = useState([]);

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("all");

  const [
    sensorFilter,
    setSensorFilter,
  ] = useState("all");

  const [
    readingsPage,
    setReadingsPage,
  ] = useState(1);

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  /* =======================================================
     LOAD
  ======================================================= */

  const loadReadings = async () => {
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

      if (
        !currentUser.id
      ) {
        setReadings([]);
        setTanks([]);
        return;
      }

      const [
        readingResult,
        tankResult,
      ] = await Promise.all([
        currentUser.isAdmin
          ? fetchAdminRows(
              readingTables
            )
          : fetchUserRows(
              readingTables,
              currentUser.id
            ),

        currentUser.isAdmin
          ? fetchAdminRows(
              tankTables,
              300
            )
          : fetchUserRows(
              tankTables,
              currentUser.id,
              300
            ),
      ]);

      setReadings(
        readingResult.rows
      );

      setTanks(
        tankResult.rows
      );

      setLastUpdated(
        new Date()
      );
    } catch (error) {
      console.error(
        "Readings loading error:",
        error
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReadings();
  }, []);

  useEffect(() => {
    setReadingsPage(1);
  }, [
    searchTerm,
    statusFilter,
    sensorFilter,
  ]);

  /* =======================================================
     ENRICH READINGS
  ======================================================= */

  const enrichedReadings =
    useMemo(() => {
      return readings.map(
        (
          reading,
          index
        ) => {
          const normalized =
            normalizeSensorReading(
              reading
            );

          const status =
            getOverallReadingStatus(
              normalized
            );

          const tankName =
            getTankDisplayName(
              reading,
              tanks,
              index
            );

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
            tankName:
              String(
                tankName
              ),
            date,
          };
        }
      );
    }, [
      readings,
      tanks,
    ]);

  /* =======================================================
     FILTERED READINGS
  ======================================================= */

  const filteredReadings =
    useMemo(() => {
      const filtered =
        enrichedReadings.filter(
          (item) => {
            const search =
              searchTerm
                .trim()
                .toLowerCase();

            const normalized =
              item.normalized;

            const focus =
              getSensorFocus(
                item,
                sensorFilter
              );

            const searchableText =
              [
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
              ]
                .join(" ")
                .toLowerCase();

            const matchesSearch =
              !search ||
              searchableText.includes(
                search
              );

            const selectedSeverity =
              sensorFilter ===
                "all" ||
              sensorFilter ===
                "issues"
                ? item.status
                : focus.severity;

            const matchesStatus =
              statusFilter ===
                "all" ||
              selectedSeverity ===
                statusFilter;

            const matchesSensor =
              sensorFilter ===
                "all" ||
              (sensorFilter ===
                "issues" &&
                [
                  "warning",
                  "critical",
                ].includes(
                  item.status
                )) ||
              focus.hasValue;

            return (
              matchesSearch &&
              matchesStatus &&
              matchesSensor
            );
          }
        );

      return filtered.sort(
        (a, b) => {
          const focusA =
            getSensorFocus(
              a,
              sensorFilter
            );

          const focusB =
            getSensorFocus(
              b,
              sensorFilter
            );

          const severityA =
            sensorFilter ===
              "all" ||
            sensorFilter ===
              "issues"
              ? a.status
              : focusA.severity;

          const severityB =
            sensorFilter ===
              "all" ||
            sensorFilter ===
              "issues"
              ? b.status
              : focusB.severity;

          const rankDifference =
            getSeverityRank(
              severityA
            ) -
            getSeverityRank(
              severityB
            );

          if (
            rankDifference !==
            0
          ) {
            return rankDifference;
          }

          return (
            new Date(
              b.date || 0
            ) -
            new Date(
              a.date || 0
            )
          );
        }
      );
    }, [
      enrichedReadings,
      searchTerm,
      statusFilter,
      sensorFilter,
    ]);

  /* =======================================================
     PAGINATION
  ======================================================= */

  const totalReadingPages =
    Math.max(
      1,
      Math.ceil(
        filteredReadings.length /
          READINGS_PER_PAGE
      )
    );

  const currentReadingPage =
    Math.min(
      readingsPage,
      totalReadingPages
    );

  const paginatedReadings =
    filteredReadings.slice(
      (currentReadingPage -
        1) *
        READINGS_PER_PAGE,

      currentReadingPage *
        READINGS_PER_PAGE
    );

  const showingStart =
    filteredReadings.length ===
    0
      ? 0
      : (currentReadingPage -
          1) *
          READINGS_PER_PAGE +
        1;

  const showingEnd =
    Math.min(
      currentReadingPage *
        READINGS_PER_PAGE,
      filteredReadings.length
    );

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary =
    useMemo(() => {
      const normal =
        enrichedReadings.filter(
          (item) =>
            item.status ===
            "normal"
        ).length;

      const warning =
        enrichedReadings.filter(
          (item) =>
            item.status ===
            "warning"
        ).length;

      const critical =
        enrichedReadings.filter(
          (item) =>
            item.status ===
            "critical"
        ).length;

      return {
        total:
          enrichedReadings.length,

        normal,

        warning,

        critical,

        avgTemp:
          averageFromNormalized(
            enrichedReadings,
            "temperatureValue"
          ),

        avgWaterDepth:
          averageFromNormalized(
            enrichedReadings,
            "waterValue"
          ),
      };
    }, [enrichedReadings]);

  const latestReading =
    enrichedReadings[0] ||
    null;

  const selectedSensorLabel =
    sensorOptions.find(
      (option) =>
        option.value ===
        sensorFilter
    )?.label ||
    "All Water Data";

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="modern-reading-loading">

        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading water readings...
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
    <div className="modern-readings-page">

      {/* ===============================================
          HERO
      ================================================ */}

      <section className="modern-readings-hero">

        <div>

          <p className="dashboard-eyebrow">
            Water Readings
          </p>

          <h2>
            Check your water condition
            without the technical clutter.
          </h2>

          <p>
            Review temperature, pH,
            water clarity, and water
            level for your tanks.
            Problems are placed first so
            they are easier to notice.
          </p>

          <div className="modern-readings-actions">

            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                loadReadings
              }
            >
              <RefreshCw
                size={18}
              />

              Refresh
            </button>

            <span>
              {lastUpdated
                ? `Updated ${formatReadingTime(
                    lastUpdated
                  )}`
                : "Waiting for latest data"}
            </span>
          </div>
        </div>

        <div className="modern-readings-live-card">

          <Activity
            size={34}
          />

          <strong>
            {summary.total}
          </strong>

          <span>
            Water readings
          </span>
        </div>
      </section>

      {/* ===============================================
          SUMMARY
      ================================================ */}

      <section className="modern-reading-summary-grid">

        <SummaryCard
          icon={CheckCircle2}
          label="Good"
          value={
            summary.normal
          }
          helper="Normal water conditions"
          tone="success"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Needs Checking"
          value={
            summary.warning
          }
          helper="Conditions to watch"
          tone="warning"
        />

        <SummaryCard
          icon={AlertTriangle}
          label="Urgent"
          value={
            summary.critical
          }
          helper="Needs attention soon"
          tone="danger"
        />

        <SummaryCard
          icon={Database}
          label="Total Records"
          value={
            summary.total
          }
          helper="Saved water readings"
        />
      </section>

      {/* ===============================================
          LATEST SNAPSHOT
      ================================================ */}

      <section className="modern-readings-grid">

        <article className="modern-readings-panel">

          <div className="modern-panel-heading">

            <div>
              <p className="dashboard-eyebrow">
                Water Overview
              </p>

              <h3>
                Latest condition
              </h3>
            </div>

            <Gauge
              size={22}
            />
          </div>

          <div className="modern-reading-metric-grid">

            <MetricCard
              icon={
                Thermometer
              }
              label="Average Temperature"
              value={
                summary.avgTemp ===
                "N/A"
                  ? "No Data"
                  : `${summary.avgTemp}°C`
              }
              status={
                latestReading
                  ?.normalized
                  ?.temperatureStatus ||
                "No Reading"
              }
            />

            <MetricCard
              icon={
                Droplets
              }
              label="pH Level"
              value={
                latestReading
                  ?.normalized
                  ?.phStatus ||
                "No Reading"
              }
              status={
                latestReading
                  ?.normalized
                  ?.phStatus ||
                "No Reading"
              }
            />

            <MetricCard
              icon={Waves}
              label="Water Clarity"
              value={
                latestReading
                  ?.normalized
                  ?.turbidityStatus ||
                "No Reading"
              }
              status={
                latestReading
                  ?.normalized
                  ?.turbidityStatus ||
                "No Reading"
              }
            />

            <MetricCard
              icon={Gauge}
              label="Average Water Level"
              value={
                summary.avgWaterDepth ===
                "N/A"
                  ? "No Data"
                  : `${summary.avgWaterDepth} cm`
              }
              status={
                latestReading
                  ?.normalized
                  ?.waterStatus ||
                "No Reading"
              }
            />
          </div>
        </article>

        {/* LATEST SYNC */}

        <article className="modern-readings-panel">

          <div className="modern-panel-heading">

            <div>
              <p className="dashboard-eyebrow">
                Latest Update
              </p>

              <h3>
                Most recent tank
              </h3>
            </div>

            <Activity
              size={22}
            />
          </div>

          {latestReading ? (
            <div className="modern-latest-reading">

              <span className="modern-latest-reading-icon">
                <Droplets
                  size={22}
                />
              </span>

              <div>
                <strong>
                  {
                    latestReading.tankName
                  }
                </strong>

                <span>
                  {formatReadingTime(
                    latestReading.date
                  )}
                </span>
              </div>

              <b
                className={`modern-reading-status ${latestReading.status}`}
              >
                {getFriendlyStatus(
                  latestReading.status
                )}
              </b>
            </div>
          ) : (
            <div className="modern-reading-empty-small">

              <Droplets
                size={25}
              />

              <span>
                No water reading yet.
              </span>
            </div>
          )}
        </article>
      </section>

      {/* ===============================================
          FILTERS
      ================================================ */}

      <section className="modern-reading-toolbar">

        <div className="modern-reading-search">

          <Search
            size={18}
          />

          <input
            type="search"
            placeholder="Search tank name or condition..."
            value={
              searchTerm
            }
            onChange={(
              event
            ) =>
              setSearchTerm(
                event.target.value
              )
            }
          />
        </div>

        <label className="modern-reading-filter">

          <Filter
            size={18}
          />

          <select
            value={
              statusFilter
            }
            onChange={(
              event
            ) =>
              setStatusFilter(
                event.target.value
              )
            }
          >
            <option value="all">
              All Conditions
            </option>

            <option value="normal">
              Good
            </option>

            <option value="warning">
              Needs Checking
            </option>

            <option value="critical">
              Urgent
            </option>
          </select>
        </label>

        <label className="modern-reading-filter">

          <Database
            size={18}
          />

          <select
            value={
              sensorFilter
            }
            onChange={(
              event
            ) =>
              setSensorFilter(
                event.target.value
              )
            }
          >
            {sensorOptions.map(
              (option) => (
                <option
                  key={
                    option.value
                  }
                  value={
                    option.value
                  }
                >
                  {
                    option.label
                  }
                </option>
              )
            )}
          </select>
        </label>
      </section>

      {/* ===============================================
          EMPTY
      ================================================ */}

      {filteredReadings.length ===
      0 ? (
        <section className="modern-reading-empty">

          <Database
            size={34}
          />

          <h3>
            No readings found
          </h3>

          <p>
            Try another search or
            change your filters.
          </p>
        </section>
      ) : (

        /* =============================================
            TABLE
        ============================================== */

        <section className="modern-reading-table-card">

          <div className="modern-reading-table-title">

            <div>
              <span>
                Reading History
              </span>

              <h3>
                Water records
              </h3>
            </div>

            <small>
              {
                selectedSensorLabel
              }
            </small>
          </div>

          <div className="modern-reading-table-header">

            <span>
              Tank
            </span>

            <span>
              Temperature
            </span>

            <span>
              pH
            </span>

            <span>
              Water Clarity
            </span>

            <span>
              Water Level
            </span>

            <span>
              Status
            </span>

            <span>
              Date
            </span>
          </div>

          <div className="modern-reading-table-body">

            {paginatedReadings.map(
              (item) => {
                const normalized =
                  item.normalized;

                const row =
                  item.reading;

                const focus =
                  getSensorFocus(
                    item,
                    sensorFilter
                  );

                const displaySeverity =
                  sensorFilter ===
                    "all" ||
                  sensorFilter ===
                    "issues"
                    ? item.status
                    : focus.severity;

                return (
                  <div
                    className="modern-reading-table-row"
                    key={
                      row?.id ||
                      item.index
                    }
                  >

                    <span data-label="Tank">

                      <strong>
                        {
                          item.tankName
                        }
                      </strong>
                    </span>

                    <span data-label="Temperature">

                      {
                        normalized.temperatureLabel
                      }

                      <small>
                        {formatFriendlyText(
                          normalized.temperatureStatus
                        )}
                      </small>
                    </span>

                    <span data-label="pH">

                      <b
                        className={`modern-reading-status ${getStatusSeverity(
                          [
                            normalized.phStatus,
                          ]
                        )}`}
                      >
                        {formatFriendlyText(
                          normalized.phStatus
                        )}
                      </b>
                    </span>

                    <span data-label="Water Clarity">

                      <b
                        className={`modern-reading-status ${getStatusSeverity(
                          [
                            normalized.turbidityStatus,
                          ]
                        )}`}
                      >
                        {formatFriendlyText(
                          normalized.turbidityStatus
                        )}
                      </b>
                    </span>

                    <span data-label="Water Level">

                      {
                        normalized.waterLabel
                      }

                      <small>
                        {formatFriendlyText(
                          normalized.waterStatus
                        )}
                      </small>
                    </span>

                    <span data-label="Status">

                      <b
                        className={`modern-reading-status ${displaySeverity}`}
                      >
                        {sensorFilter ===
                          "all" ||
                        sensorFilter ===
                          "issues"
                          ? getFriendlyStatus(
                              item.status
                            )
                          : formatFriendlyText(
                              focus.status
                            )}
                      </b>
                    </span>

                    <span data-label="Date">

                      {formatDate(
                        item.date
                      )}
                    </span>
                  </div>
                );
              }
            )}
          </div>

          {/* PAGINATION */}

          <div className="modern-reading-pagination">

            <span>
              Showing{" "}
              {showingStart}-
              {showingEnd} of{" "}
              {
                filteredReadings.length
              }
            </span>

            <div>

              <button
                type="button"
                disabled={
                  currentReadingPage ===
                  1
                }
                onClick={() =>
                  setReadingsPage(
                    (page) =>
                      Math.max(
                        1,
                        page - 1
                      )
                  )
                }
              >
                Previous
              </button>

              <strong>
                Page{" "}
                {
                  currentReadingPage
                }{" "}
                of{" "}
                {
                  totalReadingPages
                }
              </strong>

              <button
                type="button"
                disabled={
                  currentReadingPage ===
                  totalReadingPages
                }
                onClick={() =>
                  setReadingsPage(
                    (page) =>
                      Math.min(
                        totalReadingPages,
                        page + 1
                      )
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
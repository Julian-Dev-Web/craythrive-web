import { logDiagnostic } from "../../utils/securityDiagnostics";
import { buildMonitoringRecords, evaluateCurrentTankSafety } from "../../utils/monitoringRecords";
import SafetyBadge, { SafetyIcon } from "../../components/SafetyBadge";
import { getSafetySeverity, getParameterExplanation, getSafetyStatusLabel } from "../../utils/statusHelpers";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  Droplets,
  Filter,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  FlaskConical,
  Thermometer,
  Waves,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import {
  formatReadingTime,
  toNumberOrNull,
} from "../../utils/sensorReadingUtils";

import {
  loadActiveThresholds,
} from "../../utils/thresholdEvaluation";

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
  { value: "ammonia", label: "Ammonia" },
  {
    value: "issues",
    label: "Warning / Critical",
  },
];

function clean(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
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

function getSensorFocus(
  item,
  sensorFilter
) {
  const normalized =
    item.normalized;

  if (sensorFilter === "ammonia") {
    return { label: "Ammonia", value: item.ammoniaLabel,
      status: item.type === "Ammonia Reading" ? getSafetyStatusLabel(item.status) : "No Scan",
      severity: item.type === "Ammonia Reading" ? item.status : "no-data",
      hasValue: item.type === "Ammonia Reading" };
  }

  if (sensorFilter === "temperature") {
    return {
      label: "Temperature",

      value:
        normalized.temperatureLabel,

      status:
        normalized.temperatureStatus,

      severity:
        normalized.safety.parameters.temperature.severity,

      hasValue:
        normalized.temperatureValue !== null &&
        normalized.temperatureValue !== undefined &&
        normalized.temperatureValue !== "",
    };
  }

  if (sensorFilter === "ph") {
    return {
      label: "pH Level",

      value:
        normalized.phNumberLabel ||
        normalized.phStatus,

      status:
        normalized.phStatus,

      severity:
        normalized.safety.parameters.ph.severity,

      hasValue:
        normalized.phStatus !==
        "No Reading",
    };
  }

  if (sensorFilter === "turbidity") {
    return {
      label: "Water Clarity",

      value:
        normalized.turbidityStatus,

      status:
        normalized.turbidityStatus,

      severity:
        normalized.safety.parameters.turbidity.severity,

      hasValue:
        normalized.turbidityStatus !==
        "No Reading",
    };
  }

  if (sensorFilter === "water_depth") {
    return {
      label: "Water Level",

      value:
        normalized.waterLabel,

      status:
        normalized.waterStatus,

      severity:
        normalized.safety.parameters.waterLevel.severity,

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

function averageFromNormalized(
  items,
  key
) {
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

  const total =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  return (
    total /
    values.length
  ).toFixed(2);
}

function uniqueRows(rows) {
  const map =
    new Map();

  rows.forEach(
    (row, index) => {
      const explicitId =
        row?.id ||
        row?.uuid ||
        row?.reading_id;

      const tankKey =
        row?.tank_id ||
        row?.tankId ||
        row?.device_uid ||
        row?.device_id ||
        "unknown-tank";

      const timeKey =
        row?.created_at ||
        row?.timestamp ||
        row?.updated_at ||
        row?.date ||
        `index-${index}`;

      const id =
        explicitId ||
        `${tankKey}:${timeKey}`;

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
        .from(
          tableName
        )
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
        .from(
          tableName
        )
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

    let successful =
      false;

    for (
      const column
      of userFilterColumns
    ) {
      const ordered =
        await supabase
          .from(
            tableName
          )
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
          .from(
            tableName
          )
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

function SummaryCard({
  icon: Icon,
  label,
  value,
  helper,
  tone = "default",
}) {
  const safetyLevel = { success: "normal", warning: "warning", danger: "critical" }[tone];
  return (
    <article
      className={`modern-reading-summary-card ${tone} ${safetyLevel ? `safety-summary safety-surface ${safetyLevel}` : ""}`}
    >
      <span>
        {safetyLevel ? <SafetyIcon severity={safetyLevel} size={21} /> : <Icon size={21} />}
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

function MetricCard({ icon: Icon, label, value, parameter, scanDate }) {
  const explanation = getParameterExplanation(parameter, label.replace(/^Latest /, ""));
  return (
    <div className="modern-reading-metric">
      <span className="modern-reading-metric-icon"><Icon size={20} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <SafetyBadge className="modern-reading-status" severity={parameter?.severity} emptyLabel={label === "Ammonia" ? "No Scan" : "No Data"} />
        {explanation && <small className="safety-explanation">{explanation}</small>}
        {scanDate && <small>Latest ammonia scan: {formatReadingTime(scanDate)}</small>}
      </div>
    </div>
  );
}

function ReadingFilterDropdown({
  icon: Icon,
  value,
  options,
  onChange,
  ariaLabel,
}) {
  const [
    isOpen,
    setIsOpen,
  ] =
    useState(false);

  const dropdownRef =
    useRef(null);

  const selectedOption =
    options.find(
      (option) =>
        option.value ===
        value
    ) ||
    options[0];

  useEffect(() => {
    function handleOutsideClick(
      event
    ) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(
          event.target
        )
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(
      event
    ) {
      if (
        event.key === "Escape"
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleOutsideClick
    );

    document.addEventListener(
      "keydown",
      handleEscape
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleOutsideClick
      );

      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, []);

  function handleSelect(
    option
  ) {
    onChange(
      option.value
    );

    setIsOpen(false);
  }

  return (
    <div
      ref={dropdownRef}
      style={
        readingDropdownWrapStyle
      }
    >
      <button
        type="button"
        aria-label={
          ariaLabel
        }
        aria-haspopup="listbox"
        aria-expanded={
          isOpen
        }
        onClick={() =>
          setIsOpen(
            (current) =>
              !current
          )
        }
        style={{
          ...readingDropdownTriggerStyle,

          ...(isOpen
            ? readingDropdownTriggerOpenStyle
            : {}),
        }}
      >
        <Icon
          size={17}
          style={
            readingDropdownIconStyle
          }
        />

        <span
          style={
            readingDropdownSelectedTextStyle
          }
        >
          {
            selectedOption?.label
          }
        </span>

        <ChevronDown
          size={16}
          style={{
            ...readingDropdownChevronStyle,

            transform:
              isOpen
                ? "rotate(180deg)"
                : "rotate(0deg)",
          }}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          style={
            readingDropdownMenuStyle
          }
        >
          {options.map(
            (option) => {
              const isSelected =
                option.value ===
                value;

              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={
                    isSelected
                  }
                  key={
                    option.value
                  }
                  onClick={() =>
                    handleSelect(
                      option
                    )
                  }
                  style={{
                    ...readingDropdownItemStyle,

                    ...(isSelected
                      ? readingDropdownItemActiveStyle
                      : {}),
                  }}
                >
                  <span>
                    {
                      option.label
                    }
                  </span>

                  {isSelected && (
                    <Check
                      size={15}
                      style={{
                        flexShrink:
                          0,
                      }}
                    />
                  )}
                </button>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}

export default function SensorReadingsPage() {
  const [
    readings,
    setReadings,
  ] =
    useState([]);

  const [
    tanks,
    setTanks,
  ] =
    useState([]);

  const [
    searchTerm,
    setSearchTerm,
  ] =
    useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState("all");

  const [
    sensorFilter,
    setSensorFilter,
  ] =
    useState("all");

  const [
    tankFilter,
    setTankFilter,
  ] =
    useState("all");

  const [
    readingsPage,
    setReadingsPage,
  ] =
    useState(1);

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  const [
    lastUpdated,
    setLastUpdated,
  ] =
    useState(null);

  const [ammoniaReadings, setAmmoniaReadings] = useState([]);

  const [
    thresholds,
    setThresholds,
  ] =
    useState(null);

  useEffect(() => {
    let isMounted = true;

    loadActiveThresholds().then(
      (loaded) => {
        if (isMounted) {
          setThresholds(
            loaded
          );
        }
      }
    );

    return () => {
      isMounted = false;
    };
  }, []);

  const loadReadings =
    async () => {
      setThresholds(await loadActiveThresholds());
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
          setAmmoniaReadings([]);
          setTanks([]);
          return;
        }

        const [
          readingResult,
          tankResult,
          ammoniaResult,
        ] =
          await Promise.all([

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
            currentUser.isAdmin
              ? fetchAdminRows(["ammonia_readings"])
              : fetchUserRows(["ammonia_readings"], currentUser.id),
          ]);

        setReadings(
          readingResult.rows
        );

        setTanks(
          tankResult.rows
        );
        setAmmoniaReadings(ammoniaResult.rows);

        setLastUpdated(
          new Date()
        );
      } catch (error) {
        logDiagnostic(
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
    tankFilter,
  ]);

  const enrichedReadings = useMemo(
    () => buildMonitoringRecords(readings, ammoniaReadings, tanks, thresholds),
    [readings, ammoniaReadings, tanks, thresholds]
  );

  const tankFilterOptions =
    useMemo(() => {
      const optionMap =
        new Map();

      enrichedReadings.forEach(
        (item) => {
          if (
            !optionMap.has(
              item.tankKey
            )
          ) {
            optionMap.set(
              item.tankKey,
              item.tankName
            );
          }
        }
      );

      return Array.from(
        optionMap.entries()
      ).map(
        ([value, label]) => ({
          value,
          label,
        })
      );
    }, [
      enrichedReadings,
    ]);

  const tankDropdownOptions =
    useMemo(
      () => [
        {
          value: "all",
          label: "All Tanks",
        },

        ...tankFilterOptions,
      ],
      [
        tankFilterOptions,
      ]
    );

  const conditionDropdownOptions =
    useMemo(
      () => [
        {
          value: "all",
          label:
            "All Conditions",
        },

        {
          value: "normal",
          label: "Normal",
        },

        {
          value: "warning",
          label:
            "Warning",
        },

        {
          value: "critical",
          label: "Critical",
        },
        { value: "no-data", label: "No Data" },
      ],
      []
    );

  const tankScopedReadings =
    useMemo(() => {
      if (
        tankFilter ===
        "all"
      ) {
        return enrichedReadings;
      }

      return enrichedReadings.filter(
        (item) =>
          item.tankKey ===
          tankFilter
      );
    }, [
      enrichedReadings,
      tankFilter,
    ]);

  const filteredReadings =
    useMemo(() => {
      const filtered =
        tankScopedReadings.filter(
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
                item.type,
                item.ammoniaLabel,
                getSafetyStatusLabel(item.status),
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
              (
                sensorFilter ===
                  "issues" &&
                [
                  "warning",
                  "critical",
                ].includes(
                  item.status
                )
              ) ||
              (sensorFilter !== "issues" && focus.hasValue);

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
      tankScopedReadings,
      searchTerm,
      statusFilter,
      sensorFilter,
    ]);

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
      (
        currentReadingPage -
        1
      ) *
        READINGS_PER_PAGE,

      currentReadingPage *
        READINGS_PER_PAGE
    );

  const showingStart =
    filteredReadings.length ===
      0
      ? 0
      : (
          currentReadingPage -
          1
        ) *
          READINGS_PER_PAGE +
        1;

  const showingEnd =
    Math.min(
      currentReadingPage *
        READINGS_PER_PAGE,

      filteredReadings.length
    );

  const summary =
    useMemo(() => {
      const normal =
        tankScopedReadings.filter(
          (item) =>
            item.status ===
            "normal"
        ).length;

      const warning =
        tankScopedReadings.filter(
          (item) =>
            item.status ===
            "warning"
        ).length;

      const critical =
        tankScopedReadings.filter(
          (item) =>
            item.status ===
            "critical"
        ).length;

      return {
        total:
          tankScopedReadings.length,

        normal,
        warning,
        critical,

        avgTemp:
          averageFromNormalized(
            tankScopedReadings,
            "temperatureValue"
          ),

        avgWaterDepth:
          averageFromNormalized(
            tankScopedReadings,
            "waterValue"
          ),
      };
    }, [
      tankScopedReadings,
    ]);

  const latestReading = tankScopedReadings.find(item => item.type === "Water Reading") || null;
  const latestAmmonia = tankScopedReadings.find(item => item.type === "Ammonia Reading" &&
    (!latestReading || item.tankKey === latestReading.tankKey)) || null;

  const latestWaterDepth = toNumberOrNull(latestReading?.normalized.waterValue);
  const latestTemperature = toNumberOrNull(latestReading?.normalized.temperatureValue);
  const latestPH = toNumberOrNull(latestReading?.normalized.phValue);

  const latestSafety = evaluateCurrentTankSafety(latestReading, latestAmmonia, thresholds);

  const selectedTankName =
    tankFilter ===
      "all"
      ? (
          latestReading?.tankName ||
          "Most Recent Tank"
        )
      : (
          tankFilterOptions.find(
            (option) =>
              option.value ===
              tankFilter
          )?.label ||
          "Selected Tank"
        );

  const selectedSensorLabel =
    sensorOptions.find(
      (option) =>
        option.value ===
        sensorFilter
    )?.label ||
    "All Water Data";

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
          Getting the latest tank information.
        </p>
      </section>
    );
  }

  return (
    <div className="modern-readings-page">
      <section className="modern-readings-hero">
        <div>
          <p className="dashboard-eyebrow">
            Water Readings
          </p>

          <h2>
            Check your water condition without the technical clutter.
          </h2>

          <p>
            Review temperature, pH, water clarity, and water level for your tanks.
            Problems are placed first so they are easier to notice.
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

      {latestSafety && (
        <section
          className={`modern-safety-banner safety-surface ${getSafetySeverity(latestSafety)}`}
        >
          <div className="modern-safety-banner-icon">
            <SafetyIcon severity={getSafetySeverity(latestSafety)} size={26} />
          </div>

          <div className="modern-safety-banner-text">
            <strong>
              {getSafetyStatusLabel(getSafetySeverity(latestSafety))}
            </strong>

            <span>
              Checked against your saved Threshold Settings
              {lastUpdated
                ? ` · as of ${formatReadingTime(
                    lastUpdated
                  )}`
                : ""}
            </span>

            {!latestSafety.isSafe && (
              <ul className="modern-safety-issue-list">
                {latestSafety.issues.map(
                  (issue) => (
                    <li
                      key={
                        issue.key
                      }
                    >
                      <b>
                        {issue.label}:
                      </b>{" "}
                      {issue.message}
                    </li>
                  )
                )}
              </ul>
            )}
          </div>
        </section>
      )}

      <section className="modern-reading-summary-grid">
        <SummaryCard
          icon={
            CheckCircle2
          }
          label="Normal"
          value={
            summary.normal
          }
          helper="Normal water conditions"
          tone="success"
        />

        <SummaryCard
          icon={
            AlertTriangle
          }
          label="Warning"
          value={
            summary.warning
          }
          helper="Conditions to watch"
          tone="warning"
        />

        <SummaryCard
          icon={AlertCircle}
          label="Critical"
          value={
            summary.critical
          }
          helper="Needs attention soon"
          tone="danger"
        />

        <SummaryCard
          icon={
            Database
          }
          label="Total Records"
          value={
            summary.total
          }
          helper="Saved water readings"
        />
      </section>

      <section className="modern-readings-grid">
        <article className="modern-readings-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">
                Water Overview
              </p>

              <h3>
                Latest condition ·{" "}
                {selectedTankName}
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
              label="Latest Temperature"
              value={
                latestTemperature ===
                  null
                  ? "No Data"
                  : `${latestTemperature.toFixed(
                      2
                    )}°C`
              }
              parameter={latestReading?.normalized?.safety?.parameters.temperature}
            />

            <MetricCard
              icon={
                Droplets
              }
              label="pH Level"
              value={
                latestPH ===
                  null
                  ? (
                      latestReading
                        ?.normalized
                        ?.phNumberLabel ||
                      latestReading
                        ?.normalized
                        ?.phStatus ||
                      "No Data"
                    )
                  : latestPH.toFixed(
                      2
                    )
              }
              parameter={latestReading?.normalized?.safety?.parameters.ph}
            />

            <MetricCard
              icon={
                Waves
              }
              label="Water Clarity"
              value={
                latestReading
                  ?.normalized
                  ?.turbidityStatus ||
                "No Reading"
              }
              parameter={latestReading?.normalized?.safety?.parameters.turbidity}
            />

            <MetricCard
              icon={
                Gauge
              }
              label="Latest Water Level"
              value={
                latestWaterDepth ===
                  null
                  ? "No Data"
                  : `${latestWaterDepth.toFixed(
                      2
                    )} cm`
              }
              parameter={latestReading?.normalized?.safety?.parameters.waterLevel}
            />
            <MetricCard icon={FlaskConical} label="Ammonia"
              value={latestAmmonia?.ammoniaLabel || "No Scan"}
              parameter={latestSafety.parameters.ammonia} scanDate={latestAmmonia?.date} />
          </div>
        </article>

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

              <SafetyBadge className="modern-reading-status" severity={getSafetySeverity(latestSafety)} />
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

      <section
        className="modern-reading-toolbar"
        style={
          readingToolbarStyle
        }
      >
        <div
          className="modern-reading-search"
          style={
            readingSearchStyle
          }
        >
          <Search
            size={18}
            style={
              readingSearchIconStyle
            }
          />

          <input
            type="search"
            placeholder="Search tank name or condition..."
            value={
              searchTerm
            }
            onChange={(event) =>
              setSearchTerm(
                event.target.value
              )
            }
            style={
              readingSearchInputStyle
            }
          />
        </div>

        <ReadingFilterDropdown
          ariaLabel="Filter readings by tank"
          icon={
            Database
          }
          value={
            tankFilter
          }
          options={
            tankDropdownOptions
          }
          onChange={
            setTankFilter
          }
        />

        <ReadingFilterDropdown
          ariaLabel="Filter readings by condition"
          icon={
            Filter
          }
          value={
            statusFilter
          }
          options={
            conditionDropdownOptions
          }
          onChange={
            setStatusFilter
          }
        />

        <ReadingFilterDropdown
          ariaLabel="Filter readings by water parameter"
          icon={
            Droplets
          }
          value={
            sensorFilter
          }
          options={
            sensorOptions
          }
          onChange={
            setSensorFilter
          }
        />
      </section>

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
            Try another search or change your filters.
          </p>
        </section>
      ) : (
        <section className="modern-reading-table-card">
          <div className="modern-reading-table-title">
            <div>
              <span>
                Reading History
              </span>

              <h3>
                Water and ammonia records
              </h3>
            </div>

            <small>
              {
                selectedSensorLabel
              }
            </small>
          </div>

          <div className="modern-reading-table-scroll">
          <div className="modern-reading-table-header">
            <span>Type</span>
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

            <span>Ammonia</span>
            <span>
              Status
            </span>

            <span>
              Date
            </span>
          </div>

          <div className="modern-reading-table-body">
            {paginatedReadings.map(item => {
              const water = item.type === "Water Reading";
              const normalized = item.normalized;
              const focus = getSensorFocus(item, sensorFilter);
              const displaySeverity = ["all", "issues"].includes(sensorFilter) ? item.status : focus.severity;
              const metrics = [
                ["Temperature", normalized.temperatureLabel, "temperature"],
                ["pH", normalized.phNumberLabel, "ph"],
                ["Water Clarity", normalized.turbidityNumberLabel, "turbidity"],
                ["Water Level", normalized.waterLabel, "waterLevel"],
              ];
              return (
                <div className="modern-reading-table-row" key={item.recordId}>
                  <span data-label="Type">{item.type}</span>
                  <span data-label="Tank"><strong>{item.tankName}</strong></span>
                  {metrics.map(([label, value, key]) => (
                    <span data-label={label} key={key}>
                      {water ? <>
                        {value}
                        <SafetyBadge severity={normalized.safety.parameters[key].severity} />
                        {getParameterExplanation(normalized.safety.parameters[key], label) &&
                          <small className="safety-explanation">{getParameterExplanation(normalized.safety.parameters[key], label)}</small>}
                      </> : "-"}
                    </span>
                  ))}
                  <span data-label="Ammonia">{water ? "-" : <>
                    {item.ammoniaLabel}
                    <SafetyBadge severity={item.status} emptyLabel="No Scan" />
                    {getParameterExplanation(normalized.safety.parameters.ammonia, "Ammonia") &&
                      <small className="safety-explanation">{getParameterExplanation(normalized.safety.parameters.ammonia, "Ammonia")}</small>}
                  </>}</span>
                  <span data-label="Status"><SafetyBadge severity={displaySeverity} /></span>
                  <span data-label="Date">{formatDate(item.date)}</span>
                </div>
              );
            })}
          </div>

          </div>

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

const readingToolbarStyle = {
  display: "grid",

alignItems: "center",

  gap: "10px",

  overflow: "visible",

  position: "relative",

  zIndex: 12,
};

const readingSearchStyle = {
  height: "48px",

  minHeight: "48px",

  display: "flex",

  alignItems: "center",

  gap: "9px",

  padding: "0 14px",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  borderRadius:
    "12px",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",

  boxShadow:
    "var(--ct-shadow-soft, 0 4px 14px rgba(15, 23, 42, 0.04))",
};

const readingSearchIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",
};

const readingSearchInputStyle = {
  width:
    "100%",

  minWidth:
    0,

  padding:
    0,

  border:
    "none",

  outline:
    "none",

  background:
    "transparent",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  font:
    "inherit",

  fontSize:
    "0.82rem",
};

const readingDropdownWrapStyle = {
  position:
    "relative",

  minWidth:
    0,
};

const readingDropdownTriggerStyle = {
  width:
    "100%",

  height:
    "48px",

  display:
    "flex",

  alignItems:
    "center",

  gap:
    "8px",

  padding:
    "0 13px",

  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--ct-border, var(--border, #e5e4e7))",

  borderRadius:
    "12px",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  boxShadow:
    "var(--ct-shadow-soft, 0 4px 14px rgba(15, 23, 42, 0.04))",

  font:
    "inherit",

  fontSize:
    "0.8rem",

  fontWeight:
    600,

  cursor:
    "pointer",

  textAlign:
    "left",

  transition:
    "background 150ms ease, border-color 150ms ease, box-shadow 150ms ease",
};

const readingDropdownTriggerOpenStyle = {
  borderColor:
    "var(--ct-brand, #00b8a9)",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  boxShadow:
    "0 0 0 3px rgba(0, 217, 199, 0.08)",
};

const readingDropdownIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-brand, #00b8a9)",
};

const readingDropdownSelectedTextStyle = {
  minWidth:
    0,

  overflow:
    "hidden",

  textOverflow:
    "ellipsis",

  whiteSpace:
    "nowrap",
};

const readingDropdownChevronStyle = {
  marginLeft:
    "auto",

  flexShrink:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",

  opacity:
    0.8,

  transition:
    "transform 160ms ease",
};

const readingDropdownMenuStyle = {
  position:
    "absolute",

  top:
    "calc(100% + 6px)",

  left:
    0,

  right:
    0,

  zIndex:
    120,

  padding:
    "5px",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  borderRadius:
    "12px",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  boxShadow:
    "0 14px 32px rgba(15, 23, 42, 0.14)",

  overflow:
    "hidden",

  backdropFilter:
    "blur(18px)",
};

const readingDropdownItemStyle = {
  width:
    "100%",

  minHeight:
    "38px",

  display:
    "flex",

  alignItems:
    "center",

  justifyContent:
    "space-between",

  gap:
    "10px",

  padding:
    "0 10px",

  border:
    "none",

  borderRadius:
    "8px",

  background:
    "transparent",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  font:
    "inherit",

  fontSize:
    "0.78rem",

  fontWeight:
    500,

  cursor:
    "pointer",

  textAlign:
    "left",
};

const readingDropdownItemActiveStyle = {
  background:
    "var(--ct-brand-soft, var(--accent-bg, rgba(0, 217, 199, 0.10)))",

  color:
    "var(--ct-brand, var(--accent, #008f83))",

  fontWeight:
    700,
};

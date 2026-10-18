import { formatPhilippineDateTime, formatPhilippineTime, compareTimestamps } from '../../utils/philippineTime';
import { getServerNowDate } from '../../services/serverTimeService';
import { logDiagnostic } from "../../utils/securityDiagnostics";
import SafetyBadge from "../../components/SafetyBadge";
import { formatMonitoringAlert, waterAutomationAlertSeverity } from "../../../supabase/functions/_shared/monitoringAlertPresentation.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Droplets,
  Filter,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Siren,
  Thermometer,
  Waves,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

/* =========================================================
   TABLES
========================================================= */

const alertTables = [
  "alerts",
  "notifications",
  "tank_alerts",
];

const tankTables = [
  "tanks",
  "user_tanks",
  "tank_profiles",
];

const ALERTS_PER_PAGE = 10;

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "recipient_id",
  "farmer_id",
];

/* =========================================================
   CATEGORY OPTIONS
========================================================= */

const categoryOptions = [
  {
    value: "all",
    label: "All Categories",
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
    value: "water_level",
    label: "Water Level",
  },
  {
    value: "ammonia",
    label: "Ammonia",
  },
  {
    value: "marketplace",
    label: "Marketplace",
  },
  {
    value: "general",
    label: "General",
  },
];

const severityOptions = [
  {
    value: "all",
    label: "All",
  },
  {
    value: "critical",
    label: "Critical",
  },
  {
    value: "warning",
    label: "Warning",
  },
  {
    value: "normal",
    label: "Normal",
  },
];

const alertStatusOptions = [
  {
    value: "all",
    label: "All Status",
  },
  {
    value: "open",
    label: "Open",
  },
  {
    value: "resolved",
    label: "Handled",
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

function normalizeText(value) {
  return lower(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}

function formatFriendlyText(value) {
  const text = clean(value);

  if (!text) {
    return "N/A";
  }

  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase()
    );
}

function formatDate(value) { return formatPhilippineDateTime(value); }

function formatShortTime(value) { return formatPhilippineTime(value); }

function getValue(
  row,
  keys,
  fallback = "N/A"
) {
  for (const key of keys) {
    if (
      row?.[key] !== null &&
      row?.[key] !== undefined &&
      row?.[key] !== ""
    ) {
      return row[key];
    }
  }

  return fallback;
}

/* =========================================================
   ALERT HELPERS
========================================================= */

function getAlertTitle(
  row,
  index
) {
  return (
    formatMonitoringAlert(row).title ||
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
    formatMonitoringAlert(row).message ||
    row?.message ||
    row?.description ||
    row?.body ||
    row?.alert_message ||
    row?.notification_message ||
    "No additional information was provided."
  );
}

function getAlertSeverity(row) {
  const automationSeverity = waterAutomationAlertSeverity(row);
  if (automationSeverity) return automationSeverity;
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
    raw.includes("unsafe") ||
    raw.includes("high ph") ||
    raw.includes("low ph")
  ) {
    return "critical";
  }

  if (
    raw.includes("warning") ||
    raw.includes("medium") ||
    raw.includes("dirty") ||
    raw.includes("slightly") ||
    raw.includes("low") ||
    raw.includes("high")
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

  if (
    raw.includes("temp")
  ) {
    return "temperature";
  }

  if (
    raw.includes("ph")
  ) {
    return "ph";
  }

  if (
    raw.includes("turb") ||
    raw.includes("clarity")
  ) {
    return "turbidity";
  }

  if (
    raw.includes("water") ||
    raw.includes("level") ||
    raw.includes("depth")
  ) {
    return "water_level";
  }

  if (
    raw.includes("ammonia")
  ) {
    return "ammonia";
  }

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
  return (
    row?.created_at ||
    row?.updated_at ||
    row?.timestamp ||
    row?.date ||
    ""
  );
}


function getFriendlyAlertStatus(
  status
) {
  if (
    status === "resolved"
  ) {
    return "Handled";
  }

  return "Open";
}

function getCategoryLabel(category) {
  const option =
    categoryOptions.find(
      (item) =>
        item.value === category
    );

  return (
    option?.label ||
    formatFriendlyText(
      category
    )
  );
}

function getSeverityRank(
  severity
) {
  if (
    severity === "critical"
  ) {
    return 1;
  }

  if (
    severity === "warning"
  ) {
    return 2;
  }

  if (
    severity === "info"
  ) {
    return 3;
  }

  return 4;
}

function getCategoryIcon(
  category
) {
  if (
    category ===
    "temperature"
  ) {
    return Thermometer;
  }

  if (
    category === "ph"
  ) {
    return Droplets;
  }

  if (
    category ===
    "turbidity"
  ) {
    return Waves;
  }

  if (
    category ===
    "water_level"
  ) {
    return Gauge;
  }

  if (
    category ===
    "ammonia"
  ) {
    return AlertTriangle;
  }

  if (
    category ===
    "marketplace"
  ) {
    return ShoppingBag;
  }

  return Bell;
}

/* =========================================================
   TANK NAME RESOLUTION
========================================================= */

function getTankKeys(tank) {
  return [
    tank?.id,
    tank?.tank_id,
    tank?.uuid,
    tank?.device_uid,
    tank?.device_id,
    tank?.iot_device_id,
    tank?.tank_code,
  ]
    .filter(Boolean)
    .map(String);
}

function getAlertTankKeys(alert) {
  return [
    alert?.tank_id,
    alert?.tankId,
    alert?.tank_uuid,
    alert?.tank_profile_id,
    alert?.device_uid,
    alert?.device_id,
    alert?.iot_device_id,
  ]
    .filter(Boolean)
    .map(String);
}

function getTankDisplayName(
  alert,
  tanks
) {
  const directName =
    alert?.tank_name ||
    alert?.tank_label ||
    alert?.tank_display_name;

  if (directName) {
    return directName;
  }

  const alertKeys =
    getAlertTankKeys(
      alert
    );

  const matchedTank =
    tanks.find((tank) => {
      const tankKeys =
        getTankKeys(tank);

      return alertKeys.some(
        (key) =>
          tankKeys.includes(key)
      );
    });

  if (!matchedTank) {
    return "Tank";
  }

  return (
    matchedTank?.name ||
    matchedTank?.tank_name ||
    matchedTank?.title ||
    matchedTank?.label ||
    "Tank"
  );
}

/* =========================================================
   UNIQUE ROWS
========================================================= */

function uniqueRows(rows) {
  const map =
    new Map();

  rows.forEach(
    (row, index) => {
      const id =
        row?.id ||
        row?.uuid ||
        row?.alert_id ||
        row?.notification_id ||
        row?.created_at ||
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
  const {
    data,
  } =
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
   DATABASE FETCHING
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

/* =========================================================
   SMALL COMPONENT
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
      className={`cray-alert-summary-card ${tone}`}
    >
      <span>
        <Icon
          size={21}
        />
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

/* =========================================================
   MINIMAL THEME-AWARE DROPDOWN
========================================================= */

function AlertFilterDropdown({
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
        option.value === value
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

    function handleEscape(event) {
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
        alertDropdownWrapStyle
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
          ...alertDropdownTriggerStyle,

          ...(isOpen
            ? alertDropdownTriggerOpenStyle
            : {}),
        }}
      >
        <Icon
          size={17}
          style={
            alertDropdownIconStyle
          }
        />

        <span
          style={
            alertDropdownSelectedTextStyle
          }
        >
          {
            selectedOption?.label
          }
        </span>

        <ChevronDown
          size={16}
          style={{
            ...alertDropdownChevronStyle,

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
            alertDropdownMenuStyle
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
                    ...alertDropdownItemStyle,

                    ...(isSelected
                      ? alertDropdownItemActiveStyle
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

/* =========================================================
   PAGE
========================================================= */

export default function AlertsPage() {
  const [
    alerts,
    setAlerts,
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
    severityFilter,
    setSeverityFilter,
  ] =
    useState("all");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState("all");

  const [
    categoryFilter,
    setCategoryFilter,
  ] =
    useState("all");

  const [
    alertsPage,
    setAlertsPage,
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

  /* =======================================================
     LOAD
  ======================================================= */

  const loadAlerts =
    async () => {
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
          setAlerts([]);
          setTanks([]);

          return;
        }

        const [
          alertResult,
          tankResult,
        ] =
          await Promise.all([
            currentUser.isAdmin
              ? fetchAdminRows(
                  alertTables
                )
              : fetchUserRows(
                  alertTables,
                  currentUser.id
                ),

            currentUser.isAdmin
              ? fetchAdminRows(
                  tankTables,
                  400
                )
              : fetchUserRows(
                  tankTables,
                  currentUser.id,
                  400
                ),
          ]);

        setAlerts(
          alertResult.rows
        );

        setTanks(
          tankResult.rows
        );

        setLastUpdated(
          getServerNowDate()
        );
      } catch (error) {
        logDiagnostic(
          "Alerts loading error:",
          error
        );
      } finally {
        setIsLoading(false);
      }
    };

  useEffect(() => {
    loadAlerts();
  }, []);

  useEffect(() => {
    setAlertsPage(1);
  }, [
    searchTerm,
    severityFilter,
    statusFilter,
    categoryFilter,
  ]);

  /* =======================================================
     ENRICH ALERTS
  ======================================================= */

  const enrichedAlerts =
    useMemo(() => {
      return alerts.map(
        (
          alert,
          index
        ) => {
          const severity =
            getAlertSeverity(
              alert
            );

          const status =
            getAlertStatus(
              alert
            );

          const category =
            getAlertCategory(
              alert
            );

          const title =
            getAlertTitle(
              alert,
              index
            );

          const message =
            getAlertMessage(
              alert
            );

          const date =
            getAlertDate(
              alert
            );

          const tankName =
            getTankDisplayName(
              alert,
              tanks
            );

          return {
            alert,
            index,
            severity,
            status,
            category,
            title,
            message,
            date,
            tankName,
          };
        }
      );
    }, [
      alerts,
      tanks,
    ]);

  /* =======================================================
     FILTER
  ======================================================= */

  const filteredAlerts =
    useMemo(() => {
      const filtered =
        enrichedAlerts.filter(
          (item) => {
            const search =
              searchTerm
                .trim()
                .toLowerCase();

            const searchableText =
              [
                item.title,
                item.message,
                item.severity,
                item.status,
                item.category,
                item.tankName,

                getValue(
                  item.alert,
                  [
                    "value",
                    "reading_value",
                    "sensor_value",
                  ],
                  ""
                ),
              ]
                .join(" ")
                .toLowerCase();

            const matchesSearch =
              !search ||
              searchableText.includes(
                search
              );

            const matchesSeverity =
              severityFilter ===
                "all" ||
              item.severity ===
                severityFilter;

            const matchesStatus =
              statusFilter ===
                "all" ||
              item.status ===
                statusFilter;

            const matchesCategory =
              categoryFilter ===
                "all" ||
              item.category ===
                categoryFilter;

            return (
              matchesSearch &&
              matchesSeverity &&
              matchesStatus &&
              matchesCategory
            );
          }
        );

      return filtered.sort(
        (a, b) => {
          const openRankA =
            a.status ===
            "open"
              ? 0
              : 1;

          const openRankB =
            b.status ===
            "open"
              ? 0
              : 1;

          if (
            openRankA !==
            openRankB
          ) {
            return (
              openRankA -
              openRankB
            );
          }

          const severityDifference =
            getSeverityRank(
              a.severity
            ) -
            getSeverityRank(
              b.severity
            );

          if (
            severityDifference !==
            0
          ) {
            return severityDifference;
          }

          return (
            compareTimestamps(b.date || 0, a.date || 0)
          );
        }
      );
    }, [
      enrichedAlerts,
      searchTerm,
      severityFilter,
      statusFilter,
      categoryFilter,
    ]);

  /* =======================================================
     PAGINATION
  ======================================================= */

  const totalAlertPages =
    Math.max(
      1,
      Math.ceil(
        filteredAlerts.length /
          ALERTS_PER_PAGE
      )
    );

  const currentAlertPage =
    Math.min(
      alertsPage,
      totalAlertPages
    );

  const paginatedAlerts =
    filteredAlerts.slice(
      (
        currentAlertPage -
        1
      ) *
        ALERTS_PER_PAGE,

      currentAlertPage *
        ALERTS_PER_PAGE
    );

  const showingStart =
    filteredAlerts.length ===
      0
      ? 0
      : (
          currentAlertPage -
          1
        ) *
          ALERTS_PER_PAGE +
        1;

  const showingEnd =
    Math.min(
      currentAlertPage *
        ALERTS_PER_PAGE,

      filteredAlerts.length
    );

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary =
    useMemo(() => {
      const open =
        enrichedAlerts.filter(
          (item) =>
            item.status ===
            "open"
        );

      const critical =
        open.filter(
          (item) =>
            item.severity ===
            "critical"
        ).length;

      const warning =
        open.filter(
          (item) =>
            item.severity ===
            "warning"
        ).length;

      const resolved =
        enrichedAlerts.filter(
          (item) =>
            item.status ===
            "resolved"
        ).length;

      return {
        total:
          enrichedAlerts.length,

        open:
          open.length,

        critical,

        warning,

        resolved,
      };
    }, [
      enrichedAlerts,
    ]);

  /* =======================================================
     CATEGORY COUNTS
  ======================================================= */

  const categoryCounts =
    useMemo(() => {
      return categoryOptions
        .filter(
          (option) =>
            option.value !==
            "all"
        )
        .map(
          (option) => ({
            ...option,

            count:
              enrichedAlerts.filter(
                (item) =>
                  item.category ===
                  option.value
              ).length,
          })
        )
        .filter(
          (item) =>
            item.count > 0
        );
    }, [
      enrichedAlerts,
    ]);

  /* =======================================================
     PRIORITY ALERT
  ======================================================= */

  const latestCritical =
    useMemo(() => {
      return [
        ...enrichedAlerts,
      ]
        .filter(
          (item) =>
            item.status ===
              "open" &&
            item.severity ===
              "critical"
        )
        .sort(
          (a, b) =>
            compareTimestamps(b.date || 0, a.date || 0)
        )[0] || null;
    }, [
      enrichedAlerts,
    ]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="cray-alert-loading">
        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading alerts...
        </h3>

        <p>
          Checking your latest
          tank notifications.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="cray-alerts-page">
      {/* ===============================================
          HERO
      ================================================ */}

      <section className="cray-alerts-hero">
        <div>
          <p className="dashboard-eyebrow">
            Alerts
          </p>

          <h2>
            See what needs your
            attention first.
          </h2>

          <p>
            CrayThrive puts urgent
            tank conditions first so
            you can quickly see what
            needs checking.
          </p>

          <div className="cray-alert-actions">
            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                loadAlerts
              }
            >
              <RefreshCw
                size={18}
              />

              Refresh
            </button>

            <span>
              {lastUpdated
                ? `Updated ${formatShortTime(
                    lastUpdated
                  )}`
                : "Waiting for latest data"}
            </span>
          </div>
        </div>

        <div
          className={`cray-alert-hero-card ${
            summary.critical > 0
              ? "danger"
              : summary.open > 0
                ? "warning"
                : "success"
          }`}
        >
          {summary.critical > 0 ? (
            <Siren
              size={35}
            />
          ) : (
            <ShieldCheck
              size={35}
            />
          )}

          <strong>
            {summary.critical > 0
              ? summary.critical
              : summary.open}
          </strong>

          <span>
            {summary.critical > 0
              ? "Critical alerts"
              : summary.open > 0
                ? "Open alerts"
                : "No open alerts"}
          </span>
        </div>
      </section>

      {/* ===============================================
          SUMMARY
      ================================================ */}

      <section className="cray-alert-summary-grid">
        <SummaryCard
          icon={Bell}
          label="Open Alerts"
          value={
            summary.open
          }
          helper="Still needs review"
          tone={
            summary.open > 0
              ? "warning"
              : "default"
          }
        />

        <SummaryCard
          icon={Siren}
          label="Critical"
          value={
            summary.critical
          }
          helper="Needs attention soon"
          tone="danger"
        />

        <SummaryCard
          icon={
            AlertTriangle
          }
          label="Warning"
          value={
            summary.warning
          }
          helper="Conditions to monitor"
          tone="warning"
        />

        <SummaryCard
          icon={
            CheckCircle2
          }
          label="Handled"
          value={
            summary.resolved
          }
          helper="Already resolved or read"
          tone="success"
        />
      </section>

      {/* ===============================================
          MAIN INFO
      ================================================ */}

      <section className="cray-alert-overview-grid">
        {/* PRIORITY */}

        <article className="cray-alert-panel">
          <div className="cray-alert-panel-heading">
            <div>
              <p className="dashboard-eyebrow">
                Priority
              </p>

              <h3>
                Most important alert
              </h3>
            </div>

            <Siren
              size={22}
            />
          </div>

          {latestCritical ? (
            <div className="cray-priority-alert">
              <div className="cray-priority-top">
                <SafetyBadge className="cray-alert-severity" severity={latestCritical.severity} emptyLabel="Information" />

                <small>
                  {formatDate(
                    latestCritical.date
                  )}
                </small>
              </div>

              <strong>
                {
                  latestCritical.title
                }
              </strong>

              <p>
                {
                  latestCritical.message
                }
              </p>

              <div className="cray-priority-tank">
                <Droplets
                  size={16}
                />

                <span>
                  {
                    latestCritical.tankName
                  }
                </span>
              </div>
            </div>
          ) : (
            <div className="cray-alert-empty-small">
              <ShieldCheck
                size={30}
              />

              <strong>
                No urgent alert
              </strong>

              <span>
                There is currently
                no critical open
                alert that needs
                immediate attention.
              </span>
            </div>
          )}
        </article>

        {/* CATEGORY */}

        <article className="cray-alert-panel">
          <div className="cray-alert-panel-heading">
            <div>
              <p className="dashboard-eyebrow">
                Alert Types
              </p>

              <h3>
                Where alerts came from
              </h3>
            </div>

            <Bell
              size={22}
            />
          </div>

          {categoryCounts.length ===
          0 ? (
            <div className="cray-alert-empty-small">
              <Bell
                size={28}
              />

              <strong>
                No alert activity
              </strong>

              <span>
                Alert categories
                will appear here
                when records are
                available.
              </span>
            </div>
          ) : (
            <div className="cray-alert-category-list">
              {categoryCounts.map(
                (category) => {
                  const Icon =
                    getCategoryIcon(
                      category.value
                    );

                  return (
                    <div
                      className="cray-alert-category-row"
                      key={
                        category.value
                      }
                    >
                      <span>
                        <Icon
                          size={18}
                        />
                      </span>

                      <div>
                        <strong>
                          {
                            category.label
                          }
                        </strong>

                        <small>
                          {
                            category.count
                          }{" "}
                          {category.count ===
                          1
                            ? "alert"
                            : "alerts"}
                        </small>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </article>
      </section>

      {/* ===============================================
          FILTERS
      ================================================ */}

      <section
        className="cray-alert-toolbar"
        style={
          alertToolbarStyle
        }
      >
        <div
          className="cray-alert-search"
          style={
            alertSearchStyle
          }
        >
          <Search
            size={18}
            style={
              alertSearchIconStyle
            }
          />

          <input
            type="search"
            placeholder="Search alert, tank, or condition..."
            value={
              searchTerm
            }
            onChange={(event) =>
              setSearchTerm(
                event.target.value
              )
            }
            style={
              alertSearchInputStyle
            }
          />
        </div>

        <AlertFilterDropdown
          ariaLabel="Filter alerts by priority"
          icon={
            AlertTriangle
          }
          value={
            severityFilter
          }
          options={
            severityOptions
          }
          onChange={
            setSeverityFilter
          }
        />

        <AlertFilterDropdown
          ariaLabel="Filter alerts by status"
          icon={
            Clock3
          }
          value={
            statusFilter
          }
          options={
            alertStatusOptions
          }
          onChange={
            setStatusFilter
          }
        />

        <AlertFilterDropdown
          ariaLabel="Filter alerts by category"
          icon={
            Filter
          }
          value={
            categoryFilter
          }
          options={
            categoryOptions
          }
          onChange={
            setCategoryFilter
          }
        />
      </section>

      {/* ===============================================
          EMPTY
      ================================================ */}

      {filteredAlerts.length ===
      0 ? (
        <section className="cray-alert-empty">
          <Bell
            size={34}
          />

          <h3>
            No alerts found
          </h3>

          <p>
            Try changing your search
            or filters. New tank
            warnings will appear here.
          </p>
        </section>
      ) : (
        /* =============================================
            ALERT LIST
        ============================================== */

        <section className="cray-alert-list-card">
          <div className="cray-alert-list-title">
            <div>
              <span>
                Alert History
              </span>

              <h3>
                Tank notifications
              </h3>
            </div>

            <small>
              {
                filteredAlerts.length
              }{" "}
              result
              {filteredAlerts.length !==
              1
                ? "s"
                : ""}
            </small>
          </div>

          <div className="cray-alert-list">
            {paginatedAlerts.map(
              (item) => {
                const Icon =
                  getCategoryIcon(
                    item.category
                  );

                const value =
                  getValue(
                    item.alert,
                    [
                      "value",
                      "reading_value",
                      "sensor_value",
                    ],
                    ""
                  );

                return (
                  <article
                    className={`cray-alert-card ${item.status}`}
                    key={
                      item.alert?.id ||
                      item.alert
                        ?.alert_id ||
                      item.index
                    }
                  >
                    <div
                      className={`cray-alert-icon ${item.severity}`}
                    >
                      <Icon
                        size={21}
                      />
                    </div>

                    <div className="cray-alert-content">
                      <div className="cray-alert-card-top">
                        <div>
                          <strong>
                            {
                              item.title
                            }
                          </strong>

                          <span>
                            {formatDate(
                              item.date
                            )}
                          </span>
                        </div>

                        <div className="cray-alert-chip-row">
                          <SafetyBadge className="cray-alert-severity" severity={item.severity} emptyLabel="Information" />

                          <small
                            className={`cray-alert-status ${item.status}`}
                          >
                            {getFriendlyAlertStatus(
                              item.status
                            )}
                          </small>
                        </div>
                      </div>

                      <p>
                        {
                          item.message
                        }
                      </p>

                      <div className="cray-alert-meta">
                        <span>
                          <Droplets
                            size={14}
                          />

                          {
                            item.tankName
                          }
                        </span>

                        <span>
                          {getCategoryLabel(
                            item.category
                          )}
                        </span>

                        {value !== "" &&
                          value !==
                            "N/A" && (
                            <span>
                              Reading:{" "}
                              {value}
                            </span>
                          )}
                      </div>
                    </div>
                  </article>
                );
              }
            )}
          </div>

          {/* PAGINATION */}

          <div className="cray-alert-pagination">
            <span>
              Showing{" "}
              {showingStart}-
              {showingEnd} of{" "}
              {
                filteredAlerts.length
              }
            </span>

            <div>
              <button
                type="button"
                disabled={
                  currentAlertPage ===
                  1
                }
                onClick={() =>
                  setAlertsPage(
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
                  currentAlertPage
                }{" "}
                of{" "}
                {
                  totalAlertPages
                }
              </strong>

              <button
                type="button"
                disabled={
                  currentAlertPage ===
                  totalAlertPages
                }
                onClick={() =>
                  setAlertsPage(
                    (page) =>
                      Math.min(
                        totalAlertPages,
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

/* =========================================================
   MINIMAL THEME-AWARE ALERT FILTER UI
========================================================= */

const alertToolbarStyle = {
  display:
    "grid",

  alignItems:
    "center",

  gap:
    "10px",

  overflow:
    "visible",

  position:
    "relative",

  zIndex:
    12,
};

const alertSearchStyle = {
  height:
    "48px",

  minHeight:
    "48px",

  display:
    "flex",

  alignItems:
    "center",

  gap:
    "9px",

  padding:
    "0 14px",

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

const alertSearchIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",
};

const alertSearchInputStyle = {
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

const alertDropdownWrapStyle = {
  position:
    "relative",

  minWidth:
    0,
};

const alertDropdownTriggerStyle = {
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

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

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

const alertDropdownTriggerOpenStyle = {
  borderColor:
    "var(--ct-brand, #00b8a9)",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  boxShadow:
    "0 0 0 3px rgba(0, 217, 199, 0.08)",
};

const alertDropdownIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-brand, #00b8a9)",
};

const alertDropdownSelectedTextStyle = {
  minWidth:
    0,

  overflow:
    "hidden",

  textOverflow:
    "ellipsis",

  whiteSpace:
    "nowrap",
};

const alertDropdownChevronStyle = {
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

const alertDropdownMenuStyle = {
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

const alertDropdownItemStyle = {
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

const alertDropdownItemActiveStyle = {
  background:
    "var(--ct-brand-soft, var(--accent-bg, rgba(0, 217, 199, 0.10)))",

  color:
    "var(--ct-brand, var(--accent, #008f83))",

  fontWeight:
    700,
};

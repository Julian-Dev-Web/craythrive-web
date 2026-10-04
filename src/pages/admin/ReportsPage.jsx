import SafetyBadge from "../../components/SafetyBadge";
import { getSafetySeverity, getSafetyStatusLabel, getParameterExplanation } from "../../utils/statusHelpers";
import { buildMonitoringRecords, buildTankHistoryExportRows, evaluateCurrentTankSafety, recordMatchesMonitoringTank } from "../../utils/monitoringRecords";
import { loadActiveThresholds } from "../../utils/thresholdEvaluation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  Download,
  Droplets,
  FileText,
  Gauge,
  Loader2,
  PackageCheck,
  PieChart,
  Printer,
  RefreshCw,
  ShoppingBag,
  FlaskConical,
  Thermometer,
  TrendingUp,
  Waves,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import {
  toNumberOrNull,
} from "../../utils/sensorReadingUtils";

import {
  downloadCsv,
  printReport,
} from "../../utils/exportPrintUtils";

/* =========================================================
   TABLES
========================================================= */

const tableGroups = {
  tanks: [
    "tanks",
    "user_tanks",
    "tank_profiles",
  ],

  readings: [
    "sensor_readings",
    "tank_readings",
    "readings",
  ],

  ammonia: ["ammonia_readings"],

  alerts: [
    "alerts",
    "notifications",
    "tank_alerts",
  ],

  listings: [
    "marketplace_listings",
    "listings",
    "products",
  ],

  orders: [
    "marketplace_orders",
    "orders",
    "reservations",
    "marketplace_reservations",
  ],
};

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
  "seller_id",
  "buyer_id",
  "breeder_id",
  "recipient_id",
];

/* =========================================================
   GENERAL HELPERS
========================================================= */

function clean(value) {
  return String(value ?? "").trim();
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
    return "No Data";
  }

  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function formatPeso(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "₱0";
  }

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatNumber(value) {
  return new Intl.NumberFormat(
    "en-US"
  ).format(value || 0);
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

function formatDateOnly(value) {
  if (!value) {
    return "";
  }

  const date = new Date(
    `${value}T00:00:00`
  );

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(
    "en-PH",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  );
}

function formatShortTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isWithinDateRange(
  value,
  fromDate,
  toDate
) {
  if (!fromDate && !toDate) {
    return true;
  }

  if (!value) {
    return false;
  }

  const recordDate = new Date(value);

  if (
    Number.isNaN(
      recordDate.getTime()
    )
  ) {
    return false;
  }

  const recordTime =
    recordDate.getTime();

  if (fromDate) {
    const start =
      new Date(
        `${fromDate}T00:00:00`
      ).getTime();

    if (recordTime < start) {
      return false;
    }
  }

  if (toDate) {
    const end =
      new Date(
        `${toDate}T23:59:59.999`
      ).getTime();

    if (recordTime > end) {
      return false;
    }
  }

  return true;
}

function getDateRangeLabel(
  fromDate,
  toDate
) {
  if (
    fromDate &&
    toDate &&
    fromDate === toDate
  ) {
    return formatDateOnly(
      fromDate
    );
  }

  if (fromDate && toDate) {
    return `${formatDateOnly(
      fromDate
    )} - ${formatDateOnly(
      toDate
    )}`;
  }

  if (fromDate) {
    return `From ${formatDateOnly(
      fromDate
    )}`;
  }

  if (toDate) {
    return `Up to ${formatDateOnly(
      toDate
    )}`;
  }

  return "All Dates";
}

function getValue(
  row,
  keys,
  fallback = null
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

function safeFilePart(value) {
  return (
    clean(value)
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      ) ||
    "report"
  );
}

/* =========================================================
   SENSOR STATUS
========================================================= */


function averageFromNormalized(
  items,
  key
) {
  const values =
    items
      .map(
        (item) =>
          toNumberOrNull(
            item.normalized[
              key
            ]
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
      (
        sum,
        value
      ) =>
        sum + value,
      0
    );

  return (
    total /
    values.length
  ).toFixed(2);
}

/* =========================================================
   MARKET STATUS
========================================================= */

function getMarketStatus(
  row
) {
  const raw =
    normalizeStatusText(
      row?.status ||
        row
          ?.listing_status ||
        row
          ?.order_status ||
        row
          ?.payment_status ||
        row
          ?.reservation_status ||
        row
          ?.availability ||
        ""
    );

  if (
    raw.includes(
      "complete"
    )
  ) {
    return "completed";
  }

  if (
    raw.includes(
      "confirm"
    )
  ) {
    return "confirmed";
  }

  if (
    raw.includes(
      "paid"
    )
  ) {
    return "paid";
  }

  if (
    raw.includes(
      "sold"
    )
  ) {
    return "sold";
  }

  if (
    raw.includes(
      "cancel"
    )
  ) {
    return "cancelled";
  }

  if (
    raw.includes(
      "reject"
    )
  ) {
    return "rejected";
  }

  if (
    raw.includes(
      "pending"
    )
  ) {
    return "pending";
  }

  if (
    raw.includes(
      "active"
    ) ||
    raw.includes(
      "available"
    )
  ) {
    return "active";
  }

  return (
    raw ||
    "pending"
  );
}

function getFriendlyMarketStatus(
  status
) {
  switch (status) {
    case "active":
      return "Available";

    case "completed":
      return "Completed";

    case "confirmed":
      return "Confirmed";

    case "paid":
      return "Paid";

    case "sold":
      return "Sold";

    case "pending":
      return "Pending";

    case "cancelled":
      return "Cancelled";

    case "rejected":
      return "Rejected";

    default:
      return formatFriendlyText(
        status
      );
  }
}

/* =========================================================
   ALERT STATUS
========================================================= */

function getAlertSeverity(
  alert
) {
  const raw =
    normalizeStatusText(
      alert?.severity ||
        alert?.priority ||
        alert?.level ||
        alert?.status ||
        alert?.type ||
        ""
    );

  if (
    raw.includes(
      "critical"
    ) ||
    raw.includes(
      "danger"
    ) ||
    raw.includes(
      "unsafe"
    ) ||
    raw.includes(
      "high ph"
    ) ||
    raw.includes(
      "low ph"
    )
  ) {
    return "critical";
  }

  if (
    raw.includes(
      "warning"
    ) ||
    raw.includes(
      "medium"
    ) ||
    raw.includes(
      "dirty"
    ) ||
    raw.includes(
      "low"
    ) ||
    raw.includes(
      "high"
    )
  ) {
    return "warning";
  }

  return "normal";
}


/* =========================================================
   RECORD HELPERS
========================================================= */

function getOrderTotal(
  order
) {
  return getValue(
    order,
    [
      "total_price",
      "total",
      "amount",
      "price_total",
      "subtotal",
      "price",
    ],
    0
  );
}

function getRecordDate(
  row
) {
  return (
    row?.created_at ||
    row?.updated_at ||
    row?.timestamp ||
    row?.date ||
    ""
  );
}

function getMarketTitle(
  record,
  index
) {
  return (
    record?.title ||
    record?.product_name ||
    record
      ?.listing_title ||
    record?.item_name ||
    record?.name ||
    `Marketplace Record ${
      index + 1
    }`
  );
}

/* =========================================================
   TANK HELPERS
========================================================= */

function getTankKeys(
  tank
) {
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

function getRecordTankKeys(
  record
) {
  return [
    record?.tank_id,
    record?.tankId,
    record?.tank_uuid,
    record
      ?.tank_profile_id,
    record?.device_uid,
    record?.device_id,
    record?.iot_device_id,
  ]
    .filter(Boolean)
    .map(String);
}

function getTankName(
  tank,
  index = 0
) {
  return (
    tank?.name ||
    tank?.tank_name ||
    tank?.title ||
    tank?.label ||
    tank?.display_name ||
    `Tank ${index + 1}`
  );
}

function getTankOptionId(
  tank,
  index = 0
) {
  return String(
    tank?.id ||
      tank?.tank_id ||
      tank?.uuid ||
      tank?.device_uid ||
      tank
        ?.iot_device_id ||
      `tank-${index}`
  );
}

function getTankDisplayName(
  record,
  tanks,
  index = 0
) {
  const directName =
    record?.tank_name ||
    record?.tank_label ||
    record
      ?.tank_display_name;

  if (directName) {
    return directName;
  }

  const recordKeys =
    getRecordTankKeys(
      record
    );

  const matchedTank =
    tanks.find(
      (tank) => {
        const tankKeys =
          getTankKeys(
            tank
          );

        return (
          recordKeys.some(
            (key) =>
              tankKeys.includes(
                key
              )
          )
        );
      }
    );

  if (!matchedTank) {
    return `Tank ${
      index + 1
    }`;
  }

  return getTankName(
    matchedTank,
    index
  );
}

function recordMatchesTank(record, tank) {
  return !tank || recordMatchesMonitoringTank(record, tank);
}

/* =========================================================
   UNIQUE ROWS
========================================================= */

function uniqueRows(rows) {
  const map =
    new Map();

  rows.forEach(
    (
      row,
      index
    ) => {
      const id =
        row?.id ||
        row?.uuid ||
        row
          ?.reading_id ||
        row
          ?.alert_id ||
        row
          ?.listing_id ||
        row
          ?.order_id ||
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
  const { data } =
    await supabase
      .auth
      .getSession();

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
      .from(
        "profiles"
      )
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
        .from(
          "profiles"
        )
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
      user.id ||
      "",

    email:
      user.email ||
      "",

    role,

    isAdmin:
      role ===
      "admin",
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
        .from(
          tableName
        )
        .select("*")
        .order(
          "created_at",
          {
            ascending:
              false,
          }
        )
        .limit(
          limit
        );

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
        .limit(
          limit
        );

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
    const mergedRows =
      [];

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
              ascending:
                false,
            }
          )
          .limit(
            limit
          );

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
          .limit(
            limit
          );

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

async function fetchRowsByScope(
  tableNames,
  currentUser,
  limit = 400
) {
  if (
    currentUser.isAdmin
  ) {
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
      className={`cray-report-summary-card ${tone}`}
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

function BarRow({
  label,
  value,
  max,
  tone = "default",
}) {
  const width =
    max > 0
      ? `${Math.min(
          (
            value /
            max
          ) * 100,
          100
        )}%`
      : "0%";

  return (
    <div
      className={`cray-report-bar-row ${tone}`}
    >
      <div>
        <span>
          {label}
        </span>

        <strong>
          {formatNumber(
            value
          )}
        </strong>
      </div>

      <i>
        <b
          style={{
            width,
          }}
        />
      </i>
    </div>
  );
}

function DonutStat({
  label,
  value,
  total,
  tone = "default",
}) {
  const percent =
    total > 0
      ? Math.round(
          (
            value /
            total
          ) *
            100
        )
      : 0;

  return (
    <div
      className={`cray-report-donut ${tone}`}
    >
      <div
        style={{
          "--percent":
            `${percent}%`,
        }}
      >
        <strong>
          {percent}%
        </strong>
      </div>

      <span>
        {["Normal", "Warning", "Critical"].includes(label) ? <SafetyBadge severity={{ success: "normal", warning: "warning", danger: "critical" }[tone]} /> : label}
      </span>

      <small>
        {formatNumber(
          value
        )}{" "}
        of{" "}
        {formatNumber(
          total
        )}
      </small>
    </div>
  );
}

/* =========================================================
   THEME-AWARE DROPDOWN
========================================================= */

function ReportFilterDropdown({
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
    useState(
      false
    );

  const dropdownRef =
    useRef(
      null
    );

  const selectedOption =
    options.find(
      (option) =>
        option.value ===
        value
    ) ||
    options[0];

  useEffect(
    () => {
      function handleOutsideClick(
        event
      ) {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(
            event.target
          )
        ) {
          setIsOpen(
            false
          );
        }
      }

      function handleEscape(
        event
      ) {
        if (
          event.key ===
          "Escape"
        ) {
          setIsOpen(
            false
          );
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
    },
    []
  );

  function handleSelect(
    option
  ) {
    onChange(
      option.value
    );

    setIsOpen(
      false
    );
  }

  return (
    <div
      ref={
        dropdownRef
      }
      style={
        reportDropdownWrapStyle
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
            (
              current
            ) =>
              !current
          )
        }
        style={{
          ...reportDropdownTriggerStyle,

          ...(isOpen
            ? reportDropdownTriggerOpenStyle
            : {}),
        }}
      >
        <Icon
          size={17}
          style={
            reportDropdownIconStyle
          }
        />

        <span
          style={
            reportDropdownSelectedTextStyle
          }
        >
          {
            selectedOption
              ?.label
          }
        </span>

        <ChevronDown
          size={16}
          style={{
            ...reportDropdownChevronStyle,

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
            reportDropdownMenuStyle
          }
        >
          {options.map(
            (
              option
            ) => {
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
                    ...reportDropdownItemStyle,

                    ...(isSelected
                      ? reportDropdownItemActiveStyle
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
                      size={
                        15
                      }
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

export default function ReportsPage() {
  const [
    activeReport,
    setActiveReport,
  ] =
    useState(
      "tanks"
    );

  const [
    selectedTankId,
    setSelectedTankId,
  ] =
    useState(
      "all"
    );

  const [
    fromDate,
    setFromDate,
  ] =
    useState(
      ""
    );

  const [
    toDate,
    setToDate,
  ] =
    useState(
      ""
    );

  const [
    datasets,
    setDatasets,
  ] =
    useState({
      tanks: [],
      readings: [],
      ammonia: [],
      alerts: [],
      listings: [],
      orders: [],
    });

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(
      true
    );

  const [
    isRefreshing,
    setIsRefreshing,
  ] =
    useState(
      false
    );

  const [
    lastUpdated,
    setLastUpdated,
  ] =
    useState(
      null
    );

  /* =======================================================
     LOAD REPORT DATA
  ======================================================= */

  const [thresholds, setThresholds] = useState(null);
  const [conditionFilter, setConditionFilter] = useState("all");

  const loadReports =
    async (
      showFullLoading =
        false
    ) => {
      setThresholds(await loadActiveThresholds());
      if (
        !isSupabaseConfigured ||
        !supabase
      ) {
        setIsLoading(
          false
        );

        setIsRefreshing(
          false
        );

        return;
      }

      try {
        if (
          showFullLoading
        ) {
          setIsLoading(
            true
          );
        } else {
          setIsRefreshing(
            true
          );
        }

        const currentUser =
          await getCurrentUserWithRole();

        if (
          !currentUser.id
        ) {
          setDatasets({
            tanks: [],
            readings: [],
      ammonia: [],
            alerts: [],
            listings: [],
            orders: [],
          });

          return;
        }

        const [
          tanks,
          readings,
          alerts,
          listings,
          orders,
          ammonia,
        ] =
          await Promise.all([
            fetchRowsByScope(
              tableGroups.tanks,
              currentUser,
              500
            ),

            fetchRowsByScope(
              tableGroups.readings,
              currentUser,
              1000
            ),

            fetchRowsByScope(
              tableGroups.alerts,
              currentUser,
              1000
            ),

            fetchRowsByScope(
              tableGroups.listings,
              currentUser,
              1000
            ),

            fetchRowsByScope(
              tableGroups.orders,
              currentUser,
              1000
            ),
            fetchRowsByScope(tableGroups.ammonia, currentUser, 1000),
          ]);

        setDatasets({
          tanks:
            tanks.rows,

          readings:
            readings.rows,

          ammonia: ammonia.rows,

          alerts:
            alerts.rows,

          listings:
            listings.rows,

          orders:
            orders.rows,
        });

        setLastUpdated(
          new Date()
        );
      } catch (
        error
      ) {
        console.error(
          "Reports loading error:",
          error
        );
      } finally {
        setIsLoading(
          false
        );

        setIsRefreshing(
          false
        );
      }
    };

  useEffect(
    () => {
      loadReports(
        true
      );
    },
    []
  );

  /* =======================================================
     DATE CONTROLS
  ======================================================= */

  const dateRangeLabel =
    getDateRangeLabel(
      fromDate,
      toDate
    );

  function handleFromDateChange(
    event
  ) {
    const value =
      event.target.value;

    setFromDate(
      value
    );

    if (
      value &&
      toDate &&
      value >
        toDate
    ) {
      setToDate(
        value
      );
    }
  }

  function handleToDateChange(
    event
  ) {
    const value =
      event.target.value;

    setToDate(
      value
    );

    if (
      value &&
      fromDate &&
      value <
        fromDate
    ) {
      setFromDate(
        value
      );
    }
  }

  function clearDateRange() {
    setFromDate(
      ""
    );

    setToDate(
      ""
    );
  }

  /* =======================================================
     TANK OPTIONS
  ======================================================= */

  const tankOptions =
    useMemo(
      () => {
        return datasets
          .tanks
          .map(
            (
              tank,
              index
            ) => ({
              id:
                getTankOptionId(
                  tank,
                  index
                ),

              name:
                getTankName(
                  tank,
                  index
                ),

              tank,
            })
          )
          .sort(
            (
              a,
              b
            ) =>
              a.name.localeCompare(
                b.name
              )
          );
      },
      [
        datasets.tanks,
      ]
    );

  const selectedTankOption =
    useMemo(
      () => {
        if (
          selectedTankId ===
          "all"
        ) {
          return null;
        }

        return (
          tankOptions.find(
            (
              option
            ) =>
              option.id ===
              selectedTankId
          ) ||
          null
        );
      },
      [
        tankOptions,
        selectedTankId,
      ]
    );

  const selectedTank =
    selectedTankOption
      ?.tank ||
    null;

  const selectedTankName =
    selectedTankId ===
    "all"
      ? "All Tanks"
      : selectedTankOption
          ?.name ||
        "Selected Tank";

  useEffect(
    () => {
      if (
        selectedTankId !==
          "all" &&
        !tankOptions.some(
          (
            option
          ) =>
            option.id ===
            selectedTankId
        )
      ) {
        setSelectedTankId(
          "all"
        );
      }
    },
    [
      tankOptions,
      selectedTankId,
    ]
  );

  /* =======================================================
     READINGS
  ======================================================= */

  const monitoringRecords = useMemo(
    () => buildMonitoringRecords(datasets.readings, datasets.ammonia, datasets.tanks, thresholds),
    [datasets.readings, datasets.ammonia, datasets.tanks, thresholds]
  );
  const enrichedReadings = useMemo(() => monitoringRecords.filter(item => item.type === "Water Reading"), [monitoringRecords]);
  const enrichedAmmonia = useMemo(() => monitoringRecords.filter(item => item.type === "Ammonia Reading"), [monitoringRecords]);

  /* =======================================================
     DATE + TANK SCOPED DATA
  ======================================================= */

  const scopedTankRecords = useMemo(() => monitoringRecords.filter(item =>
    (selectedTankId === "all" || (selectedTank && recordMatchesMonitoringTank(item.reading, selectedTank))) &&
    isWithinDateRange(item.date, fromDate, toDate)),
    [monitoringRecords, selectedTankId, selectedTank, fromDate, toDate]);

  const tankReadings =
    useMemo(
      () => {
        let scopedReadings =
          enrichedReadings;

        if (
          selectedTankId !==
            "all" &&
          selectedTank
        ) {
          scopedReadings =
            scopedReadings.filter(
              (
                item
              ) =>
                recordMatchesTank(
                  item.reading,
                  selectedTank
                )
            );
        }

        return scopedReadings.filter(
          (
            item
          ) =>
            (conditionFilter === "all" || item.status === conditionFilter) &&
            isWithinDateRange(
              item.date,
              fromDate,
              toDate
            )
        );
      },
      [
        enrichedReadings,
        selectedTankId,
        selectedTank,
        fromDate,
        toDate,
        conditionFilter,
      ]
    );

  const tankAmmonia = useMemo(() => enrichedAmmonia.filter(item =>
    (selectedTankId === "all" || (selectedTank && recordMatchesMonitoringTank(item.reading, selectedTank))) &&
    isWithinDateRange(item.date, fromDate, toDate) &&
    (conditionFilter === "all" || item.status === conditionFilter)),
    [enrichedAmmonia, selectedTankId, selectedTank, fromDate, toDate, conditionFilter]);
  const tankRecords = useMemo(() => [...tankReadings, ...tankAmmonia]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)), [tankReadings, tankAmmonia]);

  const tankAlerts =
    useMemo(
      () => {
        let scopedAlerts =
          datasets.alerts;

        if (
          selectedTankId !==
            "all" &&
          selectedTank
        ) {
          scopedAlerts =
            scopedAlerts.filter(
              (
                alert
              ) =>
                recordMatchesTank(
                  alert,
                  selectedTank
                )
            );
        }

        return scopedAlerts.filter(
          (
            alert
          ) =>
            (conditionFilter === "all" || getAlertSeverity(alert) === conditionFilter) &&
            isWithinDateRange(
              getRecordDate(
                alert
              ),
              fromDate,
              toDate
            )
        );
      },
      [
        datasets.alerts,
        selectedTankId,
        selectedTank,
        fromDate,
        toDate,
        conditionFilter,
      ]
    );

  const marketListings =
    useMemo(
      () => {
        return datasets
          .listings
          .filter(
            (
              listing
            ) =>
              isWithinDateRange(
                getRecordDate(
                  listing
                ),
                fromDate,
                toDate
              )
          );
      },
      [
        datasets.listings,
        fromDate,
        toDate,
      ]
    );

  const marketOrders =
    useMemo(
      () => {
        return datasets
          .orders
          .filter(
            (
              order
            ) =>
              isWithinDateRange(
                getRecordDate(
                  order
                ),
                fromDate,
                toDate
              )
          );
      },
      [
        datasets.orders,
        fromDate,
        toDate,
      ]
    );

  const latestReading = scopedTankRecords.find(item => item.type === "Water Reading") || null;

  const latestAmmonia = scopedTankRecords.filter(item => item.type === "Ammonia Reading").find(item => !latestReading || item.tankKey === latestReading.tankKey) || null;
  const currentSafety = evaluateCurrentTankSafety(latestReading, latestAmmonia, thresholds);
  const currentTankName = latestReading?.tankName || latestAmmonia?.tankName || selectedTankName;

  /* =======================================================
     TANK ANALYTICS
  ======================================================= */

  const tankAnalytics =
    useMemo(
      () => {
        const normal =
          tankRecords.filter(
            (
              item
            ) =>
              item.status ===
              "normal"
          ).length;

        const warning =
          tankRecords.filter(
            (
              item
            ) =>
              item.status ===
              "warning"
          ).length;

        const critical =
          tankRecords.filter(
            (
              item
            ) =>
              item.status ===
              "critical"
          ).length;

        const phWarning =
          tankReadings.filter(
            (
              item
            ) =>
              [
                "warning",
                "critical",
              ].includes(
                item.normalized.safety.parameters.ph.severity
              )
          ).length;

        const waterClarityWarning =
          tankReadings.filter(
            (
              item
            ) =>
              [
                "warning",
                "critical",
              ].includes(
                item.normalized.safety.parameters.turbidity.severity
              )
          ).length;

        const alertCritical =
          tankAlerts.filter(
            (
              alert
            ) =>
              getAlertSeverity(
                alert
              ) ===
              "critical"
          ).length;

        return {
          totalTanks:
            selectedTankId ===
            "all"
              ? datasets
                  .tanks
                  .length
              : selectedTank
                ? 1
                : 0,

          totalReadings:
            tankReadings
              .length,

          totalRecords: tankRecords.length,
          totalAmmonia: tankAmmonia.length,
          ammoniaIssues: tankAmmonia.filter(item => ["warning", "critical"].includes(item.status)).length,

          totalAlerts:
            tankAlerts
              .length,

          normal,
          warning,
          critical,
          alertCritical,
          phWarning,
          waterClarityWarning,

          avgTemp:
            averageFromNormalized(
              tankReadings,
              "temperatureValue"
            ),

          avgWaterLevel:
            averageFromNormalized(
              tankReadings,
              "waterValue"
            ),

        };
      },
      [
        datasets.tanks,
        selectedTankId,
        selectedTank,
        tankReadings,
        tankAmmonia,
        tankRecords,
        tankAlerts,
      ]
    );

  /* =======================================================
     MARKETPLACE ANALYTICS
  ======================================================= */

  const marketAnalytics =
    useMemo(
      () => {
        const activeListings =
          marketListings.filter(
            (
              listing
            ) =>
              getMarketStatus(
                listing
              ) ===
              "active"
          ).length;

        const soldListings =
          marketListings.filter(
            (
              listing
            ) =>
              getMarketStatus(
                listing
              ) ===
              "sold"
          ).length;

        const completedOrders =
          marketOrders.filter(
            (
              order
            ) =>
              [
                "completed",
                "confirmed",
                "paid",
              ].includes(
                getMarketStatus(
                  order
                )
              )
          );

        const pendingOrders =
          marketOrders.filter(
            (
              order
            ) =>
              getMarketStatus(
                order
              ) ===
              "pending"
          ).length;

        const cancelledOrders =
          marketOrders.filter(
            (
              order
            ) =>
              [
                "cancelled",
                "rejected",
              ].includes(
                getMarketStatus(
                  order
                )
              )
          ).length;

        const totalSales =
          completedOrders.reduce(
            (
              sum,
              order
            ) =>
              sum +
              Number(
                getOrderTotal(
                  order
                ) ||
                  0
              ),
            0
          );

        const completionRate =
          marketOrders
            .length >
          0
            ? Math.round(
                (
                  completedOrders
                    .length /
                  marketOrders
                    .length
                ) *
                  100
              )
            : 0;

        return {
          totalListings:
            marketListings
              .length,

          activeListings,

          soldListings,

          totalOrders:
            marketOrders
              .length,

          completedOrders:
            completedOrders
              .length,

          pendingOrders,

          cancelledOrders,

          totalSales,

          completionRate,
        };
      },
      [
        marketListings,
        marketOrders,
      ]
    );

  /* =======================================================
     GRAPH DATA
  ======================================================= */

  const tankBars =
    [
      {
        label:
          "Normal readings",

        value:
          tankAnalytics
            .normal,

        tone:
          "success",
      },

      {
        label:
          "Warning readings",

        value:
          tankAnalytics
            .warning,

        tone:
          "warning",
      },

      {
        label:
          "Critical readings",

        value:
          tankAnalytics
            .critical,

        tone:
          "danger",
      },

      { label: "Ammonia issues", value: tankAnalytics.ammoniaIssues, tone: "danger" },
      {
        label:
          "pH issues",

        value:
          tankAnalytics
            .phWarning,

        tone:
          "warning",
      },

      {
        label:
          "Water clarity issues",

        value:
          tankAnalytics
            .waterClarityWarning,

        tone:
          "warning",
      },

      {
        label:
          "Critical alerts",

        value:
          tankAnalytics
            .alertCritical,

        tone:
          "danger",
      },
    ];

  const marketBars =
    [
      {
        label:
          "Available listings",

        value:
          marketAnalytics
            .activeListings,

        tone:
          "success",
      },

      {
        label:
          "Sold listings",

        value:
          marketAnalytics
            .soldListings,

        tone:
          "default",
      },

      {
        label:
          "Completed orders",

        value:
          marketAnalytics
            .completedOrders,

        tone:
          "success",
      },

      {
        label:
          "Pending orders",

        value:
          marketAnalytics
            .pendingOrders,

        tone:
          "warning",
      },

      {
        label:
          "Cancelled orders",

        value:
          marketAnalytics
            .cancelledOrders,

        tone:
          "danger",
      },
    ];

  const maxTankBar =
    Math.max(
      1,
      ...tankBars.map(
        (
          item
        ) =>
          item.value
      )
    );

  const maxMarketBar =
    Math.max(
      1,
      ...marketBars.map(
        (
          item
        ) =>
          item.value
      )
    );

  /* =======================================================
     RECENT TANK RECORDS
  ======================================================= */

  const recentTankRecords =
    useMemo(
      () => {
        const alerts =
          tankAlerts.map(
            (
              alert,
              index
            ) => ({
              type:
                "Alert",

              title:
                alert
                  ?.title ||
                alert
                  ?.alert_title ||
                alert
                  ?.notification_title ||
                alert
                  ?.type ||
                `Alert ${
                  index +
                  1
                }`,

              tankName:
                getTankDisplayName(
                  alert,
                  datasets.tanks,
                  index
                ),

              status:
                getAlertSeverity(
                  alert
                ),

              date:
                getRecordDate(
                  alert
                ),
            })
          );

        const readings =
          tankReadings.map(
            (
              item
            ) => ({
              type:
                "Water Reading",

              title:
                item.name,

              tankName:
                item.name,

              status:
                item.status,

              date:
                item.date,

              ph:
                item
                  .normalized
                  .phNumberLabel,

              waterClarity:
                item
                  .normalized
                  .turbidityStatus,
            })
          );

        return [
          ...alerts,
          ...readings,
          ...tankAmmonia.map(item => ({ type: item.type, title: item.ammoniaLabel,
            tankName: item.tankName, status: item.status, date: item.date })),
        ]
          .sort(
            (
              a,
              b
            ) =>
              new Date(
                b.date ||
                  0
              ) -
              new Date(
                a.date ||
                  0
              )
          )
          .slice(
            0,
            6
          );
      },
      [
        tankAlerts,
        tankReadings,
        tankAmmonia,
        datasets.tanks,
      ]
    );

  /* =======================================================
     RECENT MARKETPLACE RECORDS
  ======================================================= */

  const recentMarketRecords =
    useMemo(
      () => {
        return [
          ...marketOrders,
          ...marketListings,
        ]
          .map(
            (
              record,
              index
            ) => ({
              title:
                getMarketTitle(
                  record,
                  index
                ),

              status:
                getMarketStatus(
                  record
                ),

              date:
                getRecordDate(
                  record
                ),
            })
          )
          .sort(
            (
              a,
              b
            ) =>
              new Date(
                b.date ||
                  0
              ) -
              new Date(
                a.date ||
                  0
              )
          )
          .slice(
            0,
            6
          );
      },
      [
        marketOrders,
        marketListings,
      ]
    );

  /* =======================================================
     EXPORT — TANK REPORT
  ======================================================= */

  const tankExportRows =
    useMemo(
      () => {
        const readingRows = buildTankHistoryExportRows(tankRecords, formatDate);

        const alertRows =
          tankAlerts.map(
            (
              alert,
              index
            ) => ({
              Type:
                "Alert",

              Tank:
                getTankDisplayName(
                  alert,
                  datasets.tanks,
                  index
                ),

              Name:
                alert
                  ?.title ||
                alert
                  ?.alert_title ||
                alert
                  ?.notification_title ||
                alert
                  ?.type ||
                `Alert ${
                  index +
                  1
                }`,

              Priority:
                getSafetyStatusLabel(
                  getAlertSeverity(
                    alert
                  )
                ),

              Status:
                formatFriendlyText(
                  alert
                    ?.status ||
                    alert
                      ?.alert_status ||
                    "Open"
                ),

              Message:
                alert
                  ?.message ||
                alert
                  ?.description ||
                alert
                  ?.body ||
                "N/A",

              Date:
                formatDate(
                  getRecordDate(
                    alert
                  )
                ),
            })
          );

        return [
          ...readingRows,
          ...alertRows,
        ];
      },
      [
        tankRecords,
        tankAlerts,
        datasets.tanks,
      ]
    );

  /* =======================================================
     EXPORT — MARKETPLACE REPORT
  ======================================================= */

  const marketExportRows =
    useMemo(
      () => {
        const listingRows =
          marketListings.map(
            (
              listing,
              index
            ) => ({
              Type:
                "Marketplace Listing",

              Name:
                getMarketTitle(
                  listing,
                  index
                ),

              Status:
                getFriendlyMarketStatus(
                  getMarketStatus(
                    listing
                  )
                ),

              Price:
                formatPeso(
                  getValue(
                    listing,
                    [
                      "price",
                      "amount",
                      "unit_price",
                      "selling_price",
                    ],
                    0
                  )
                ),

              Stock:
                getValue(
                  listing,
                  [
                    "stock",
                    "quantity",
                    "available_count",
                  ],
                  "N/A"
                ),

              Date:
                formatDate(
                  getRecordDate(
                    listing
                  )
                ),
            })
          );

        const orderRows =
          marketOrders.map(
            (
              order,
              index
            ) => ({
              Type:
                "Marketplace Order",

              Name:
                getMarketTitle(
                  order,
                  index
                ),

              Status:
                getFriendlyMarketStatus(
                  getMarketStatus(
                    order
                  )
                ),

              Amount:
                formatPeso(
                  getOrderTotal(
                    order
                  )
                ),

              Quantity:
                getValue(
                  order,
                  [
                    "quantity",
                    "qty",
                    "count",
                    "order_quantity",
                  ],
                  "N/A"
                ),

              Date:
                formatDate(
                  getRecordDate(
                    order
                  )
                ),
            })
          );

        return [
          ...listingRows,
          ...orderRows,
        ];
      },
      [
        marketListings,
        marketOrders,
      ]
    );

  /* =======================================================
     EXPORT HELPERS
  ======================================================= */

  function getTankReportSection() {
    return {
      title:
        selectedTankId ===
        "all"
          ? "Tank Reports"
          : `${selectedTankName} — Tank Report`,

      description:
        selectedTankId ===
        "all"
          ? `Sensor readings, ammonia results, water conditions, and alert history for all tanks. Date range: ${dateRangeLabel}.`
          : `Sensor readings, ammonia results, water conditions, and alert history for ${selectedTankName}. Date range: ${dateRangeLabel}.`,

      rows:
        tankExportRows,
    };
  }

  function getMarketplaceReportSection() {
    return {
      title:
        "Marketplace Reports",

      description:
        `Marketplace listings, orders, reservations, and sales activity. Date range: ${dateRangeLabel}.`,

      rows:
        marketExportRows,
    };
  }

  function getSelectedReportSections() {
    if (
      activeReport ===
      "tanks"
    ) {
      return [
        getTankReportSection(),
      ];
    }

    return [
      getMarketplaceReportSection(),
    ];
  }

  function handleExportReportsCsv() {
    const sections =
      getSelectedReportSections();

    const rows =
      sections.flatMap(
        (
          section
        ) =>
          section.rows.map(
            (
              row
            ) => ({
              Section:
                section.title,

              "Date Range":
                dateRangeLabel,

              ...row,
            })
          )
      );

    const dateFilePart =
      fromDate ||
      toDate
        ? `-${
            fromDate ||
            "start"
          }-to-${
            toDate ||
            "latest"
          }`
        : "";

    let filename;

    if (
      activeReport ===
      "tanks"
    ) {
      filename =
        selectedTankId ===
        "all"
          ? `craythrive-all-tanks-report${dateFilePart}.csv`
          : `craythrive-${safeFilePart(
              selectedTankName
            )}-report${dateFilePart}.csv`;
    } else {
      filename =
        `craythrive-marketplace-report${dateFilePart}.csv`;
    }

    downloadCsv(
      filename,
      rows
    );
  }

  function handlePrintReports() {
    const sections =
      getSelectedReportSections();

    let title;
    let subtitle;

    if (
      activeReport ===
      "tanks"
    ) {
      title =
        "CrayThrive Tank Report";

      subtitle =
        selectedTankId ===
        "all"
          ? `All Tanks • ${dateRangeLabel}`
          : `${selectedTankName} • ${dateRangeLabel}`;
    } else {
      title =
        "CrayThrive Marketplace Report";

      subtitle =
        `Marketplace • ${dateRangeLabel}`;
    }

    printReport({
      title,
      subtitle,
      sections,
    });
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    isLoading
  ) {
    return (
      <section className="cray-report-loading">
        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading reports...
        </h3>

        <p>
          Preparing your latest
          tank and marketplace
          information.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="cray-reports-page" data-report={activeReport}>

      {/* ===============================================
          HERO
      ================================================ */}

      <section className="cray-reports-hero">
        <div>
          <p className="dashboard-eyebrow">
            Reports
          </p>

          <h2>
            See how your tanks
            and marketplace are
            doing.
          </h2>

          <p>
            Choose a report type
            and date range. Tank
            and marketplace reports
            are now kept separate
            for clearer exports.
          </p>

          <div className="cray-report-actions">
            <button
              type="button"
              className="dashboard-primary-button"
              disabled={
                isRefreshing
              }
              onClick={() =>
                loadReports(
                  false
                )
              }
            >
              <RefreshCw
                size={18}
                className={
                  isRefreshing
                    ? "spin-icon"
                    : ""
                }
              />

              {isRefreshing
                ? "Refreshing..."
                : "Refresh"}
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

        <div className="cray-report-hero-card">
          <FileText
            size={34}
          />

          <strong>
            {activeReport ===
            "tanks"
              ? selectedTankId ===
                "all"
                ? "All Tanks"
                : selectedTankName
              : "Marketplace"}
          </strong>

          <span>
            {dateRangeLabel}
          </span>
        </div>
      </section>

      {/* ===============================================
          REPORT TABS
      ================================================ */}

      <section className="cray-report-tabs">
        <button
          type="button"
          className={
            activeReport ===
            "tanks"
              ? "is-active"
              : ""
          }
          onClick={() =>
            setActiveReport(
              "tanks"
            )
          }
        >
          <Droplets
            size={18}
          />

          Tank Report
        </button>

        <button
          type="button"
          className={
            activeReport ===
            "market"
              ? "is-active"
              : ""
          }
          onClick={() =>
            setActiveReport(
              "market"
            )
          }
        >
          <ShoppingBag
            size={18}
          />

          Marketplace Report
        </button>
      </section>

      {/* ===============================================
          DATE + EXPORT CONTROLS
      ================================================ */}

      <section
        className="cray-report-exportbar"
        style={
          reportExportBarStyle
        }
      >
        <div
          style={
            reportDateFieldStyle
          }
        >
          <label
            htmlFor="report-from-date"
            style={
              reportDateLabelStyle
            }
          >
            <CalendarDays
              size={14}
            />

            From Date
          </label>

          <input
            id="report-from-date"
            type="date"
            value={
              fromDate
            }
            max={
              toDate ||
              undefined
            }
            onChange={
              handleFromDateChange
            }
            style={
              reportDateInputStyle
            }
          />
        </div>

        <div
          style={
            reportDateFieldStyle
          }
        >
          <label
            htmlFor="report-to-date"
            style={
              reportDateLabelStyle
            }
          >
            <CalendarDays
              size={14}
            />

            To Date
          </label>

          <input
            id="report-to-date"
            type="date"
            value={
              toDate
            }
            min={
              fromDate ||
              undefined
            }
            onChange={
              handleToDateChange
            }
            style={
              reportDateInputStyle
            }
          />
        </div>

        {activeReport ===
          "tanks" && (
          <ReportFilterDropdown
            ariaLabel="Choose which tank to include in the report"
            icon={
              Droplets
            }
            value={
              selectedTankId
            }
            options={[
              {
                value:
                  "all",

                label:
                  "All Tanks",
              },

              ...tankOptions.map(
                (
                  option
                ) => ({
                  value:
                    option.id,

                  label:
                    option.name,
                })
              ),
            ]}
            onChange={
              setSelectedTankId
            }
          />
        )}

        {activeReport === "tanks" && <ReportFilterDropdown ariaLabel="Filter monitoring records by condition"
          icon={Gauge} value={conditionFilter} onChange={setConditionFilter}
          options={[{ value: "all", label: "All" }, ...["normal", "warning", "critical"].map(value => ({ value, label: getSafetyStatusLabel(value) }))]} />}

        {(fromDate ||
          toDate) && (
          <button
            type="button"
            onClick={
              clearDateRange
            }
          >
            Clear Dates
          </button>
        )}

        <button
          type="button"
          onClick={
            handleExportReportsCsv
          }
        >
          <Download
            size={18}
          />

          Export CSV
        </button>

        <button
          type="button"
          onClick={
            handlePrintReports
          }
        >
          <Printer
            size={18}
          />

          Print Report
        </button>
      </section>

      {/* ===============================================
          ACTIVE RANGE
      ================================================ */}

      <section
        style={
          reportRangeNoticeStyle
        }
      >
        <CalendarDays
          size={17}
        />

        <div>
          <strong>
            Report period:{" "}
            {dateRangeLabel}
          </strong>

          <span>
            {activeReport ===
            "tanks"
              ? "Tank readings, alerts, analytics, CSV, and print output use this date range."
              : "Marketplace listings, orders, sales analytics, CSV, and print output use this date range."}
          </span>
        </div>
      </section>

      {/* ===============================================
          ACTIVE REPORT
      ================================================ */}

      {activeReport ===
      "tanks" ? (
        <>
          {/* =============================================
              TANK REPORT HEADER
          ============================================== */}

          <section className="cray-report-panel">
            <div className="cray-report-panel-heading">
              <div>
                <p className="dashboard-eyebrow">
                  Report For
                </p>

                <h3>
                  {
                    selectedTankName
                  }
                </h3>
              </div>

              <Droplets
                size={22}
              />
            </div>

            <div className="cray-report-row">
              <div>
                <strong>
                  {selectedTankId ===
                  "all"
                    ? "Combined tank report"
                    : "Specific tank report"}
                </strong>

                <span>
                  {selectedTankId ===
                  "all"
                    ? `All registered tanks are included for ${dateRangeLabel}.`
                    : `Only readings and alerts linked to ${selectedTankName} are included for ${dateRangeLabel}.`}
                </span>
              </div>

              <b className="cray-report-chip normal">
                {
                  tankAnalytics
                    .totalReadings
                }{" "}
                readings
              </b>
            </div>
          </section>

          {/* =============================================
              TANK SUMMARY
          ============================================== */}

          <section className="cray-report-summary-grid">
            <SummaryCard
              icon={
                Droplets
              }
              label={
                selectedTankId ===
                "all"
                  ? "Tanks"
                  : "Selected Tank"
              }
              value={
                selectedTankId ===
                "all"
                  ? tankAnalytics
                      .totalTanks
                  : "1"
              }
              helper={
                selectedTankId ===
                "all"
                  ? "Registered tanks"
                  : selectedTankName
              }
            />

            <SummaryCard
              icon={
                Activity
              }
              label="Water Readings"
              value={
                tankAnalytics
                  .totalReadings
              }
              helper={`Saved records • ${dateRangeLabel}`}
            />

            <SummaryCard
              icon={
                AlertTriangle
              }
              label="Critical Alerts"
              value={
                tankAnalytics
                  .alertCritical
              }
              helper={`${tankAnalytics.totalAlerts} total alert records`}
              tone="danger"
            />

            <SummaryCard
              icon={
                Waves
              }
              label="Water Clarity Issues"
              value={
                tankAnalytics
                  .waterClarityWarning
              }
              helper="Readings that need checking"
              tone={
                tankAnalytics
                  .waterClarityWarning >
                0
                  ? "warning"
                  : "success"
              }
            />
          </section>

          <section className="cray-report-panel monitoring-ammonia-history">
            <div className="cray-report-panel-heading"><div><p className="dashboard-eyebrow">Ammonia Results</p>
              <h3>{tankAmmonia.length} manual scan records</h3></div><FlaskConical size={22} /></div>
            {tankAmmonia.length === 0 ? <p>No ammonia scans in this tank/date/condition selection.</p> :
              <div className="cray-report-list">{tankAmmonia.slice(0, 8).map(item => (
                <div className="cray-report-row" key={item.recordId}>
                  <div><strong>Ammonia Reading - {item.tankName}</strong>
                    <span>{item.ammoniaLabel} - {formatDate(item.date)}</span></div>
                  <SafetyBadge severity={item.status} emptyLabel="No Scan" />
                </div>
              ))}</div>}
          </section>

          {/* =============================================
              TANK ANALYTICS
          ============================================== */}

          <section className="cray-report-grid">

            {/* WATER OVERVIEW */}

            <article className="cray-report-panel">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Water Overview
                  </p>

                  <h3>
                    {selectedTankId ===
                    "all"
                      ? "General water condition"
                      : `${selectedTankName} water condition`}
                  </h3>
                </div>

                <Gauge
                  size={22}
                />
              </div>

              <SafetyBadge severity={getSafetySeverity(currentSafety)} />
              <p>Latest available condition for {currentTankName}. Each reading keeps its own timestamp.</p>
              <div className="cray-report-metric-grid">
                {[
                  ["Temperature", latestReading?.normalized.temperatureLabel || "No Data", "temperature", Thermometer, latestReading?.date],
                  ["pH Level", latestReading?.normalized.phNumberLabel || "No Data", "ph", Droplets, latestReading?.date],
                  ["Water Clarity", latestReading?.normalized.turbidityNumberLabel || "No Data", "turbidity", Waves, latestReading?.date],
                  ["Water Level", latestReading?.normalized.waterLabel || "No Data", "waterLevel", Gauge, latestReading?.date],
                  ["Latest Ammonia", latestAmmonia?.ammoniaLabel || "No Scan", "ammonia", FlaskConical, latestAmmonia?.date],
                ].map(([label, value, key, Icon, date]) => (
                  <div key={key}>
                    <Icon size={20} /><strong>{value}</strong><span>{label}</span>
                    <SafetyBadge severity={currentSafety.parameters[key].severity} emptyLabel={key === "ammonia" ? "No Scan" : "No Data"} />
                    {getParameterExplanation(currentSafety.parameters[key], key === "ammonia" ? "Ammonia" : label) &&
                      <small className="safety-explanation">{getParameterExplanation(currentSafety.parameters[key], key === "ammonia" ? "Ammonia" : label)}</small>}
                    <small>{date ? formatDate(date) : "No record"}</small>
                  </div>
                ))}
              </div>
            </article>

            {/* CONDITION BREAKDOWN */}

            <article className="cray-report-panel">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Condition Breakdown
                  </p>

                  <h3>
                    Water activity
                  </h3>
                </div>

                <BarChart3
                  size={22}
                />
              </div>

              <div className="cray-report-bars">
                {tankBars.map(
                  (
                    item
                  ) => (
                    <BarRow
                      key={
                        item.label
                      }
                      label={
                        item.label
                      }
                      value={
                        item.value
                      }
                      max={
                        maxTankBar
                      }
                      tone={
                        item.tone
                      }
                    />
                  )
                )}
              </div>
            </article>

            {/* READING HEALTH */}

            <article className="cray-report-panel cray-report-wide">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Reading Health
                  </p>

                  <h3>
                    Monitoring record
                    percentage
                  </h3>
                </div>

                <PieChart
                  size={22}
                />
              </div>

              <div className="cray-report-donut-grid">
                <DonutStat
                  label="Normal"
                  value={
                    tankAnalytics
                      .normal
                  }
                  total={
                    tankAnalytics
                      .totalRecords
                  }
                  tone="success"
                />

                <DonutStat
                  label="Warning"
                  value={
                    tankAnalytics
                      .warning
                  }
                  total={
                    tankAnalytics
                      .totalRecords
                  }
                  tone="warning"
                />

                <DonutStat
                  label="Critical"
                  value={
                    tankAnalytics
                      .critical
                  }
                  total={
                    tankAnalytics
                      .totalRecords
                  }
                  tone="danger"
                />
              </div>
            </article>

            {/* RECENT ACTIVITY */}

            <article className="cray-report-panel cray-report-wide">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Recent Activity
                  </p>

                  <h3>
                    {selectedTankId ===
                    "all"
                      ? "Latest tank records"
                      : `${selectedTankName} records`}
                  </h3>
                </div>

                <Activity
                  size={22}
                />
              </div>

              <div className="cray-report-list">
                {recentTankRecords
                  .length ===
                0 ? (
                  <div className="cray-report-empty-small">
                    <CheckCircle2
                      size={28}
                    />

                    <strong>
                      No tank
                      records found
                    </strong>

                    <span>
                      No readings
                      or alerts
                      were found
                      for this tank
                      and date
                      selection.
                    </span>
                  </div>
                ) : (
                  recentTankRecords.map(
                    (
                      record,
                      index
                    ) => (
                      <div
                        className="cray-report-row"
                        key={`${record.type}-${index}`}
                      >
                        <div>
                          <strong>
                            {record.type ===
                            "Water Reading"
                              ? record.title
                              : `${record.type}: ${record.title}`}
                          </strong>

                          <span>
                            {record.tankName
                              ? `${record.tankName} • `
                              : ""}

                            {formatDate(
                              record.date
                            )}

                            {record.ph
                              ? ` • pH: ${formatFriendlyText(
                                  record.ph
                                )}`
                              : ""}

                            {record.waterClarity
                              ? ` • Clarity: ${formatFriendlyText(
                                  record.waterClarity
                                )}`
                              : ""}
                          </span>
                        </div>

                        <SafetyBadge className="cray-report-chip" severity={record.status} />
                      </div>
                    )
                  )
                )}
              </div>
            </article>
          </section>
        </>
      ) : (
        <>
          {/* =============================================
              MARKETPLACE REPORT ONLY
          ============================================== */}

          <section className="cray-report-panel">
            <div className="cray-report-panel-heading">
              <div>
                <p className="dashboard-eyebrow">
                  Marketplace Report
                </p>

                <h3>
                  {
                    dateRangeLabel
                  }
                </h3>
              </div>

              <ShoppingBag
                size={22}
              />
            </div>

            <div className="cray-report-row">
              <div>
                <strong>
                  Marketplace-only
                  report
                </strong>

                <span>
                  Only marketplace
                  listings, orders,
                  reservations, and
                  sales activity are
                  included. Tank
                  readings are
                  excluded.
                </span>
              </div>

              <b className="cray-report-chip normal">
                {
                  marketAnalytics
                    .totalOrders
                }{" "}
                orders
              </b>
            </div>
          </section>

          {/* MARKET SUMMARY */}

          <section className="cray-report-summary-grid">
            <SummaryCard
              icon={
                ShoppingBag
              }
              label="Listings"
              value={
                marketAnalytics
                  .totalListings
              }
              helper={`${marketAnalytics.activeListings} currently available`}
            />

            <SummaryCard
              icon={
                PackageCheck
              }
              label="Orders"
              value={
                marketAnalytics
                  .totalOrders
              }
              helper={`${marketAnalytics.completedOrders} successful orders`}
            />

            <SummaryCard
              icon={
                DollarSign
              }
              label="Sales"
              value={
                formatPeso(
                  marketAnalytics
                    .totalSales
                )
              }
              helper={`Successful order value • ${dateRangeLabel}`}
              tone="success"
            />

            <SummaryCard
              icon={
                TrendingUp
              }
              label="Completion Rate"
              value={`${marketAnalytics.completionRate}%`}
              helper="Successful orders compared with total orders"
            />
          </section>

          {/* MARKET ANALYTICS */}

          <section className="cray-report-grid">

            {/* SALES */}

            <article className="cray-report-panel">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Sales
                  </p>

                  <h3>
                    Marketplace sales
                  </h3>
                </div>

                <DollarSign
                  size={22}
                />
              </div>

              <div className="cray-report-sales-card">
                <strong>
                  {formatPeso(
                    marketAnalytics
                      .totalSales
                  )}
                </strong>

                <span>
                  Successful sales
                  value
                </span>

                <p>
                  Total value from
                  completed,
                  confirmed, or paid
                  marketplace orders
                  within{" "}
                  {dateRangeLabel}.
                </p>
              </div>
            </article>

            {/* MARKETPLACE ACTIVITY */}

            <article className="cray-report-panel">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Marketplace Activity
                  </p>

                  <h3>
                    Listing and order
                    activity
                  </h3>
                </div>

                <BarChart3
                  size={22}
                />
              </div>

              <div className="cray-report-bars">
                {marketBars.map(
                  (
                    item
                  ) => (
                    <BarRow
                      key={
                        item.label
                      }
                      label={
                        item.label
                      }
                      value={
                        item.value
                      }
                      max={
                        maxMarketBar
                      }
                      tone={
                        item.tone
                      }
                    />
                  )
                )}
              </div>
            </article>

            {/* ORDER STATUS */}

            <article className="cray-report-panel cray-report-wide">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Order Status
                  </p>

                  <h3>
                    Order percentage
                  </h3>
                </div>

                <PieChart
                  size={22}
                />
              </div>

              <div className="cray-report-donut-grid">
                <DonutStat
                  label="Successful"
                  value={
                    marketAnalytics
                      .completedOrders
                  }
                  total={
                    marketAnalytics
                      .totalOrders
                  }
                  tone="success"
                />

                <DonutStat
                  label="Pending"
                  value={
                    marketAnalytics
                      .pendingOrders
                  }
                  total={
                    marketAnalytics
                      .totalOrders
                  }
                  tone="warning"
                />

                <DonutStat
                  label="Cancelled"
                  value={
                    marketAnalytics
                      .cancelledOrders
                  }
                  total={
                    marketAnalytics
                      .totalOrders
                  }
                  tone="danger"
                />
              </div>
            </article>

            {/* RECENT MARKETPLACE ACTIVITY */}

            <article className="cray-report-panel cray-report-wide">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Recent Activity
                  </p>

                  <h3>
                    Latest marketplace
                    records
                  </h3>
                </div>

                <ShoppingBag
                  size={22}
                />
              </div>

              <div className="cray-report-list">
                {recentMarketRecords
                  .length ===
                0 ? (
                  <div className="cray-report-empty-small">
                    <ShoppingBag
                      size={28}
                    />

                    <strong>
                      No marketplace
                      records
                    </strong>

                    <span>
                      No listings or
                      orders were found
                      for the selected
                      date range.
                    </span>
                  </div>
                ) : (
                  recentMarketRecords.map(
                    (
                      record,
                      index
                    ) => (
                      <div
                        className="cray-report-row"
                        key={`market-${index}`}
                      >
                        <div>
                          <strong>
                            {
                              record.title
                            }
                          </strong>

                          <span>
                            {formatDate(
                              record.date
                            )}
                          </span>
                        </div>

                        <b
                          className={`cray-report-chip ${record.status}`}
                        >
                          {getFriendlyMarketStatus(
                            record.status
                          )}
                        </b>
                      </div>
                    )
                  )
                )}
              </div>
            </article>
          </section>
        </>
      )}
    </div>
  );
}

/* =========================================================
   DATE / FILTER UI
========================================================= */

const reportExportBarStyle =
{
  overflow:
    "visible",

  position:
    "relative",

  zIndex:
    12,
};

const reportDateFieldStyle =
{
  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "5px",

  minWidth:
    "165px",
};

const reportDateLabelStyle =
{
  display:
    "flex",

  alignItems:
    "center",

  gap:
    "5px",

  color:
    "var(--ct-muted, var(--text, #64748b))",

  fontSize:
    "0.72rem",

  fontWeight:
    700,
};

const reportDateInputStyle =
{
  width:
    "100%",

  minWidth:
    "165px",

  height:
    "46px",

  padding:
    "0 12px",

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

  colorScheme:
    "light dark",

  font:
    "inherit",

  fontSize:
    "0.8rem",

  fontWeight:
    600,

  outline:
    "none",
};

const reportRangeNoticeStyle =
{
  display:
    "flex",

  alignItems:
    "flex-start",

  gap:
    "10px",

  marginBottom:
    "16px",

  padding:
    "12px 14px",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  borderRadius:
    "12px",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",
};

/* =========================================================
   DROPDOWN UI
========================================================= */

const reportDropdownWrapStyle =
{
  position:
    "relative",

  minWidth:
    0,
};

const reportDropdownTriggerStyle =
{
  width:
    "100%",

  minWidth:
    "180px",

  height:
    "46px",

  display:
    "flex",

  alignItems:
    "center",

  gap:
    "8px",

  padding:
    "0 12px",

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

const reportDropdownTriggerOpenStyle =
{
  borderColor:
    "var(--ct-brand, #00b8a9)",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  boxShadow:
    "0 0 0 3px rgba(0, 217, 199, 0.08)",
};

const reportDropdownIconStyle =
{
  flexShrink:
    0,

  color:
    "var(--ct-brand, #00b8a9)",
};

const reportDropdownSelectedTextStyle =
{
  minWidth:
    0,

  overflow:
    "hidden",

  textOverflow:
    "ellipsis",

  whiteSpace:
    "nowrap",
};

const reportDropdownChevronStyle =
{
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

const reportDropdownMenuStyle =
{
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

  maxHeight:
    "260px",

  overflowY:
    "auto",

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

  backdropFilter:
    "blur(18px)",
};

const reportDropdownItemStyle =
{
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

const reportDropdownItemActiveStyle =
{
  background:
    "var(--ct-brand-soft, var(--accent-bg, rgba(0, 217, 199, 0.10)))",

  color:
    "var(--ct-brand, var(--accent, #008f83))",

  fontWeight:
    700,
};

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Activity,
  AlertTriangle,
  BarChart3,
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
  Thermometer,
  TrendingUp,
  Waves,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import {
  normalizeSensorReading,
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

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
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

function formatShortTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    "tank"
  );
}

/* =========================================================
   SENSOR STATUS
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

function getOverallReadingStatus(
  normalizedReading
) {
  return getStatusSeverity([
    normalizedReading.temperatureStatus,
    normalizedReading.phStatus,
    normalizedReading.turbidityStatus,
    normalizedReading.waterStatus,
  ]);
}

function getFriendlyReadingStatus(
  status
) {
  switch (status) {
    case "critical":
      return "Urgent";

    case "warning":
      return "Needs Checking";

    default:
      return "Good";
  }
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
    total / values.length
  ).toFixed(2);
}

/* =========================================================
   MARKET STATUS
========================================================= */

function getMarketStatus(row) {
  const raw =
    normalizeStatusText(
      row?.status ||
        row?.listing_status ||
        row?.order_status ||
        row?.payment_status ||
        row?.reservation_status ||
        row?.availability ||
        ""
    );

  if (
    raw.includes("complete")
  ) {
    return "completed";
  }

  if (
    raw.includes("confirm")
  ) {
    return "confirmed";
  }

  if (
    raw.includes("paid")
  ) {
    return "paid";
  }

  if (
    raw.includes("sold")
  ) {
    return "sold";
  }

  if (
    raw.includes("cancel")
  ) {
    return "cancelled";
  }

  if (
    raw.includes("reject")
  ) {
    return "rejected";
  }

  if (
    raw.includes("pending")
  ) {
    return "pending";
  }

  if (
    raw.includes("active") ||
    raw.includes("available")
  ) {
    return "active";
  }

  return raw || "pending";
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

function getAlertSeverity(alert) {
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
    raw.includes("low") ||
    raw.includes("high")
  ) {
    return "warning";
  }

  return "normal";
}

function getFriendlyAlertSeverity(
  severity
) {
  switch (severity) {
    case "critical":
      return "Urgent";

    case "warning":
      return "Needs Checking";

    default:
      return "Good";
  }
}

/* =========================================================
   RECORD HELPERS
========================================================= */

function getOrderTotal(order) {
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

function getRecordDate(row) {
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
    record?.listing_title ||
    record?.item_name ||
    record?.name ||
    `Marketplace Record ${index + 1}`
  );
}

/* =========================================================
   TANK HELPERS
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

function getRecordTankKeys(record) {
  return [
    record?.tank_id,
    record?.tankId,
    record?.tank_uuid,
    record?.tank_profile_id,
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
      tank?.iot_device_id ||
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
    record?.tank_display_name;

  if (directName) {
    return directName;
  }

  const recordKeys =
    getRecordTankKeys(
      record
    );

  const matchedTank =
    tanks.find((tank) => {
      const tankKeys =
        getTankKeys(
          tank
        );

      return recordKeys.some(
        (key) =>
          tankKeys.includes(
            key
          )
      );
    });

  if (!matchedTank) {
    return `Tank ${index + 1}`;
  }

  return getTankName(
    matchedTank,
    index
  );
}

function recordMatchesTank(
  record,
  tank
) {
  if (
    !record ||
    !tank
  ) {
    return false;
  }

  const recordKeys =
    getRecordTankKeys(
      record
    );

  const tankKeys =
    getTankKeys(
      tank
    );

  const idMatches =
    recordKeys.some(
      (key) =>
        tankKeys.includes(
          key
        )
    );

  if (idMatches) {
    return true;
  }

  const recordName =
    lower(
      record?.tank_name ||
        record?.tank_label ||
        record?.tank_display_name
    );

  const tankName =
    lower(
      getTankName(
        tank
      )
    );

  return (
    Boolean(recordName) &&
    Boolean(tankName) &&
    recordName === tankName
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
        row?.reading_id ||
        row?.alert_id ||
        row?.listing_id ||
        row?.order_id ||
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
   COMPONENTS
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

function BarRow({
  label,
  value,
  max,
  tone = "default",
}) {
  const width =
    max > 0
      ? `${Math.min(
          (value / max) * 100,
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
          (value / total) *
            100
        )
      : 0;

  return (
    <div
      className={`cray-report-donut ${tone}`}
    >
      <div
        style={{
          "--percent": `${percent}%`,
        }}
      >
        <strong>
          {percent}%
        </strong>
      </div>

      <span>
        {label}
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
   MINIMAL THEME-AWARE DROPDOWN
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
  ] = useState(false);

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

  function handleSelect(option) {
    onChange(
      option.value
    );

    setIsOpen(false);
  }

  return (
    <div
      ref={dropdownRef}
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
            (current) =>
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
            selectedOption?.label
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

export default function ReportsPage() {
  const [
    activeReport,
    setActiveReport,
  ] = useState("tanks");

  const [
    exportScope,
    setExportScope,
  ] = useState("tanks");

  const [
    selectedTankId,
    setSelectedTankId,
  ] = useState("all");

  const [
    datasets,
    setDatasets,
  ] = useState({
    tanks: [],
    readings: [],
    alerts: [],
    listings: [],
    orders: [],
  });

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  /* =======================================================
     LOAD REPORT DATA
  ======================================================= */

  const loadReports =
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
          setDatasets({
            tanks: [],
            readings: [],
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
              500
            ),

            fetchRowsByScope(
              tableGroups.alerts,
              currentUser,
              500
            ),

            fetchRowsByScope(
              tableGroups.listings,
              currentUser,
              500
            ),

            fetchRowsByScope(
              tableGroups.orders,
              currentUser,
              500
            ),
          ]);

        setDatasets({
          tanks:
            tanks.rows,

          readings:
            readings.rows,

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
      } catch (error) {
        console.error(
          "Reports loading error:",
          error
        );
      } finally {
        setIsLoading(false);
      }
    };

  useEffect(() => {
    loadReports();
  }, []);

  /* =======================================================
     TANK OPTIONS
  ======================================================= */

  const tankOptions =
    useMemo(() => {
      return datasets.tanks
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
        .sort((a, b) =>
          a.name.localeCompare(
            b.name
          )
        );
    }, [datasets.tanks]);

  const selectedTankOption =
    useMemo(() => {
      if (
        selectedTankId ===
        "all"
      ) {
        return null;
      }

      return (
        tankOptions.find(
          (option) =>
            option.id ===
            selectedTankId
        ) || null
      );
    }, [
      tankOptions,
      selectedTankId,
    ]);

  const selectedTank =
    selectedTankOption?.tank ||
    null;

  const selectedTankName =
    selectedTankId === "all"
      ? "All Tanks"
      : selectedTankOption?.name ||
        "Selected Tank";

  useEffect(() => {
    if (
      selectedTankId !==
        "all" &&
      !tankOptions.some(
        (option) =>
          option.id ===
          selectedTankId
      )
    ) {
      setSelectedTankId(
        "all"
      );
    }
  }, [
    tankOptions,
    selectedTankId,
  ]);

  /* =======================================================
     READINGS
  ======================================================= */

  const enrichedReadings =
    useMemo(() => {
      return datasets.readings
        .map(
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

            const name =
              getTankDisplayName(
                reading,
                datasets.tanks,
                index
              );

            return {
              reading,
              normalized,
              status,
              name,

              date:
                normalized.createdAt ||
                reading?.timestamp ||
                reading?.date ||
                reading?.updated_at,
            };
          }
        )
        .sort(
          (a, b) =>
            new Date(
              b.date || 0
            ) -
            new Date(
              a.date || 0
            )
        );
    }, [
      datasets.readings,
      datasets.tanks,
    ]);

  /* =======================================================
     SELECTED TANK DATA
  ======================================================= */

  const tankReadings =
    useMemo(() => {
      if (
        selectedTankId ===
        "all" ||
        !selectedTank
      ) {
        return enrichedReadings;
      }

      return enrichedReadings.filter(
        (item) =>
          recordMatchesTank(
            item.reading,
            selectedTank
          )
      );
    }, [
      enrichedReadings,
      selectedTankId,
      selectedTank,
    ]);

  const tankAlerts =
    useMemo(() => {
      if (
        selectedTankId ===
        "all" ||
        !selectedTank
      ) {
        return datasets.alerts;
      }

      return datasets.alerts.filter(
        (alert) =>
          recordMatchesTank(
            alert,
            selectedTank
          )
      );
    }, [
      datasets.alerts,
      selectedTankId,
      selectedTank,
    ]);

  const latestReading =
    tankReadings[0] ||
    null;

  /* =======================================================
     TANK ANALYTICS
  ======================================================= */

  const tankAnalytics =
    useMemo(() => {
      const normal =
        tankReadings.filter(
          (item) =>
            item.status ===
            "normal"
        ).length;

      const warning =
        tankReadings.filter(
          (item) =>
            item.status ===
            "warning"
        ).length;

      const critical =
        tankReadings.filter(
          (item) =>
            item.status ===
            "critical"
        ).length;

      const phWarning =
        tankReadings.filter(
          (item) =>
            [
              "warning",
              "critical",
            ].includes(
              getStatusSeverity([
                item.normalized
                  .phStatus,
              ])
            )
        ).length;

      const waterClarityWarning =
        tankReadings.filter(
          (item) =>
            [
              "warning",
              "critical",
            ].includes(
              getStatusSeverity([
                item.normalized
                  .turbidityStatus,
              ])
            )
        ).length;

      const alertCritical =
        tankAlerts.filter(
          (alert) =>
            getAlertSeverity(
              alert
            ) === "critical"
        ).length;

      return {
        totalTanks:
          selectedTankId ===
          "all"
            ? datasets.tanks
                .length
            : selectedTank
              ? 1
              : 0,

        totalReadings:
          tankReadings.length,

        totalAlerts:
          tankAlerts.length,

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

        latestPhStatus:
          latestReading
            ?.normalized
            ?.phStatus ||
          "No Reading",

        latestWaterClarityStatus:
          latestReading
            ?.normalized
            ?.turbidityStatus ||
          "No Reading",

        latestTemperatureStatus:
          latestReading
            ?.normalized
            ?.temperatureStatus ||
          "No Reading",

        latestWaterStatus:
          latestReading
            ?.normalized
            ?.waterStatus ||
          "No Reading",
      };
    }, [
      datasets.tanks,
      selectedTankId,
      selectedTank,
      tankReadings,
      tankAlerts,
      latestReading,
    ]);

  /* =======================================================
     MARKETPLACE ANALYTICS
  ======================================================= */

  const marketAnalytics =
    useMemo(() => {
      const activeListings =
        datasets.listings.filter(
          (listing) =>
            getMarketStatus(
              listing
            ) === "active"
        ).length;

      const soldListings =
        datasets.listings.filter(
          (listing) =>
            getMarketStatus(
              listing
            ) === "sold"
        ).length;

      const completedOrders =
        datasets.orders.filter(
          (order) =>
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
        datasets.orders.filter(
          (order) =>
            getMarketStatus(
              order
            ) === "pending"
        ).length;

      const cancelledOrders =
        datasets.orders.filter(
          (order) =>
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
          (sum, order) =>
            sum +
            Number(
              getOrderTotal(
                order
              ) || 0
            ),
          0
        );

      const completionRate =
        datasets.orders.length >
        0
          ? Math.round(
              (completedOrders.length /
                datasets.orders
                  .length) *
                100
            )
          : 0;

      return {
        totalListings:
          datasets.listings.length,

        activeListings,

        soldListings,

        totalOrders:
          datasets.orders.length,

        completedOrders:
          completedOrders.length,

        pendingOrders,

        cancelledOrders,

        totalSales,

        completionRate,
      };
    }, [
      datasets.listings,
      datasets.orders,
    ]);

  /* =======================================================
     GRAPH DATA
  ======================================================= */

  const tankBars = [
    {
      label:
        "Good readings",
      value:
        tankAnalytics.normal,
      tone:
        "success",
    },

    {
      label:
        "Needs checking",
      value:
        tankAnalytics.warning,
      tone:
        "warning",
    },

    {
      label:
        "Urgent readings",
      value:
        tankAnalytics.critical,
      tone:
        "danger",
    },

    {
      label:
        "pH issues",
      value:
        tankAnalytics.phWarning,
      tone:
        "warning",
    },

    {
      label:
        "Water clarity issues",
      value:
        tankAnalytics.waterClarityWarning,
      tone:
        "warning",
    },

    {
      label:
        "Urgent alerts",
      value:
        tankAnalytics.alertCritical,
      tone:
        "danger",
    },
  ];

  const marketBars = [
    {
      label:
        "Available listings",
      value:
        marketAnalytics.activeListings,
      tone:
        "success",
    },

    {
      label:
        "Sold listings",
      value:
        marketAnalytics.soldListings,
      tone:
        "default",
    },

    {
      label:
        "Completed orders",
      value:
        marketAnalytics.completedOrders,
      tone:
        "success",
    },

    {
      label:
        "Pending orders",
      value:
        marketAnalytics.pendingOrders,
      tone:
        "warning",
    },

    {
      label:
        "Cancelled orders",
      value:
        marketAnalytics.cancelledOrders,
      tone:
        "danger",
    },
  ];

  const maxTankBar =
    Math.max(
      1,
      ...tankBars.map(
        (item) =>
          item.value
      )
    );

  const maxMarketBar =
    Math.max(
      1,
      ...marketBars.map(
        (item) =>
          item.value
      )
    );

  /* =======================================================
     RECENT TANK RECORDS
  ======================================================= */

  const recentTankRecords =
    useMemo(() => {
      const alerts =
        tankAlerts.map(
          (
            alert,
            index
          ) => ({
            type:
              "Alert",

            title:
              alert?.title ||
              alert?.alert_title ||
              alert
                ?.notification_title ||
              alert?.type ||
              `Alert ${index + 1}`,

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
          (item) => ({
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
              item.normalized
                .phStatus,

            waterClarity:
              item.normalized
                .turbidityStatus,
          })
        );

      return [
        ...alerts,
        ...readings,
      ]
        .sort(
          (a, b) =>
            new Date(
              b.date || 0
            ) -
            new Date(
              a.date || 0
            )
        )
        .slice(0, 6);
    }, [
      tankAlerts,
      tankReadings,
      datasets.tanks,
    ]);

  /* =======================================================
     RECENT MARKETPLACE RECORDS
  ======================================================= */

  const recentMarketRecords =
    useMemo(() => {
      return [
        ...datasets.orders,
        ...datasets.listings,
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
          (a, b) =>
            new Date(
              b.date || 0
            ) -
            new Date(
              a.date || 0
            )
        )
        .slice(0, 6);
    }, [
      datasets.orders,
      datasets.listings,
    ]);

  /* =======================================================
     EXPORT — TANK REPORT
  ======================================================= */

  const tankExportRows =
    useMemo(() => {
      const readingRows =
        tankReadings.map(
          (
            item,
            index
          ) => ({
            Type:
              "Water Reading",

            Tank:
              item.name ||
              `Tank ${index + 1}`,

            Temperature:
              item.normalized
                .temperatureLabel,

            "Temperature Condition":
              formatFriendlyText(
                item.normalized
                  .temperatureStatus
              ),

            "pH Condition":
              formatFriendlyText(
                item.normalized
                  .phStatus
              ),

            "Water Clarity":
              formatFriendlyText(
                item.normalized
                  .turbidityStatus
              ),

            "Water Level":
              item.normalized
                .waterLabel,

            "Water Level Condition":
              formatFriendlyText(
                item.normalized
                  .waterStatus
              ),

            "Overall Condition":
              getFriendlyReadingStatus(
                item.status
              ),

            Date:
              formatDate(
                item.date
              ),
          })
        );

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
              alert?.title ||
              alert?.alert_title ||
              alert
                ?.notification_title ||
              alert?.type ||
              `Alert ${index + 1}`,

            Priority:
              getFriendlyAlertSeverity(
                getAlertSeverity(
                  alert
                )
              ),

            Status:
              formatFriendlyText(
                alert?.status ||
                  alert
                    ?.alert_status ||
                  "Open"
              ),

            Message:
              alert?.message ||
              alert?.description ||
              alert?.body ||
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
    }, [
      tankReadings,
      tankAlerts,
      datasets.tanks,
    ]);

  /* =======================================================
     EXPORT — MARKETPLACE REPORT
  ======================================================= */

  const marketExportRows =
    useMemo(() => {
      const listingRows =
        datasets.listings.map(
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
        datasets.orders.map(
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
    }, [
      datasets.listings,
      datasets.orders,
    ]);

  /* =======================================================
     EXPORT SECTIONS
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
          ? "Water readings, water conditions, and alert history for all tanks."
          : `Water readings, water conditions, and alert history for ${selectedTankName}.`,

      rows:
        tankExportRows,
    };
  }

  function getSelectedReportSections() {
    if (
      exportScope ===
      "tanks"
    ) {
      return [
        getTankReportSection(),
      ];
    }

    if (
      exportScope ===
      "market"
    ) {
      return [
        {
          title:
            "Marketplace Reports",

          description:
            "Marketplace listings, orders, reservations, and sales activity.",

          rows:
            marketExportRows,
        },
      ];
    }

    return [
      getTankReportSection(),

      {
        title:
          "Marketplace Reports",

        description:
          "Marketplace listings, orders, reservations, and sales activity.",

        rows:
          marketExportRows,
      },
    ];
  }

  function handleExportReportsCsv() {
    const sections =
      getSelectedReportSections();

    const rows =
      sections.flatMap(
        (section) =>
          section.rows.map(
            (row) => ({
              Section:
                section.title,

              ...row,
            })
          )
      );

    let filename;

    if (
      exportScope ===
      "tanks"
    ) {
      filename =
        selectedTankId ===
        "all"
          ? "craythrive-all-tanks-report.csv"
          : `craythrive-${safeFilePart(
              selectedTankName
            )}-report.csv`;
    } else if (
      exportScope ===
      "market"
    ) {
      filename =
        "craythrive-marketplace-reports.csv";
    } else {
      filename =
        "craythrive-combined-reports.csv";
    }

    downloadCsv(
      filename,
      rows
    );
  }

  function handlePrintReports() {
    const sections =
      getSelectedReportSections();

    let title =
      "CrayThrive Reports";

    let subtitle =
      "Tank and Marketplace Reports";

    if (
      exportScope ===
      "tanks"
    ) {
      title =
        "CrayThrive Tank Report";

      subtitle =
        selectedTankId ===
        "all"
          ? "All Tanks"
          : selectedTankName;
    }

    if (
      exportScope ===
      "market"
    ) {
      title =
        "CrayThrive Marketplace Report";

      subtitle =
        "Marketplace Report";
    }

    if (
      exportScope ===
      "both"
    ) {
      subtitle =
        selectedTankId ===
        "all"
          ? "All Tanks and Marketplace"
          : `${selectedTankName} and Marketplace`;
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

  if (isLoading) {
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
    <div className="cray-reports-page">
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
            and marketplace are doing.
          </h2>

          <p>
            Review tank conditions,
            alert activity, marketplace
            performance, and sales in
            one simple report center.
          </p>

          <div className="cray-report-actions">
            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                loadReports
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
              : "Market"}
          </strong>

          <span>
            Current report
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
          onClick={() => {
            setActiveReport(
              "tanks"
            );

            setExportScope(
              "tanks"
            );
          }}
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
          onClick={() => {
            setActiveReport(
              "market"
            );

            setExportScope(
              "market"
            );
          }}
        >
          <ShoppingBag
            size={18}
          />

          Marketplace Report
        </button>
      </section>

      {/* ===============================================
          EXPORT / TANK SELECTOR
      ================================================ */}

      <section
        className="cray-report-exportbar"
        style={
          reportExportBarStyle
        }
      >
        {activeReport ===
          "tanks" && (
          <ReportFilterDropdown
            ariaLabel="Choose which tank to include in the report"
            icon={Droplets}
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
                (option) => ({
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

        <ReportFilterDropdown
          ariaLabel="Choose report export scope"
          icon={FileText}
          value={
            exportScope
          }
          options={[
            {
              value:
                "tanks",

              label:
                "Tank Report Only",
            },

            {
              value:
                "market",

              label:
                "Marketplace Report Only",
            },

            {
              value:
                "both",

              label:
                "Tank + Marketplace",
            },
          ]}
          onChange={
            setExportScope
          }
        />

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
          TANK REPORT
      ================================================ */}

      {activeReport ===
      "tanks" ? (
        <>
          {/* SELECTED TANK LABEL */}

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
                    ? "The information below includes all registered tanks."
                    : `Only readings and alerts linked to ${selectedTankName} are included below and in exports.`}
                </span>
              </div>

              <b className="cray-report-chip normal">
                {tankAnalytics.totalReadings}{" "}
                readings
              </b>
            </div>
          </section>

          {/* SUMMARY */}

          <section className="cray-report-summary-grid">
            <SummaryCard
              icon={Droplets}
              label={
                selectedTankId ===
                "all"
                  ? "Tanks"
                  : "Selected Tank"
              }
              value={
                selectedTankId ===
                "all"
                  ? tankAnalytics.totalTanks
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
              icon={Activity}
              label="Water Readings"
              value={
                tankAnalytics.totalReadings
              }
              helper="Saved sensor records"
            />

            <SummaryCard
              icon={
                AlertTriangle
              }
              label="Urgent Alerts"
              value={
                tankAnalytics.alertCritical
              }
              helper={`${tankAnalytics.totalAlerts} total alert records`}
              tone={
                tankAnalytics.alertCritical >
                0
                  ? "danger"
                  : "success"
              }
            />

            <SummaryCard
              icon={Waves}
              label="Water Clarity Issues"
              value={
                tankAnalytics.waterClarityWarning
              }
              helper="Readings that need checking"
              tone={
                tankAnalytics.waterClarityWarning >
                0
                  ? "warning"
                  : "success"
              }
            />
          </section>

          {/* ANALYTICS */}

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

              <div className="cray-report-metric-grid">
                <div>
                  <Thermometer
                    size={20}
                  />

                  <strong>
                    {tankAnalytics.avgTemp ===
                    "N/A"
                      ? "No Data"
                      : `${tankAnalytics.avgTemp}°C`}
                  </strong>

                  <span>
                    Average Temperature
                  </span>

                  <small>
                    {formatFriendlyText(
                      tankAnalytics.latestTemperatureStatus
                    )}
                  </small>
                </div>

                <div>
                  <Droplets
                    size={20}
                  />

                  <strong>
                    {formatFriendlyText(
                      tankAnalytics.latestPhStatus
                    )}
                  </strong>

                  <span>
                    Latest pH Condition
                  </span>
                </div>

                <div>
                  <Waves
                    size={20}
                  />

                  <strong>
                    {formatFriendlyText(
                      tankAnalytics.latestWaterClarityStatus
                    )}
                  </strong>

                  <span>
                    Water Clarity
                  </span>
                </div>

                <div>
                  <Gauge
                    size={20}
                  />

                  <strong>
                    {tankAnalytics.avgWaterLevel ===
                    "N/A"
                      ? "No Data"
                      : `${tankAnalytics.avgWaterLevel} cm`}
                  </strong>

                  <span>
                    Average Water Level
                  </span>

                  <small>
                    {formatFriendlyText(
                      tankAnalytics.latestWaterStatus
                    )}
                  </small>
                </div>
              </div>
            </article>

            {/* CONDITION GRAPH */}

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
                  (item) => (
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
                    Water reading percentage
                  </h3>
                </div>

                <PieChart
                  size={22}
                />
              </div>

              <div className="cray-report-donut-grid">
                <DonutStat
                  label="Good"
                  value={
                    tankAnalytics.normal
                  }
                  total={
                    tankAnalytics.totalReadings
                  }
                  tone="success"
                />

                <DonutStat
                  label="Needs Checking"
                  value={
                    tankAnalytics.warning
                  }
                  total={
                    tankAnalytics.totalReadings
                  }
                  tone="warning"
                />

                <DonutStat
                  label="Urgent"
                  value={
                    tankAnalytics.critical
                  }
                  total={
                    tankAnalytics.totalReadings
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
                {recentTankRecords.length ===
                0 ? (
                  <div className="cray-report-empty-small">
                    <CheckCircle2
                      size={28}
                    />

                    <strong>
                      No tank records yet
                    </strong>

                    <span>
                      No readings or alerts
                      were found for this
                      tank selection.
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

                        <b
                          className={`cray-report-chip ${record.status}`}
                        >
                          {record.type ===
                          "Alert"
                            ? getFriendlyAlertSeverity(
                                record.status
                              )
                            : getFriendlyReadingStatus(
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
      ) : (
        <>
          {/* =============================================
              MARKETPLACE SUMMARY
          ============================================== */}

          <section className="cray-report-summary-grid">
            <SummaryCard
              icon={
                ShoppingBag
              }
              label="Listings"
              value={
                marketAnalytics.totalListings
              }
              helper={`${marketAnalytics.activeListings} currently available`}
            />

            <SummaryCard
              icon={
                PackageCheck
              }
              label="Orders"
              value={
                marketAnalytics.totalOrders
              }
              helper={`${marketAnalytics.completedOrders} successful orders`}
            />

            <SummaryCard
              icon={
                DollarSign
              }
              label="Sales"
              value={formatPeso(
                marketAnalytics.totalSales
              )}
              helper="Successful order value"
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
                    marketAnalytics.totalSales
                  )}
                </strong>

                <span>
                  Successful sales value
                </span>

                <p>
                  Total value from
                  completed, confirmed,
                  or paid marketplace
                  orders.
                </p>
              </div>
            </article>

            <article className="cray-report-panel">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Marketplace Activity
                  </p>

                  <h3>
                    Listing and order activity
                  </h3>
                </div>

                <BarChart3
                  size={22}
                />
              </div>

              <div className="cray-report-bars">
                {marketBars.map(
                  (item) => (
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
                    marketAnalytics.completedOrders
                  }
                  total={
                    marketAnalytics.totalOrders
                  }
                  tone="success"
                />

                <DonutStat
                  label="Pending"
                  value={
                    marketAnalytics.pendingOrders
                  }
                  total={
                    marketAnalytics.totalOrders
                  }
                  tone="warning"
                />

                <DonutStat
                  label="Cancelled"
                  value={
                    marketAnalytics.cancelledOrders
                  }
                  total={
                    marketAnalytics.totalOrders
                  }
                  tone="danger"
                />
              </div>
            </article>

            <article className="cray-report-panel cray-report-wide">
              <div className="cray-report-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">
                    Recent Activity
                  </p>

                  <h3>
                    Latest marketplace records
                  </h3>
                </div>

                <ShoppingBag
                  size={22}
                />
              </div>

              <div className="cray-report-list">
                {recentMarketRecords.length ===
                0 ? (
                  <div className="cray-report-empty-small">
                    <ShoppingBag
                      size={28}
                    />

                    <strong>
                      No marketplace records yet
                    </strong>

                    <span>
                      Listings and orders
                      will appear here once
                      marketplace activity
                      begins.
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
   MINIMAL THEME-AWARE REPORT FILTER UI
========================================================= */

const reportExportBarStyle = {
  overflow:
    "visible",

  position:
    "relative",

  zIndex:
    12,
};

const reportDropdownWrapStyle = {
  position:
    "relative",

  minWidth:
    0,
};

const reportDropdownTriggerStyle = {
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

const reportDropdownTriggerOpenStyle = {
  borderColor:
    "var(--ct-brand, #00b8a9)",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  boxShadow:
    "0 0 0 3px rgba(0, 217, 199, 0.08)",
};

const reportDropdownIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-brand, #00b8a9)",
};

const reportDropdownSelectedTextStyle = {
  minWidth:
    0,

  overflow:
    "hidden",

  textOverflow:
    "ellipsis",

  whiteSpace:
    "nowrap",
};

const reportDropdownChevronStyle = {
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

const reportDropdownMenuStyle = {
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

const reportDropdownItemStyle = {
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

const reportDropdownItemActiveStyle = {
  background:
    "var(--ct-brand-soft, var(--accent-bg, rgba(0, 217, 199, 0.10)))",

  color:
    "var(--ct-brand, var(--accent, #008f83))",

  fontWeight:
    700,
};
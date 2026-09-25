import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Database,
  Droplets,
  FlaskConical,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Thermometer,
  Waves,
} from "lucide-react";

import { isSupabaseConfigured, supabase } from "../../lib/supabase";

import {
  formatReadingTime,
  normalizeSensorReading,
  toNumberOrNull,
} from "../../utils/sensorReadingUtils";

import {
  loadActiveThresholds,
} from "../../utils/thresholdEvaluation";

/* =========================================================
   TABLE FALLBACKS
========================================================= */

const tableGroups = {
  tanks: ["tanks", "user_tanks", "tank_profiles"],

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

  ammonia: ["ammonia_readings"],
};

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
  "seller_id",
  "buyer_id",
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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
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
    hour: "numeric",
    minute: "2-digit",
  });
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

function normalizeStatusText(value) {
  return lower(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}

/* =========================================================
   USER-FRIENDLY TANK NAME
========================================================= */

function getTankDisplayName(tankId, tanks = []) {
  if (!tankId) {
    return "My Tank";
  }

  const matchedTank = tanks.find((tank) => {
    const candidateIds = [
      tank?.id,
      tank?.tank_id,
      tank?.uuid,
    ]
      .filter(Boolean)
      .map(String);

    return candidateIds.includes(String(tankId));
  });

  return (
    matchedTank?.tank_name ||
    matchedTank?.name ||
    matchedTank?.title ||
    matchedTank?.tank_label ||
    matchedTank?.display_name ||
    "My Tank"
  );
}

/* =========================================================
   AMMONIA HELPERS
========================================================= */

function getAmmoniaNumericValue(row) {
  const raw =
    row?.ammonia_mg_l ??
    row?.ammonia_level ??
    row?.ammonia_ppm ??
    row?.ammonia_value ??
    row?.value ??
    row?.ppm;

  const numberValue = Number(raw);

  return Number.isFinite(numberValue)
    ? numberValue
    : null;
}

function getAmmoniaTankId(row) {
  return String(
    row?.tank_id ||
      row?.tank_uuid ||
      ""
  );
}

function getAmmoniaRowDate(row) {
  return (
    row?.created_at ||
    row?.timestamp ||
    row?.date ||
    row?.updated_at ||
    ""
  );
}

function getTankIdCandidates(tank) {
  return [
    tank?.id,
    tank?.tank_id,
    tank?.uuid,
  ]
    .filter(Boolean)
    .map(String);
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

function getOverallReadingStatus(normalizedReading) {
  return getStatusSeverity([
    normalizedReading.temperatureStatus,
    normalizedReading.phStatus,
    normalizedReading.turbidityStatus,
    normalizedReading.waterStatus,
  ]);
}

/* =========================================================
   ALERT HELPERS
========================================================= */

function getAlertSeverity(alert) {
  const raw = normalizeStatusText(
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
    raw.includes("high")
  ) {
    return "critical";
  }

  if (
    raw.includes("warning") ||
    raw.includes("medium")
  ) {
    return "warning";
  }

  if (
    raw.includes("resolved") ||
    raw.includes("read")
  ) {
    return "normal";
  }

  return "warning";
}

function getAlertOpenStatus(alert) {
  const raw = normalizeStatusText(
    alert?.status ||
      alert?.alert_status ||
      alert?.read_status ||
      ""
  );

  if (
    alert?.is_read === true ||
    alert?.resolved_at ||
    raw.includes("resolved") ||
    raw.includes("read") ||
    raw.includes("done")
  ) {
    return "resolved";
  }

  return "open";
}

/* =========================================================
   MARKETPLACE HELPERS
========================================================= */

function getListingStatus(listing) {
  const raw = normalizeStatusText(
    listing?.status ||
      listing?.listing_status ||
      listing?.availability ||
      listing?.state ||
      ""
  );

  if (raw.includes("deleted")) return "deleted";
  if (raw.includes("hidden")) return "hidden";
  if (raw.includes("sold")) return "sold";
  if (raw.includes("reserved")) return "reserved";
  if (raw.includes("pending")) return "pending";

  if (
    raw.includes("active") ||
    raw.includes("available")
  ) {
    return "active";
  }

  return raw || "active";
}

function getOrderStatus(order) {
  const raw = normalizeStatusText(
    order?.status ||
      order?.order_status ||
      order?.payment_status ||
      order?.reservation_status ||
      ""
  );

  if (raw.includes("complete")) return "completed";
  if (raw.includes("confirm")) return "confirmed";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("paid")) return "paid";

  return raw || "pending";
}

function getOrderTotal(order) {
  return (
    order?.total_price ||
    order?.total ||
    order?.amount ||
    order?.price_total ||
    order?.subtotal ||
    order?.price ||
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

function getListingTitle(listing, index) {
  return (
    listing?.title ||
    listing?.name ||
    listing?.product_name ||
    listing?.listing_title ||
    listing?.crayfish_type ||
    `Crayfish Listing ${index + 1}`
  );
}

function getOrderTitle(order, index) {
  return (
    order?.product_name ||
    order?.listing_title ||
    order?.item_name ||
    order?.title ||
    `Reservation ${index + 1}`
  );
}

function getAlertTitle(alert, index) {
  return (
    alert?.title ||
    alert?.alert_title ||
    alert?.notification_title ||
    alert?.type ||
    alert?.alert_type ||
    `Alert ${index + 1}`
  );
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id =
      row?.id ||
      row?.uuid ||
      row?.tank_id ||
      row?.reading_id ||
      row?.alert_id ||
      row?.listing_id ||
      row?.order_id ||
      row?.user_id ||
      row?.created_at ||
      `row-${index}`;

    map.set(id, row);
  });

  return Array.from(map.values());
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();

  const user = data?.session?.user;

  if (!user) {
    return {
      id: "",
      email: "",
    };
  }

  return {
    id: user.id || "",
    email: user.email || "",
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

    for (const column of userFilterColumns) {
      const ordered = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .order("created_at", {
          ascending: false,
        })
        .limit(limit);

      if (
        !ordered.error &&
        Array.isArray(ordered.data)
      ) {
        successful = true;
        mergedRows.push(...ordered.data);
        continue;
      }

      const plain = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .limit(limit);

      if (
        !plain.error &&
        Array.isArray(plain.data)
      ) {
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

function averageFromReadings(
  enrichedReadings,
  key
) {
  const values = enrichedReadings
    .map((item) =>
      toNumberOrNull(item.normalized[key])
    )
    .filter((value) => value !== null);

  if (!values.length) {
    return "N/A";
  }

  const total = values.reduce(
    (sum, value) => sum + value,
    0
  );

  return (total / values.length).toFixed(2);
}

/* =========================================================
   SMALL COMPONENT
========================================================= */

function MiniBar({
  label,
  value,
  max,
  tone = "default",
}) {
  const width =
    max > 0
      ? `${Math.min((value / max) * 100, 100)}%`
      : "0%";

  return (
    <div className={`modern-mini-bar ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{formatNumber(value)}</strong>
      </div>

      <i>
        <b style={{ width }} />
      </i>
    </div>
  );
}

/* =========================================================
   DASHBOARD
========================================================= */

export default function DashboardOverview() {
  const [datasets, setDatasets] = useState({
    tanks: [],
    readings: [],
    alerts: [],
    listings: [],
    orders: [],
    ammonia: [],
  });

  const [thresholds, setThresholds] =
    useState(null);

  useEffect(() => {
    let isMounted = true;

    loadActiveThresholds().then((loaded) => {
      if (isMounted) {
        setThresholds(loaded);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const [isLoading, setIsLoading] =
    useState(true);

  const [lastUpdated, setLastUpdated] =
    useState(null);

  /* =======================================================
     LOAD DASHBOARD
  ======================================================= */

  const loadDashboard = async () => {
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
        await getCurrentUser();

      if (!currentUser.id) {
        setDatasets({
          tanks: [],
          readings: [],
          alerts: [],
          listings: [],
          orders: [],
          ammonia: [],
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
      ] = await Promise.all([
        fetchUserRows(
          tableGroups.tanks,
          currentUser.id,
          300
        ),

        fetchUserRows(
          tableGroups.readings,
          currentUser.id,
          300
        ),

        fetchUserRows(
          tableGroups.alerts,
          currentUser.id,
          300
        ),

        fetchUserRows(
          tableGroups.listings,
          currentUser.id,
          300
        ),

        fetchUserRows(
          tableGroups.orders,
          currentUser.id,
          300
        ),

        fetchUserRows(
          tableGroups.ammonia,
          currentUser.id,
          300
        ),
      ]);

      setDatasets({
        tanks: tanks.rows,
        readings: readings.rows,
        alerts: alerts.rows,
        listings: listings.rows,
        orders: orders.rows,
        ammonia: ammonia.rows,
      });

      setLastUpdated(new Date());
    } catch (error) {
      console.error(
        "Dashboard loading error:",
        error
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  /* =======================================================
     SENSOR READINGS
  ======================================================= */

  const enrichedReadings = useMemo(() => {
    return datasets.readings.map(
      (reading, index) => {
        const normalized =
          normalizeSensorReading(reading);

        const status =
          getOverallReadingStatus(normalized);

        /*
         * IMPORTANT:
         * Use readable tank name instead of UUID.
         */
        const tankName =
          reading?.tank_name ||
          reading?.tank_label ||
          reading?.tank_display_name ||
          getTankDisplayName(
            reading?.tank_id ||
              reading?.tank_uuid,
            datasets.tanks
          ) ||
          `Tank ${index + 1}`;

        const date =
          normalized.createdAt ||
          reading?.timestamp ||
          reading?.date ||
          reading?.updated_at;

        return {
          reading,
          normalized,
          status,
          tankName: String(tankName),
          date,
        };
      }
    );
  }, [
    datasets.readings,
    datasets.tanks,
  ]);

  const latestReading =
    enrichedReadings[0] || null;

  const latestReadingTankId = String(
    latestReading?.reading?.tank_id ||
      latestReading?.reading?.tank_uuid ||
      ""
  );

  const latestAmmoniaForReading = useMemo(() => {
    if (!latestReadingTankId) {
      return null;
    }

    const matchedRows = datasets.ammonia.filter(
      (row) =>
        getAmmoniaTankId(row) === latestReadingTankId
    );

    if (matchedRows.length === 0) {
      return null;
    }

    const latestRow = [...matchedRows].sort(
      (a, b) =>
        new Date(getAmmoniaRowDate(b)) -
        new Date(getAmmoniaRowDate(a))
    )[0];

    return getAmmoniaNumericValue(latestRow);
  }, [
    datasets.ammonia,
    latestReadingTankId,
  ]);

  /* =======================================================
     AMMONIA STATUS
  ======================================================= */

  const ammoniaStats = useMemo(() => {
    const ammoniaMax = thresholds?.ammoniaMax;

    let elevated = 0;
    let noScan = 0;

    datasets.tanks.forEach((tank) => {
      const tankIds = getTankIdCandidates(tank);

      const matchedRows = datasets.ammonia.filter(
        (row) =>
          tankIds.includes(getAmmoniaTankId(row))
      );

      if (matchedRows.length === 0) {
        noScan += 1;
        return;
      }

      const latestRow = [...matchedRows].sort(
        (a, b) =>
          new Date(getAmmoniaRowDate(b)) -
          new Date(getAmmoniaRowDate(a))
      )[0];

      const value = getAmmoniaNumericValue(latestRow);

      if (
        value !== null &&
        ammoniaMax !== undefined &&
        value > ammoniaMax
      ) {
        elevated += 1;
      }
    });

    return { elevated, noScan };
  }, [
    datasets.tanks,
    datasets.ammonia,
    thresholds,
  ]);

  /* =======================================================
     STATS
  ======================================================= */

  const stats = useMemo(() => {
    const activeAlerts =
      datasets.alerts.filter(
        (alert) =>
          getAlertOpenStatus(alert) === "open"
      ).length;

    const criticalAlerts =
      datasets.alerts.filter(
        (alert) =>
          getAlertSeverity(alert) ===
          "critical"
      ).length;

    const activeListings =
      datasets.listings.filter(
        (listing) =>
          getListingStatus(listing) ===
          "active"
      ).length;

    const pendingOrders =
      datasets.orders.filter(
        (order) =>
          getOrderStatus(order) ===
          "pending"
      ).length;

    const completedOrders =
      datasets.orders.filter((order) =>
        [
          "completed",
          "confirmed",
          "paid",
        ].includes(getOrderStatus(order))
      );

    const totalSales =
      completedOrders.reduce(
        (sum, order) =>
          sum +
          Number(
            getOrderTotal(order) || 0
          ),
        0
      );

    const sensorIssues =
      enrichedReadings.filter((item) =>
        ["warning", "critical"].includes(
          item.status
        )
      ).length;

    return {
      totalTanks: datasets.tanks.length,

      activeAlerts,

      criticalAlerts,

      totalListings:
        datasets.listings.length,

      activeListings,

      pendingOrders,

      totalOrders:
        datasets.orders.length,

      completedOrders:
        completedOrders.length,

      totalSales,

      sensorIssues,

      ammoniaElevated: ammoniaStats.elevated,

      ammoniaNoScan: ammoniaStats.noScan,
    };
  }, [datasets, enrichedReadings, ammoniaStats]);

  /* =======================================================
     AVERAGES
  ======================================================= */

  const avgTemp =
    averageFromReadings(
      enrichedReadings,
      "temperatureValue"
    );

  const avgWaterDepth =
    averageFromReadings(
      enrichedReadings,
      "waterValue"
    );

  /* =======================================================
     ACTIVITY BARS
  ======================================================= */

  const activityBars = [
    {
      label: "Tanks",
      value: stats.totalTanks,
      tone: "default",
    },

    {
      label: "Water Issues",
      value: stats.sensorIssues,
      tone:
        stats.sensorIssues > 0
          ? "warning"
          : "success",
    },

    {
      label: "Active Alerts",
      value: stats.activeAlerts,
      tone:
        stats.activeAlerts > 0
          ? "danger"
          : "success",
    },

    {
      label: "Listings",
      value: stats.totalListings,
      tone: "default",
    },

    {
      label: "Reservations",
      value: stats.pendingOrders,
      tone:
        stats.pendingOrders > 0
          ? "warning"
          : "default",
    },
  ];

  const maxActivity = Math.max(
    1,
    ...activityBars.map(
      (item) => item.value
    )
  );

  /* =======================================================
     RECENT SENSOR ISSUES
  ======================================================= */

  const recentSensorIssues =
    useMemo(() => {
      return enrichedReadings
        .filter((item) =>
          [
            "warning",
            "critical",
          ].includes(item.status)
        )
        .sort(
          (a, b) =>
            new Date(b.date || 0) -
            new Date(a.date || 0)
        )
        .slice(0, 5);
    }, [enrichedReadings]);

  /* =======================================================
     MARKETPLACE ACTIVITY
  ======================================================= */

  const recentMarketplaceActivity =
    useMemo(() => {
      const listings =
        datasets.listings.map(
          (listing, index) => ({
            type: "Listing",

            title: getListingTitle(
              listing,
              index
            ),

            status:
              getListingStatus(listing),

            date:
              getRecordDate(listing),
          })
        );

      const orders =
        datasets.orders.map(
          (order, index) => ({
            type: "Reservation",

            title: getOrderTitle(
              order,
              index
            ),

            status:
              getOrderStatus(order),

            date:
              getRecordDate(order),
          })
        );

      return [
        ...listings,
        ...orders,
      ]
        .sort(
          (a, b) =>
            new Date(b.date || 0) -
            new Date(a.date || 0)
        )
        .slice(0, 6);
    }, [
      datasets.listings,
      datasets.orders,
    ]);

  /* =======================================================
     SYSTEM HISTORY
  ======================================================= */

  const recentSystemActivity =
    useMemo(() => {
      const alerts =
        datasets.alerts.map(
          (alert, index) => ({
            type: "Alert",

            title: getAlertTitle(
              alert,
              index
            ),

            status:
              getAlertSeverity(alert),

            date:
              getRecordDate(alert),
          })
        );

      const readings =
        enrichedReadings.map((item) => ({
          type: "Water Reading",

          title: item.tankName,

          status: item.status,

          date: item.date,
        }));

      return [
        ...alerts,
        ...readings,
      ]
        .sort(
          (a, b) =>
            new Date(b.date || 0) -
            new Date(a.date || 0)
        )
        .slice(0, 6);
    }, [
      datasets.alerts,
      enrichedReadings,
    ]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="modern-overview-loading">
        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading your dashboard...
        </h3>

        <p>
          Getting the latest information
          from your CrayThrive system.
        </p>
      </section>
    );
  }

  /* =======================================================
     SIMPLE HEALTH STATUS
  ======================================================= */

  const hasCriticalProblem =
    stats.criticalAlerts > 0 ||
    recentSensorIssues.some(
      (item) =>
        item.status === "critical"
    );

  const hasWarning =
    stats.sensorIssues > 0 ||
    stats.activeAlerts > 0;

  const simpleHealthTitle =
    hasCriticalProblem
      ? "Action needed"
      : hasWarning
        ? "Needs attention"
        : "Everything looks good";

  const simpleHealthText =
    hasCriticalProblem
      ? "One or more tank conditions need to be checked as soon as possible."
      : hasWarning
        ? "Some tank conditions need your attention. CrayThrive is continuing to monitor them."
        : "No active problems were detected in your monitored tanks.";

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="farmer-overview-page">

      {/* ===============================================
          SYSTEM STATUS
      ================================================ */}

      <section
        className={`farmer-status-banner ${
          hasCriticalProblem
            ? "critical"
            : hasWarning
              ? "warning"
              : "success"
        }`}
      >
        <div className="farmer-status-content">

          <div className="farmer-status-icon">
            {hasCriticalProblem ||
            hasWarning ? (
              <AlertTriangle size={27} />
            ) : (
              <CheckCircle2 size={27} />
            )}
          </div>

          <div>
            <span className="farmer-status-label">
              Your CrayThrive System
            </span>

            <h2>
              {simpleHealthTitle}
            </h2>

            <p>
              {simpleHealthText}
            </p>
          </div>
        </div>

        <div className="farmer-status-actions">

          {(stats.activeAlerts > 0 ||
            stats.sensorIssues > 0) && (
            <Link
              to="/admin/readings"
              className="farmer-primary-action"
            >
              Check Issues

              <ArrowRight size={17} />
            </Link>
          )}

          <button
            type="button"
            className="farmer-refresh-button"
            onClick={loadDashboard}
          >
            <RefreshCw size={17} />

            Refresh
          </button>
        </div>
      </section>

      {/* ===============================================
          QUICK SUMMARY
      ================================================ */}

      <section className="farmer-section">

        <div className="farmer-section-heading">

          <div>
            <span>
              Overview
            </span>

            <h3>
              What you need to know
            </h3>
          </div>

          <small>
            {lastUpdated
              ? `Updated ${formatShortTime(
                  lastUpdated
                )}`
              : "Waiting for latest data"}
          </small>
        </div>

        <div className="farmer-summary-grid">

          <Link
            to="/admin/tanks"
            className="farmer-summary-card"
          >
            <div className="farmer-summary-icon">
              <Droplets size={22} />
            </div>

            <div>
              <strong>
                {formatNumber(
                  stats.totalTanks
                )}
              </strong>

              <span>
                Tanks
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>

          <Link
            to="/admin/alerts"
            className={`farmer-summary-card ${
              stats.activeAlerts > 0
                ? "warning"
                : ""
            }`}
          >
            <div className="farmer-summary-icon">
              <Bell size={22} />
            </div>

            <div>
              <strong>
                {formatNumber(
                  stats.activeAlerts
                )}
              </strong>

              <span>
                Alerts
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>

          <Link
            to="/admin/orders"
            className="farmer-summary-card"
          >
            <div className="farmer-summary-icon">
              <PackageCheck size={22} />
            </div>

            <div>
              <strong>
                {formatNumber(
                  stats.pendingOrders
                )}
              </strong>

              <span>
                Reservations
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>

          <Link
            to="/admin/marketplace"
            className="farmer-summary-card"
          >
            <div className="farmer-summary-icon">
              <ShoppingBag size={22} />
            </div>

            <div>
              <strong>
                {formatNumber(
                  stats.activeListings
                )}
              </strong>

              <span>
                Active Listings
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>

          <Link
            to="/admin/tanks"
            className={`farmer-summary-card ${
              stats.ammoniaElevated > 0
                ? "warning"
                : ""
            }`}
          >
            <div className="farmer-summary-icon">
              <FlaskConical size={22} />
            </div>

            <div>
              <strong>
                {stats.ammoniaElevated > 0
                  ? formatNumber(
                      stats.ammoniaElevated
                    )
                  : formatNumber(
                      stats.ammoniaNoScan
                    )}
              </strong>

              <span>
                {stats.ammoniaElevated > 0
                  ? "Ammonia Elevated"
                  : "Tanks Awaiting Scan"}
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      {/* ===============================================
          MAIN INFORMATION
      ================================================ */}

      <section className="farmer-main-grid">

        {/* WATER STATUS */}

        <article className="farmer-card farmer-water-card">

          <div className="farmer-card-heading">

            <div>
              <span>
                Latest Water Check
              </span>

              <h3>
                Tank condition
              </h3>
            </div>

            <Link to="/admin/readings">
              View readings

              <ArrowRight size={16} />
            </Link>
          </div>

          {latestReading ? (
            <>
              <div className="farmer-reading-header">

                <div>
                  <strong>
                    {latestReading.tankName}
                  </strong>

                  <span>
                    {formatReadingTime(
                      latestReading.date
                    )}
                  </span>
                </div>

                <b
                  className={`modern-status-chip ${latestReading.status}`}
                >
                  {latestReading.status ===
                  "normal"
                    ? "Good"
                    : latestReading.status ===
                        "warning"
                      ? "Check"
                      : "Attention"}
                </b>
              </div>

              <div className="farmer-water-grid">

                <div className="farmer-water-item">

                  <span className="farmer-water-icon">
                    <Thermometer
                      size={21}
                    />
                  </span>

                  <div>
                    <small>
                      Temperature
                    </small>

                    <strong>
                      {
                        latestReading
                          .normalized
                          .temperatureLabel
                      }
                    </strong>

                    <span>
                      {
                        latestReading
                          .normalized
                          .temperatureStatus
                      }
                    </span>
                  </div>
                </div>

                <div className="farmer-water-item">

                  <span className="farmer-water-icon">
                    <Droplets
                      size={21}
                    />
                  </span>

                  <div>
                    <small>
                      pH Level
                    </small>

                    <strong>
                      {
                        latestReading
                          .normalized
                          .phStatus
                      }
                    </strong>

                    <span>
                      Water acidity
                    </span>
                  </div>
                </div>

                <div className="farmer-water-item">

                  <span className="farmer-water-icon">
                    <Waves
                      size={21}
                    />
                  </span>

                  <div>
                    <small>
                      Water Clarity
                    </small>

                    <strong>
                      {
                        latestReading
                          .normalized
                          .turbidityStatus
                      }
                    </strong>

                    <span>
                      Water cleanliness
                    </span>
                  </div>
                </div>

                <div className="farmer-water-item">

                  <span className="farmer-water-icon">
                    <Database
                      size={21}
                    />
                  </span>

                  <div>
                    <small>
                      Water Level
                    </small>

                    <strong>
                      {
                        latestReading
                          .normalized
                          .waterLabel
                      }
                    </strong>

                    <span>
                      {
                        latestReading
                          .normalized
                          .waterStatus
                      }
                    </span>
                  </div>
                </div>

                <div className="farmer-water-item">

                  <span className="farmer-water-icon">
                    <FlaskConical
                      size={21}
                    />
                  </span>

                  <div>
                    <small>
                      Ammonia
                    </small>

                    <strong>
                      {latestAmmoniaForReading ===
                        null
                        ? "No Scan"
                        : `${latestAmmoniaForReading} mg/L`}
                    </strong>

                    <span>
                      {latestAmmoniaForReading ===
                        null
                        ? "Waiting for mobile scan"
                        : "Latest test-strip result"}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="farmer-empty-state">

              <Droplets size={30} />

              <strong>
                No water reading yet
              </strong>

              <span>
                The latest tank condition
                will appear here after your
                device sends sensor data.
              </span>
            </div>
          )}
        </article>

        {/* NEEDS ATTENTION */}

        <article className="farmer-card">

          <div className="farmer-card-heading">

            <div>
              <span>
                Needs Attention
              </span>

              <h3>
                Things to check
              </h3>
            </div>

            <AlertTriangle
              size={21}
            />
          </div>

          {recentSensorIssues.length ===
            0 &&
          stats.activeAlerts === 0 ? (
            <div className="farmer-good-state">

              <CheckCircle2
                size={31}
              />

              <strong>
                Nothing needs attention
              </strong>

              <span>
                Your latest monitored water
                conditions are currently
                stable.
              </span>
            </div>
          ) : (
            <div className="farmer-issue-list">

              {recentSensorIssues
                .slice(0, 4)
                .map(
                  (
                    item,
                    index
                  ) => (
                    <div
                      className="farmer-issue-row"
                      key={
                        item.reading?.id ||
                        index
                      }
                    >
                      <span
                        className={`farmer-issue-dot ${item.status}`}
                      />

                      <div>
                        <strong>
                          {item.tankName}
                        </strong>

                        <span>
                          {item.status ===
                          "critical"
                            ? "This tank needs immediate checking."
                            : "A water condition should be reviewed."}
                        </span>
                      </div>

                      <b
                        className={`modern-status-chip ${item.status}`}
                      >
                        {item.status ===
                        "critical"
                          ? "Urgent"
                          : "Check"}
                      </b>
                    </div>
                  )
                )}

              <Link
                to="/admin/readings"
                className="farmer-view-all"
              >
                View all readings

                <ArrowRight
                  size={16}
                />
              </Link>
            </div>
          )}
        </article>
      </section>

      {/* ===============================================
          QUICK ACCESS
      ================================================ */}

      <section className="farmer-section">

        <div className="farmer-section-heading">

          <div>
            <span>
              Quick Access
            </span>

            <h3>
              Where do you want to go?
            </h3>
          </div>
        </div>

        <div className="farmer-quick-grid">

          <Link to="/admin/tanks">

            <Droplets size={21} />

            <div>
              <strong>
                My Tanks
              </strong>

              <span>
                Check your registered tanks
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>

          <Link to="/admin/readings">

            <Activity size={21} />

            <div>
              <strong>
                Water Readings
              </strong>

              <span>
                See detailed water results
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>

          <Link to="/admin/marketplace">

            <ShoppingBag size={21} />

            <div>
              <strong>
                Marketplace
              </strong>

              <span>
                Manage crayfish listings
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>

          <Link to="/admin/orders">

            <PackageCheck size={21} />

            <div>
              <strong>
                Reservations
              </strong>

              <span>
                Check customer requests
              </span>
            </div>

            <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      {/* ===============================================
          OPTIONAL DETAILS
      ================================================ */}

      <section className="farmer-more-section">

        {/* WATER INFORMATION */}

        <details className="farmer-details">

          <summary>

            <div>
              <Database size={19} />

              <span>
                <strong>
                  More water information
                </strong>

                <small>
                  Averages and activity totals
                </small>
              </span>
            </div>

            <span className="farmer-details-arrow">
              <ArrowRight
                size={18}
              />
            </span>
          </summary>

          <div className="farmer-details-content">

            <div className="farmer-detail-metrics">

              <div>
                <span>
                  Average Temperature
                </span>

                <strong>
                  {avgTemp === "N/A"
                    ? "No data"
                    : `${avgTemp}°C`}
                </strong>
              </div>

              <div>
                <span>
                  Average Water Level
                </span>

                <strong>
                  {avgWaterDepth ===
                  "N/A"
                    ? "No data"
                    : `${avgWaterDepth} cm`}
                </strong>
              </div>

              <div>
                <span>
                  Water Issues
                </span>

                <strong>
                  {formatNumber(
                    stats.sensorIssues
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Critical Alerts
                </span>

                <strong>
                  {formatNumber(
                    stats.criticalAlerts
                  )}
                </strong>
              </div>
            </div>

            <div className="modern-mini-bars">

              {activityBars.map(
                (item) => (
                  <MiniBar
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    max={maxActivity}
                    tone={item.tone}
                  />
                )
              )}
            </div>
          </div>
        </details>

        {/* MARKETPLACE */}

        <details className="farmer-details">

          <summary>

            <div>
              <ShoppingBag
                size={19}
              />

              <span>
                <strong>
                  Marketplace activity
                </strong>

                <small>
                  Recent listings and reservations
                </small>
              </span>
            </div>

            <span className="farmer-details-arrow">
              <ArrowRight
                size={18}
              />
            </span>
          </summary>

          <div className="farmer-details-content">

            {recentMarketplaceActivity.length ===
            0 ? (
              <div className="farmer-empty-state compact">

                <ShoppingBag
                  size={25}
                />

                <strong>
                  No marketplace activity yet
                </strong>
              </div>
            ) : (
              <div className="modern-record-list">

                {recentMarketplaceActivity.map(
                  (
                    item,
                    index
                  ) => (
                    <div
                      className="modern-record-row"
                      key={`${item.type}-${index}`}
                    >
                      <div>
                        <strong>
                          {item.title}
                        </strong>

                        <span>
                          {item.type} •{" "}
                          {formatDate(
                            item.date
                          )}
                        </span>
                      </div>

                      <b
                        className={`modern-status-chip ${item.status}`}
                      >
                        {item.status}
                      </b>
                    </div>
                  )
                )}
              </div>
            )}

            <div className="farmer-sales-summary">

              <span>
                Completed sales
              </span>

              <strong>
                {formatPeso(
                  stats.totalSales
                )}
              </strong>
            </div>
          </div>
        </details>

        {/* HISTORY */}

        <details className="farmer-details">

          <summary>

            <div>
              <Activity size={19} />

              <span>
                <strong>
                  Recent history
                </strong>

                <small>
                  Latest water readings and alerts
                </small>
              </span>
            </div>

            <span className="farmer-details-arrow">
              <ArrowRight
                size={18}
              />
            </span>
          </summary>

          <div className="farmer-details-content">

            {recentSystemActivity.length ===
            0 ? (
              <div className="farmer-empty-state compact">

                <Database
                  size={25}
                />

                <strong>
                  No recent activity
                </strong>
              </div>
            ) : (
              <div className="modern-record-list">

                {recentSystemActivity.map(
                  (
                    item,
                    index
                  ) => (
                    <div
                      className="modern-record-row"
                      key={`${item.type}-${index}`}
                    >
                      <div>
                        <strong>
                          {item.title}
                        </strong>

                        <span>
                          {item.type} •{" "}
                          {formatDate(
                            item.date
                          )}
                        </span>
                      </div>

                      <b
                        className={`modern-status-chip ${item.status}`}
                      >
                        {item.status}
                      </b>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </details>
      </section>
    </div>
  );
}
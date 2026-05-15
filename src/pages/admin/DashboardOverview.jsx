import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Database,
  Droplets,
  Gauge,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Thermometer,
  Waves,
} from "lucide-react";
import { Link } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const tableGroups = {
  tanks: ["tanks", "user_tanks", "tank_profiles"],
  readings: ["sensor_readings", "tank_readings", "readings"],
  ammonia: ["ammonia_readings", "ammonia_results"],
  alerts: ["alerts", "notifications", "tank_alerts"],
  listings: ["marketplace_listings", "listings", "products"],
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
];

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function getStatus(row) {
  const raw = lower(
    row?.status ||
      row?.condition ||
      row?.severity ||
      row?.listing_status ||
      row?.order_status ||
      row?.alert_status
  );

  if (raw.includes("critical") || raw.includes("danger") || raw.includes("high")) {
    return "critical";
  }

  if (raw.includes("warn") || raw.includes("dirty") || raw.includes("medium")) {
    return "warning";
  }

  if (raw.includes("sold")) return "sold";
  if (raw.includes("complete")) return "completed";
  if (raw.includes("confirm")) return "confirmed";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("resolved")) return "resolved";
  if (raw.includes("active")) return "active";
  if (raw.includes("normal") || raw.includes("safe") || raw.includes("good")) {
    return "normal";
  }

  return raw || "normal";
}

function getDateValue(row) {
  return row?.created_at || row?.updated_at || row?.date || row?.timestamp || "";
}

function formatDate(value) {
  if (!value) return "No date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatPrice(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return "₱0";

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined) return row[key];
  }

  return null;
}

function averageNumber(rows, keys) {
  const values = rows
    .map((row) => Number(getValue(row, keys)))
    .filter((value) => Number.isFinite(value));

  if (!values.length) return "N/A";

  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(2);
}

function getOrderTotal(order) {
  return (
    order?.total_price ||
    order?.total ||
    order?.amount ||
    order?.price_total ||
    order?.subtotal ||
    0
  );
}

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
      `row-${index}`;

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

async function fetchRows(tableNames, userId, limit = 120) {
  for (const tableName of tableNames) {
    const mergedRows = [];
    let successful = false;

    for (const userColumn of userFilterColumns) {
      const ordered = await supabase
        .from(tableName)
        .select("*")
        .eq(userColumn, userId)
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
        .eq(userColumn, userId)
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

function getRecordTitle(row, fallback) {
  return (
    row?.title ||
    row?.name ||
    row?.tank_name ||
    row?.product_name ||
    row?.listing_title ||
    row?.alert_title ||
    row?.type ||
    row?.notification_type ||
    fallback
  );
}

function MiniBar({ label, value, max }) {
  const width = max > 0 ? `${Math.min((value / max) * 100, 100)}%` : "0%";

  return (
    <div className="modern-mini-bar">
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

function StatCard({ icon: Icon, label, value, helper, tone = "default" }) {
  return (
    <article className={`modern-overview-stat ${tone}`}>
      <span className="modern-overview-stat-icon">
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

export default function DashboardOverview() {
  const [datasets, setDatasets] = useState({
    tanks: [],
    readings: [],
    ammonia: [],
    alerts: [],
    listings: [],
    orders: [],
  });

  const [sources, setSources] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadDashboard = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      if (!currentUser.id) {
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

      const [tanks, readings, ammonia, alerts, listings, orders] =
        await Promise.all([
          fetchRows(tableGroups.tanks, currentUser.id),
          fetchRows(tableGroups.readings, currentUser.id),
          fetchRows(tableGroups.ammonia, currentUser.id),
          fetchRows(tableGroups.alerts, currentUser.id),
          fetchRows(tableGroups.listings, currentUser.id),
          fetchRows(tableGroups.orders, currentUser.id),
        ]);

      setDatasets({
        tanks: tanks.rows,
        readings: readings.rows,
        ammonia: ammonia.rows,
        alerts: alerts.rows,
        listings: listings.rows,
        orders: orders.rows,
      });

      setSources({
        tanks: tanks.tableUsed,
        readings: readings.tableUsed,
        ammonia: ammonia.tableUsed,
        alerts: alerts.tableUsed,
        listings: listings.tableUsed,
        orders: orders.tableUsed,
      });

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Dashboard loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const stats = useMemo(() => {
    const criticalAlerts = datasets.alerts.filter(
      (alert) => getStatus(alert) === "critical"
    ).length;

    const activeListings = datasets.listings.filter(
      (listing) => getStatus(listing) === "active"
    ).length;

    const completedOrders = datasets.orders.filter((order) => {
      const status = getStatus(order);
      return status === "completed" || status === "confirmed";
    }).length;

    const totalSales = datasets.orders.reduce(
      (sum, order) => sum + Number(getOrderTotal(order) || 0),
      0
    );

    return {
      criticalAlerts,
      activeListings,
      completedOrders,
      totalSales,
    };
  }, [datasets]);

  const avgTemp = averageNumber(datasets.readings, [
    "temperature",
    "temp",
    "water_temperature",
  ]);

  const avgPh = averageNumber(datasets.readings, ["ph", "pH", "ph_level"]);

  const avgTurbidity = averageNumber(datasets.readings, [
    "turbidity",
    "turbidity_level",
    "ntu",
  ]);

  const avgWaterLevel = averageNumber(datasets.readings, [
    "water_level",
    "level",
    "water_height",
  ]);

  const activityBars = [
    {
      label: "Readings",
      value: datasets.readings.length,
    },
    {
      label: "Alerts",
      value: datasets.alerts.length,
    },
    {
      label: "Listings",
      value: datasets.listings.length,
    },
    {
      label: "Orders",
      value: datasets.orders.length,
    },
  ];

  const maxActivity = Math.max(1, ...activityBars.map((item) => item.value));

  const latestRecords = [
    ...datasets.alerts,
    ...datasets.readings,
    ...datasets.ammonia,
    ...datasets.orders,
  ]
    .sort((a, b) => new Date(getDateValue(b)) - new Date(getDateValue(a)))
    .slice(0, 6);

  if (isLoading) {
    return (
      <section className="modern-overview-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading dashboard...</h3>
        <p>CrayThrive is syncing your web dashboard records.</p>
      </section>
    );
  }

  return (
    <div className="modern-overview-page">
      <section className="modern-overview-hero">
        <div>
          <p className="dashboard-eyebrow">Live Account Overview</p>
          <h2>A smarter look at your crayfish system.</h2>
          <p>
            Monitor tanks, readings, ammonia checks, alerts, marketplace activity,
            and order performance from the same account used in your mobile app.
          </p>

          <div className="modern-overview-actions">
            <button className="dashboard-primary-button" onClick={loadDashboard}>
              <RefreshCw size={18} />
              Refresh Data
            </button>

            <Link to="/admin/tanks" className="modern-secondary-link">
              View Tanks
              <ArrowRight size={18} />
            </Link>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : "Waiting for sync"}
            </span>
          </div>
        </div>

        <div className="modern-overview-health">
          <div className="modern-health-ring">
            <Waves size={38} />
          </div>

          <strong>
            {stats.criticalAlerts > 0 ? "Needs Review" : "System Stable"}
          </strong>

          <span>
            {stats.criticalAlerts > 0
              ? `${stats.criticalAlerts} critical alert(s) need attention`
              : "No critical alerts detected"}
          </span>
        </div>
      </section>

      <section className="modern-overview-stat-grid">
        <StatCard
          icon={Droplets}
          label="Tanks"
          value={formatNumber(datasets.tanks.length)}
          helper={`Source: ${sources.tanks || "tanks"}`}
        />

        <StatCard
          icon={Activity}
          label="Sensor readings"
          value={formatNumber(datasets.readings.length)}
          helper={`Avg temperature: ${avgTemp}`}
        />

        <StatCard
          icon={AlertTriangle}
          label="Critical alerts"
          value={formatNumber(stats.criticalAlerts)}
          helper={`${datasets.alerts.length} total alert records`}
          tone={stats.criticalAlerts > 0 ? "danger" : "success"}
        />

        <StatCard
          icon={ShoppingBag}
          label="Active listings"
          value={formatNumber(stats.activeListings)}
          helper={`${datasets.listings.length} marketplace listings`}
        />

        <StatCard
          icon={PackageCheck}
          label="Orders"
          value={formatNumber(datasets.orders.length)}
          helper={`${stats.completedOrders} completed/confirmed`}
        />

        <StatCard
          icon={Gauge}
          label="Sales value"
          value={formatPrice(stats.totalSales)}
          helper="Computed from order records"
        />
      </section>

      <section className="modern-overview-grid">
        <article className="modern-overview-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Water Metrics</p>
              <h3>Average sensor condition</h3>
            </div>
            <Thermometer size={22} />
          </div>

          <div className="modern-metric-grid">
            <div>
              <Thermometer size={20} />
              <strong>{avgTemp === "N/A" ? "N/A" : `${avgTemp}°C`}</strong>
              <span>Temperature</span>
            </div>

            <div>
              <Droplets size={20} />
              <strong>{avgPh}</strong>
              <span>pH Level</span>
            </div>

            <div>
              <Waves size={20} />
              <strong>{avgTurbidity}</strong>
              <span>Turbidity</span>
            </div>

            <div>
              <Gauge size={20} />
              <strong>{avgWaterLevel}</strong>
              <span>Water Level</span>
            </div>
          </div>
        </article>

        <article className="modern-overview-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Activity</p>
              <h3>Record distribution</h3>
            </div>
            <Database size={22} />
          </div>

          <div className="modern-mini-bars">
            {activityBars.map((item) => (
              <MiniBar
                key={item.label}
                label={item.label}
                value={item.value}
                max={maxActivity}
              />
            ))}
          </div>
        </article>

        <article className="modern-overview-panel modern-wide-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Latest Records</p>
              <h3>Recent system activity</h3>
            </div>
            <Camera size={22} />
          </div>

          <div className="modern-record-list">
            {latestRecords.length === 0 ? (
              <div className="modern-empty-state">
                <CheckCircle2 size={26} />
                <strong>No recent records yet</strong>
                <span>
                  Your latest readings, alerts, ammonia checks, and orders will
                  appear here once synced.
                </span>
              </div>
            ) : (
              latestRecords.map((row, index) => (
                <div className="modern-record-row" key={row?.id || index}>
                  <div>
                    <strong>{getRecordTitle(row, "CrayThrive Record")}</strong>
                    <span>{formatDate(getDateValue(row))}</span>
                  </div>

                  <b className={`modern-status-chip ${getStatus(row)}`}>
                    {getStatus(row)}
                  </b>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
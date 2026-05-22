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

const tableGroups = {
  tanks: ["tanks", "user_tanks", "tank_profiles"],
  readings: ["sensor_readings", "tank_readings", "readings"],
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
  "recipient_id",
];

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

  if (!Number.isFinite(amount)) return "₱0";

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
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

  if (raw.includes("warning") || raw.includes("medium")) {
    return "warning";
  }

  if (raw.includes("resolved") || raw.includes("read")) {
    return "normal";
  }

  return "warning";
}

function getAlertOpenStatus(alert) {
  const raw = normalizeStatusText(
    alert?.status || alert?.alert_status || alert?.read_status || ""
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
  if (raw.includes("active") || raw.includes("available")) return "active";

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
  return row?.created_at || row?.updated_at || row?.timestamp || row?.date || "";
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
    `Order ${index + 1}`
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

function averageFromReadings(enrichedReadings, key) {
  const values = enrichedReadings
    .map((item) => toNumberOrNull(item.normalized[key]))
    .filter((value) => value !== null);

  if (!values.length) return "N/A";

  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(2);
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

function MiniBar({ label, value, max, tone = "default" }) {
  const width = max > 0 ? `${Math.min((value / max) * 100, 100)}%` : "0%";

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

export default function DashboardOverview() {
  const [datasets, setDatasets] = useState({
    tanks: [],
    readings: [],
    alerts: [],
    listings: [],
    orders: [],
  });

  const [sources, setSources] = useState({});
  const [scopeLabel, setScopeLabel] = useState("Your Dashboard");
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
          alerts: [],
          listings: [],
          orders: [],
        });
        setScopeLabel("No session");
        return;
      }

      // Fetch ONLY data that belongs to the logged-in user
      const [tanks, readings, alerts, listings, orders] = await Promise.all([
        fetchUserRows(tableGroups.tanks, currentUser.id, 300),
        fetchUserRows(tableGroups.readings, currentUser.id, 300),
        fetchUserRows(tableGroups.alerts, currentUser.id, 300),
        fetchUserRows(tableGroups.listings, currentUser.id, 300),
        fetchUserRows(tableGroups.orders, currentUser.id, 300),
      ]);

      setDatasets({
        tanks: tanks.rows,
        readings: readings.rows,
        alerts: alerts.rows,
        listings: listings.rows,
        orders: orders.rows,
      });

      setSources({
        tanks: tanks.tableUsed,
        readings: readings.tableUsed,
        alerts: alerts.tableUsed,
        listings: listings.tableUsed,
        orders: orders.tableUsed,
      });

      setScopeLabel("Your account view");
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

  const enrichedReadings = useMemo(() => {
    return datasets.readings.map((reading, index) => {
      const normalized = normalizeSensorReading(reading);
      const status = getOverallReadingStatus(normalized);

      const tankName =
        reading?.tank_name ||
        reading?.tank_label ||
        reading?.name ||
        reading?.tank_id ||
        reading?.iot_device_id ||
        normalized.deviceUid ||
        `Reading ${index + 1}`;

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
    });
  }, [datasets.readings]);

  const latestReading = enrichedReadings[0] || null;

  const stats = useMemo(() => {
    const activeAlerts = datasets.alerts.filter(
      (alert) => getAlertOpenStatus(alert) === "open"
    ).length;

    const criticalAlerts = datasets.alerts.filter(
      (alert) => getAlertSeverity(alert) === "critical"
    ).length;

    const activeListings = datasets.listings.filter(
      (listing) => getListingStatus(listing) === "active"
    ).length;

    const pendingOrders = datasets.orders.filter(
      (order) => getOrderStatus(order) === "pending"
    ).length;

    const completedOrders = datasets.orders.filter((order) =>
      ["completed", "confirmed", "paid"].includes(getOrderStatus(order))
    );

    const totalSales = completedOrders.reduce(
      (sum, order) => sum + Number(getOrderTotal(order) || 0),
      0
    );

    const sensorIssues = enrichedReadings.filter((item) =>
      ["warning", "critical"].includes(item.status)
    ).length;

    return {
      totalTanks: datasets.tanks.length,
      activeAlerts,
      criticalAlerts,
      totalListings: datasets.listings.length,
      activeListings,
      pendingOrders,
      totalOrders: datasets.orders.length,
      completedOrders: completedOrders.length,
      totalSales,
      sensorIssues,
    };
  }, [datasets, enrichedReadings]);

  const avgTemp = averageFromReadings(enrichedReadings, "temperatureValue");
  const avgWaterDepth = averageFromReadings(enrichedReadings, "waterValue");

  const activityBars = [
    {
      label: "Tanks",
      value: stats.totalTanks,
      tone: "default",
    },
    {
      label: "Sensor Issues",
      value: stats.sensorIssues,
      tone: stats.sensorIssues > 0 ? "warning" : "success",
    },
    {
      label: "Active Alerts",
      value: stats.activeAlerts,
      tone: stats.activeAlerts > 0 ? "danger" : "success",
    },
    {
      label: "Listings",
      value: stats.totalListings,
      tone: "default",
    },
    {
      label: "Pending Orders",
      value: stats.pendingOrders,
      tone: stats.pendingOrders > 0 ? "warning" : "default",
    },
  ];

  const maxActivity = Math.max(1, ...activityBars.map((item) => item.value));

  const recentSensorIssues = useMemo(() => {
    return enrichedReadings
      .filter((item) => ["warning", "critical"].includes(item.status))
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 5);
  }, [enrichedReadings]);

  const recentMarketplaceActivity = useMemo(() => {
    const listings = datasets.listings.map((listing, index) => ({
      type: "Listing",
      title: getListingTitle(listing, index),
      status: getListingStatus(listing),
      date: getRecordDate(listing),
    }));

    const orders = datasets.orders.map((order, index) => ({
      type: "Order",
      title: getOrderTitle(order, index),
      status: getOrderStatus(order),
      date: getRecordDate(order),
    }));

    return [...listings, ...orders]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 6);
  }, [datasets.listings, datasets.orders]);

  const recentSystemActivity = useMemo(() => {
    const alerts = datasets.alerts.map((alert, index) => ({
      type: "Alert",
      title: getAlertTitle(alert, index),
      status: getAlertSeverity(alert),
      date: getRecordDate(alert),
    }));

    const readings = enrichedReadings.map((item) => ({
      type: "Reading",
      title: item.tankName,
      status: item.status,
      date: item.date,
    }));

    return [...alerts, ...readings]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 6);
  }, [datasets.alerts, enrichedReadings]);

  const healthLabel =
    stats.criticalAlerts > 0 || recentSensorIssues.some((item) => item.status === "critical")
      ? "Needs Review"
      : stats.sensorIssues > 0
        ? "Monitoring"
        : "System Stable";

  if (isLoading) {
    return (
      <section className="modern-overview-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading dashboard...</h3>
        <p>CrayThrive is syncing web dashboard records.</p>
      </section>
    );
  }

  return (
    <div className="modern-overview-page">
      <section className="modern-overview-hero">
        <div>
          <p className="dashboard-eyebrow">CrayThrive Dashboard</p>
          <h2>A smarter look at your crayfish system.</h2>
          <p>
            Monitor your tanks, IoT sensor statuses, alerts, marketplace
            listings, and reservations from one clean web dashboard.
          </p>

          <div className="modern-overview-actions">
            <button className="dashboard-primary-button" onClick={loadDashboard}>
              <RefreshCw size={18} />
              Refresh Data
            </button>

            <Link to="/admin/readings" className="modern-secondary-link">
              View Readings
              <ArrowRight size={18} />
            </Link>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()} • ${scopeLabel}`
                : `Waiting for sync • ${scopeLabel}`}
            </span>
          </div>
        </div>

        <div className="modern-overview-health">
          <div className="modern-health-ring">
            <Waves size={38} />
          </div>

          <strong>{healthLabel}</strong>

          <span>
            {stats.sensorIssues > 0 || stats.activeAlerts > 0
              ? `${stats.sensorIssues} sensor issue(s), ${stats.activeAlerts} active alert(s)`
              : "No active sensor issues detected"}
          </span>
        </div>
      </section>

      <section className="modern-overview-stat-grid">
        <StatCard
          icon={Droplets}
          label="Total Tanks"
          value={formatNumber(stats.totalTanks)}
          helper={`Source: ${sources.tanks || "tanks"}`}
        />

        <StatCard
          icon={Bell}
          label="Active Alerts"
          value={formatNumber(stats.activeAlerts)}
          helper={`${stats.criticalAlerts} critical alert(s)`}
          tone={stats.activeAlerts > 0 ? "danger" : "success"}
        />

        <StatCard
          icon={ShoppingBag}
          label="Marketplace Listings"
          value={formatNumber(stats.totalListings)}
          helper={`${stats.activeListings} active listing(s)`}
        />

        <StatCard
          icon={PackageCheck}
          label="Pending Reservations"
          value={formatNumber(stats.pendingOrders)}
          helper={`${stats.totalOrders} total order record(s)`}
          tone={stats.pendingOrders > 0 ? "warning" : "default"}
        />

        <StatCard
          icon={Activity}
          label="Sales Value"
          value={formatPeso(stats.totalSales)}
          helper={`${stats.completedOrders} completed/paid order(s)`}
          tone="success"
        />
      </section>

      <section className="modern-overview-grid">
        <article className="modern-overview-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Latest Sensor Snapshot</p>
              <h3>Newest IoT reading</h3>
            </div>
            <Thermometer size={22} />
          </div>

          {latestReading ? (
            <div className="modern-metric-grid">
              <div>
                <Thermometer size={20} />
                <strong>{latestReading.normalized.temperatureLabel}</strong>
                <span>{latestReading.normalized.temperatureStatus}</span>
              </div>

              <div>
                <Droplets size={20} />
                <strong>{latestReading.normalized.phStatus}</strong>
                <span>pH Status</span>
              </div>

              <div>
                <Waves size={20} />
                <strong>{latestReading.normalized.turbidityStatus}</strong>
                <span>Turbidity Status</span>
              </div>

              <div>
                <Database size={20} />
                <strong>{latestReading.normalized.waterLabel}</strong>
                <span>{latestReading.normalized.waterStatus}</span>
              </div>
            </div>
          ) : (
            <div className="modern-empty-state">
              <Database size={26} />
              <strong>No sensor reading yet</strong>
              <span>Sensor data will appear once IoT readings are synced.</span>
            </div>
          )}
        </article>

        <article className="modern-overview-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Activity Distribution</p>
              <h3>Record overview</h3>
            </div>
            <Activity size={22} />
          </div>

          <div className="modern-mini-bars">
            {activityBars.map((item) => (
              <MiniBar
                key={item.label}
                label={item.label}
                value={item.value}
                max={maxActivity}
                tone={item.tone}
              />
            ))}
          </div>
        </article>

        <article className="modern-overview-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Averages</p>
              <h3>Tank reading summary</h3>
            </div>
            <Database size={22} />
          </div>

          <div className="modern-metric-grid">
            <div>
              <Thermometer size={20} />
              <strong>{avgTemp === "N/A" ? "N/A" : `${avgTemp}°C`}</strong>
              <span>Avg Temperature</span>
            </div>

            <div>
              <Droplets size={20} />
              <strong>{latestReading?.normalized?.phStatus || "No Reading"}</strong>
              <span>Latest pH Status</span>
            </div>

            <div>
              <Waves size={20} />
              <strong>
                {latestReading?.normalized?.turbidityStatus || "No Reading"}
              </strong>
              <span>Latest Turbidity Status</span>
            </div>

            <div>
              <Database size={20} />
              <strong>
                {avgWaterDepth === "N/A" ? "N/A" : `${avgWaterDepth} cm`}
              </strong>
              <span>Avg Water Depth</span>
            </div>
          </div>
        </article>

        <article className="modern-overview-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Recent Sensor Issues</p>
              <h3>Warnings and critical readings</h3>
            </div>
            <AlertTriangle size={22} />
          </div>

          <div className="modern-record-list">
            {recentSensorIssues.length === 0 ? (
              <div className="modern-empty-state">
                <CheckCircle2 size={26} />
                <strong>No recent sensor issues</strong>
                <span>Temperature, pH, turbidity, and water status look stable.</span>
              </div>
            ) : (
              recentSensorIssues.map((item, index) => (
                <div className="modern-record-row" key={item.reading?.id || index}>
                  <div>
                    <strong>{item.tankName}</strong>
                    <span>{formatReadingTime(item.date)}</span>
                  </div>

                  <b className={`modern-status-chip ${item.status}`}>
                    {item.status}
                  </b>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="modern-overview-panel modern-wide-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Recent Marketplace Activity</p>
              <h3>Listings and reservations</h3>
            </div>
            <ShoppingBag size={22} />
          </div>

          <div className="modern-record-list">
            {recentMarketplaceActivity.length === 0 ? (
              <div className="modern-empty-state">
                <ShoppingBag size={26} />
                <strong>No marketplace activity yet</strong>
                <span>Crayfish listings and reservations will appear here.</span>
              </div>
            ) : (
              recentMarketplaceActivity.map((item, index) => (
                <div className="modern-record-row" key={`${item.type}-${index}`}>
                  <div>
                    <strong>
                      {item.type}: {item.title}
                    </strong>
                    <span>{formatDate(item.date)}</span>
                  </div>

                  <b className={`modern-status-chip ${item.status}`}>
                    {item.status}
                  </b>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="modern-overview-panel modern-wide-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Recent System Activity</p>
              <h3>Alerts and readings timeline</h3>
            </div>
            <Database size={22} />
          </div>

          <div className="modern-record-list">
            {recentSystemActivity.length === 0 ? (
              <div className="modern-empty-state">
                <Database size={26} />
                <strong>No recent activity</strong>
                <span>System readings and alerts will appear here once synced.</span>
              </div>
            ) : (
              recentSystemActivity.map((item, index) => (
                <div className="modern-record-row" key={`${item.type}-${index}`}>
                  <div>
                    <strong>
                      {item.type}: {item.title}
                    </strong>
                    <span>{formatDate(item.date)}</span>
                  </div>

                  <b className={`modern-status-chip ${item.status}`}>
                    {item.status}
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
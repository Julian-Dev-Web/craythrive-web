import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  DollarSign,
  Droplets,
  FileText,
  Gauge,
  Loader2,
  PackageCheck,
  PieChart,
  RefreshCw,
  ShoppingBag,
  Thermometer,
  TrendingUp,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

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
  "breeder_id",
  "recipient_id",
];

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatDate(value) {
  if (!value) return "No date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getValue(row, keys, fallback = null) {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "") {
      return row[key];
    }
  }

  return fallback;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(rows, keys) {
  const values = rows
    .map((row) => toNumber(getValue(row, keys)))
    .filter((value) => value !== null);

  if (!values.length) return "N/A";

  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(2);
}

function getWaterStatus(row) {
  const raw = lower(row?.status || row?.condition || row?.water_status || row?.severity);

  if (raw.includes("critical") || raw.includes("danger")) return "critical";
  if (raw.includes("warning") || raw.includes("dirty")) return "warning";
  if (raw.includes("normal") || raw.includes("safe") || raw.includes("good")) return "normal";

  const temp = toNumber(getValue(row, ["temperature", "temp", "water_temperature"]));
  const ph = toNumber(getValue(row, ["ph", "pH", "ph_level"]));
  const turbidity = toNumber(getValue(row, ["turbidity", "turbidity_level", "ntu"]));
  const waterLevel = toNumber(getValue(row, ["water_level", "level", "water_height"]));

  if (
    (temp !== null && (temp < 18 || temp > 32)) ||
    (ph !== null && (ph < 6 || ph > 9)) ||
    (turbidity !== null && turbidity > 70) ||
    (waterLevel !== null && waterLevel < 20)
  ) {
    return "critical";
  }

  if (
    (temp !== null && (temp < 20 || temp > 30)) ||
    (ph !== null && (ph < 6.5 || ph > 8.5)) ||
    (turbidity !== null && turbidity > 40) ||
    (waterLevel !== null && waterLevel < 35)
  ) {
    return "warning";
  }

  return "normal";
}

function getMarketStatus(row) {
  const raw = lower(row?.status || row?.listing_status || row?.order_status || row?.payment_status);

  if (raw.includes("complete")) return "completed";
  if (raw.includes("confirm")) return "confirmed";
  if (raw.includes("paid")) return "paid";
  if (raw.includes("sold")) return "sold";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("active") || raw.includes("available")) return "active";

  return raw || "pending";
}

function getOrderTotal(order) {
  return getValue(
    order,
    ["total_price", "total", "amount", "price_total", "subtotal", "price"],
    0
  );
}

function getRecordDate(row) {
  return row?.created_at || row?.updated_at || row?.timestamp || row?.date || "";
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
      row?.created_at ||
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

async function fetchRows(tableNames, userId, limit = 250) {
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

function SummaryCard({ icon: Icon, label, value, helper, tone = "default" }) {
  return (
    <article className={`modern-report-summary-card ${tone}`}>
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

function BarRow({ label, value, max, tone = "default" }) {
  const width = max > 0 ? `${Math.min((value / max) * 100, 100)}%` : "0%";

  return (
    <div className={`modern-report-bar-row ${tone}`}>
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

function DonutStat({ label, value, total, tone = "default" }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className={`modern-report-donut ${tone}`}>
      <div
        style={{
          "--percent": `${percent}%`,
        }}
      >
        <strong>{percent}%</strong>
      </div>

      <span>{label}</span>
      <small>
        {formatNumber(value)} of {formatNumber(total)}
      </small>
    </div>
  );
}

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState("tanks");
  const [datasets, setDatasets] = useState({
    tanks: [],
    readings: [],
    alerts: [],
    listings: [],
    orders: [],
  });
  const [sources, setSources] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadReports = async () => {
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
        return;
      }

      const [tanks, readings, alerts, listings, orders] = await Promise.all([
        fetchRows(tableGroups.tanks, currentUser.id),
        fetchRows(tableGroups.readings, currentUser.id),
        fetchRows(tableGroups.alerts, currentUser.id),
        fetchRows(tableGroups.listings, currentUser.id),
        fetchRows(tableGroups.orders, currentUser.id),
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

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Reports loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const tankAnalytics = useMemo(() => {
    const readingStatus = datasets.readings.map(getWaterStatus);
    const normal = readingStatus.filter((status) => status === "normal").length;
    const warning = readingStatus.filter((status) => status === "warning").length;
    const critical = readingStatus.filter((status) => status === "critical").length;

    const alertCritical = datasets.alerts.filter((alert) => {
      const status = lower(alert?.severity || alert?.status || alert?.priority);
      return status.includes("critical") || status.includes("danger") || status.includes("high");
    }).length;

    return {
      totalTanks: datasets.tanks.length,
      totalReadings: datasets.readings.length,
      totalAlerts: datasets.alerts.length,
      normal,
      warning,
      critical,
      alertCritical,
      avgTemp: average(datasets.readings, ["temperature", "temp", "water_temperature"]),
      avgPh: average(datasets.readings, ["ph", "pH", "ph_level"]),
      avgTurbidity: average(datasets.readings, ["turbidity", "turbidity_level", "ntu"]),
      avgWaterLevel: average(datasets.readings, ["water_level", "level", "water_height"]),
    };
  }, [datasets]);

  const marketAnalytics = useMemo(() => {
    const activeListings = datasets.listings.filter(
      (listing) => getMarketStatus(listing) === "active"
    ).length;

    const soldListings = datasets.listings.filter(
      (listing) => getMarketStatus(listing) === "sold"
    ).length;

    const completedOrders = datasets.orders.filter((order) =>
      ["completed", "confirmed", "paid"].includes(getMarketStatus(order))
    );

    const pendingOrders = datasets.orders.filter(
      (order) => getMarketStatus(order) === "pending"
    ).length;

    const cancelledOrders = datasets.orders.filter((order) =>
      ["cancelled", "rejected"].includes(getMarketStatus(order))
    ).length;

    const totalSales = completedOrders.reduce(
      (sum, order) => sum + Number(getOrderTotal(order) || 0),
      0
    );

    return {
      totalListings: datasets.listings.length,
      activeListings,
      soldListings,
      totalOrders: datasets.orders.length,
      completedOrders: completedOrders.length,
      pendingOrders,
      cancelledOrders,
      totalSales,
    };
  }, [datasets]);

  const tankBars = [
    { label: "Normal readings", value: tankAnalytics.normal, tone: "success" },
    { label: "Warning readings", value: tankAnalytics.warning, tone: "warning" },
    { label: "Critical readings", value: tankAnalytics.critical, tone: "danger" },
    { label: "Critical alerts", value: tankAnalytics.alertCritical, tone: "danger" },
  ];

  const marketBars = [
    { label: "Active listings", value: marketAnalytics.activeListings, tone: "success" },
    { label: "Sold listings", value: marketAnalytics.soldListings, tone: "default" },
    { label: "Completed orders", value: marketAnalytics.completedOrders, tone: "success" },
    { label: "Pending orders", value: marketAnalytics.pendingOrders, tone: "warning" },
    { label: "Cancelled orders", value: marketAnalytics.cancelledOrders, tone: "danger" },
  ];

  const maxTankBar = Math.max(1, ...tankBars.map((item) => item.value));
  const maxMarketBar = Math.max(1, ...marketBars.map((item) => item.value));

  const recentTankRecords = [...datasets.alerts, ...datasets.readings]
    .sort((a, b) => new Date(getRecordDate(b)) - new Date(getRecordDate(a)))
    .slice(0, 6);

  const recentMarketRecords = [...datasets.orders, ...datasets.listings]
    .sort((a, b) => new Date(getRecordDate(b)) - new Date(getRecordDate(a)))
    .slice(0, 6);

  if (isLoading) {
    return (
      <section className="modern-report-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading reports...</h3>
        <p>CrayThrive is preparing your dashboard analytics.</p>
      </section>
    );
  }

  return (
    <div className="modern-reports-page">
      <section className="modern-reports-hero">
        <div>
          <p className="dashboard-eyebrow">Reports & Analytics</p>
          <h2>Understand tank health and marketplace performance.</h2>
          <p>
            Switch between aquaculture reports and marketplace analytics. This
            view summarizes sensor conditions, alerts, listings, orders, and sales.
          </p>

          <div className="modern-report-actions">
            <button className="dashboard-primary-button" onClick={loadReports}>
              <RefreshCw size={18} />
              Refresh Reports
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : "Waiting for report sync"}
            </span>
          </div>
        </div>

        <div className="modern-report-hero-card">
          <FileText size={38} />
          <strong>{activeReport === "tanks" ? "Tank" : "Market"}</strong>
          <span>Active report view</span>
        </div>
      </section>

      <section className="modern-report-tabs">
        <button
          type="button"
          className={activeReport === "tanks" ? "is-active" : ""}
          onClick={() => setActiveReport("tanks")}
        >
          <Droplets size={18} />
          Tank Reports
        </button>

        <button
          type="button"
          className={activeReport === "market" ? "is-active" : ""}
          onClick={() => setActiveReport("market")}
        >
          <ShoppingBag size={18} />
          Market Reports
        </button>
      </section>

      {activeReport === "tanks" ? (
        <>
          <section className="modern-report-summary-grid">
            <SummaryCard
              icon={Droplets}
              label="Total Tanks"
              value={tankAnalytics.totalTanks}
              helper={`Source: ${sources.tanks || "tanks"}`}
            />

            <SummaryCard
              icon={Activity}
              label="Readings"
              value={tankAnalytics.totalReadings}
              helper={`Source: ${sources.readings || "readings"}`}
            />

            <SummaryCard
              icon={AlertTriangle}
              label="Critical Alerts"
              value={tankAnalytics.alertCritical}
              helper={`${tankAnalytics.totalAlerts} total alerts`}
              tone={tankAnalytics.alertCritical > 0 ? "danger" : "success"}
            />

            <SummaryCard
              icon={Thermometer}
              label="Avg Temperature"
              value={
                tankAnalytics.avgTemp === "N/A"
                  ? "N/A"
                  : `${tankAnalytics.avgTemp}°C`
              }
              helper="Average sensor value"
            />
          </section>

          <section className="modern-report-grid">
            <article className="modern-report-panel">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Water Metrics</p>
                  <h3>Average tank condition</h3>
                </div>
                <Gauge size={22} />
              </div>

              <div className="modern-report-metric-grid">
                <div>
                  <Thermometer size={20} />
                  <strong>
                    {tankAnalytics.avgTemp === "N/A"
                      ? "N/A"
                      : `${tankAnalytics.avgTemp}°C`}
                  </strong>
                  <span>Temperature</span>
                </div>

                <div>
                  <Droplets size={20} />
                  <strong>{tankAnalytics.avgPh}</strong>
                  <span>pH Level</span>
                </div>

                <div>
                  <Waves size={20} />
                  <strong>{tankAnalytics.avgTurbidity}</strong>
                  <span>Turbidity</span>
                </div>

                <div>
                  <Gauge size={20} />
                  <strong>{tankAnalytics.avgWaterLevel}</strong>
                  <span>Water Level</span>
                </div>
              </div>
            </article>

            <article className="modern-report-panel">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Status Graph</p>
                  <h3>Reading distribution</h3>
                </div>
                <BarChart3 size={22} />
              </div>

              <div className="modern-report-bars">
                {tankBars.map((item) => (
                  <BarRow
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    max={maxTankBar}
                    tone={item.tone}
                  />
                ))}
              </div>
            </article>

            <article className="modern-report-panel modern-report-wide">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Condition Share</p>
                  <h3>Tank safety percentage</h3>
                </div>
                <PieChart size={22} />
              </div>

              <div className="modern-report-donut-grid">
                <DonutStat
                  label="Normal"
                  value={tankAnalytics.normal}
                  total={tankAnalytics.totalReadings}
                  tone="success"
                />

                <DonutStat
                  label="Warning"
                  value={tankAnalytics.warning}
                  total={tankAnalytics.totalReadings}
                  tone="warning"
                />

                <DonutStat
                  label="Critical"
                  value={tankAnalytics.critical}
                  total={tankAnalytics.totalReadings}
                  tone="danger"
                />
              </div>
            </article>

            <article className="modern-report-panel modern-report-wide">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Recent Tank Records</p>
                  <h3>Latest tank-side activities</h3>
                </div>
                <Database size={22} />
              </div>

              <div className="modern-report-list">
                {recentTankRecords.length === 0 ? (
                  <div className="modern-report-empty-small">
                    <CheckCircle2 size={28} />
                    <strong>No tank report records yet</strong>
                    <span>Sensor and alert records will appear once synced.</span>
                  </div>
                ) : (
                  recentTankRecords.map((record, index) => (
                    <div className="modern-report-row" key={record?.id || index}>
                      <div>
                        <strong>
                          {record?.title ||
                            record?.tank_name ||
                            record?.type ||
                            record?.sensor_type ||
                            `Tank Record ${index + 1}`}
                        </strong>
                        <span>{formatDate(getRecordDate(record))}</span>
                      </div>

                      <b className={`modern-report-chip ${getWaterStatus(record)}`}>
                        {getWaterStatus(record)}
                      </b>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>
        </>
      ) : (
        <>
          <section className="modern-report-summary-grid">
            <SummaryCard
              icon={ShoppingBag}
              label="Listings"
              value={marketAnalytics.totalListings}
              helper={`${marketAnalytics.activeListings} active listing(s)`}
            />

            <SummaryCard
              icon={PackageCheck}
              label="Orders"
              value={marketAnalytics.totalOrders}
              helper={`${marketAnalytics.completedOrders} completed/paid`}
            />

            <SummaryCard
              icon={DollarSign}
              label="Sales Value"
              value={formatPeso(marketAnalytics.totalSales)}
              helper="Completed order total"
              tone="success"
            />

            <SummaryCard
              icon={TrendingUp}
              label="Conversion"
              value={
                marketAnalytics.totalListings > 0
                  ? `${Math.round(
                      (marketAnalytics.completedOrders /
                        marketAnalytics.totalListings) *
                        100
                    )}%`
                  : "0%"
              }
              helper="Orders compared to listings"
            />
          </section>

          <section className="modern-report-grid">
            <article className="modern-report-panel">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Sales Analytics</p>
                  <h3>Marketplace performance</h3>
                </div>
                <DollarSign size={22} />
              </div>

              <div className="modern-report-sales-card">
                <strong>{formatPeso(marketAnalytics.totalSales)}</strong>
                <span>Total completed sales value</span>
                <p>
                  Based on completed, confirmed, or paid order records from your
                  marketplace tables.
                </p>
              </div>
            </article>

            <article className="modern-report-panel">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Order Graph</p>
                  <h3>Market distribution</h3>
                </div>
                <BarChart3 size={22} />
              </div>

              <div className="modern-report-bars">
                {marketBars.map((item) => (
                  <BarRow
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    max={maxMarketBar}
                    tone={item.tone}
                  />
                ))}
              </div>
            </article>

            <article className="modern-report-panel modern-report-wide">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Order Status Share</p>
                  <h3>Buyer activity percentage</h3>
                </div>
                <PieChart size={22} />
              </div>

              <div className="modern-report-donut-grid">
                <DonutStat
                  label="Completed"
                  value={marketAnalytics.completedOrders}
                  total={marketAnalytics.totalOrders}
                  tone="success"
                />

                <DonutStat
                  label="Pending"
                  value={marketAnalytics.pendingOrders}
                  total={marketAnalytics.totalOrders}
                  tone="warning"
                />

                <DonutStat
                  label="Cancelled"
                  value={marketAnalytics.cancelledOrders}
                  total={marketAnalytics.totalOrders}
                  tone="danger"
                />
              </div>
            </article>

            <article className="modern-report-panel modern-report-wide">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Recent Market Records</p>
                  <h3>Latest listing and order activity</h3>
                </div>
                <ShoppingBag size={22} />
              </div>

              <div className="modern-report-list">
                {recentMarketRecords.length === 0 ? (
                  <div className="modern-report-empty-small">
                    <ShoppingBag size={28} />
                    <strong>No market report records yet</strong>
                    <span>Listings and order records will appear once synced.</span>
                  </div>
                ) : (
                  recentMarketRecords.map((record, index) => (
                    <div className="modern-report-row" key={record?.id || index}>
                      <div>
                        <strong>
                          {record?.title ||
                            record?.product_name ||
                            record?.listing_title ||
                            record?.item_name ||
                            `Market Record ${index + 1}`}
                        </strong>
                        <span>{formatDate(getRecordDate(record))}</span>
                      </div>

                      <b className={`modern-report-chip ${getMarketStatus(record)}`}>
                        {getMarketStatus(record)}
                      </b>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>
        </>
      )}
    </div>
  );
}
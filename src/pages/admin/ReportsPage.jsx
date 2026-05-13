import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Camera,
  Database,
  Download,
  Droplets,
  FileText,
  FlaskConical,
  Gauge,
  Layers,
  Loader2,
  PackageCheck,
  PieChart,
  Printer,
  RefreshCw,
  ShoppingBag,
  Thermometer,
  TrendingUp,
  Wallet,
  Waves,
} from "lucide-react";
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

const chartColors = [
  "#00d9c7",
  "#ffd43b",
  "#ff5c7a",
  "#6058ff",
  "#3ae8ff",
  "#9b8cff",
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

function formatPrice(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return "₱0";

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
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
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(value) {
  if (!value) return "No date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined) return row[key];
  }

  return null;
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
  if (raw.includes("reserve")) return "reserved";
  if (raw.includes("complete")) return "completed";
  if (raw.includes("confirm")) return "confirmed";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("resolved")) return "resolved";
  if (raw.includes("hidden")) return "hidden";
  if (raw.includes("active")) return "active";
  if (raw.includes("normal") || raw.includes("safe") || raw.includes("good")) {
    return "normal";
  }

  return raw || "normal";
}

function getTankType(tank) {
  return (
    tank?.type ||
    tank?.tank_type ||
    tank?.stage ||
    tank?.tank_stage ||
    tank?.category ||
    "General"
  );
}

function getListingType(listing) {
  return (
    listing?.crayfish_type ||
    listing?.type ||
    listing?.species ||
    listing?.category ||
    "Crayfish"
  );
}

function getListingStage(listing) {
  return (
    listing?.stage ||
    listing?.life_stage ||
    listing?.size_stage ||
    listing?.age_stage ||
    "Unspecified"
  );
}

function getListingPrice(listing) {
  return (
    listing?.price ||
    listing?.unit_price ||
    listing?.selling_price ||
    listing?.amount ||
    0
  );
}

function getListingQuantity(listing) {
  return listing?.quantity || listing?.qty || listing?.stock || listing?.count || 1;
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

function averageNumber(rows, keys) {
  const values = rows
    .map((row) => Number(getValue(row, keys)))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) return "N/A";

  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(2);
}

function countBy(rows, getter) {
  const map = new Map();

  rows.forEach((row) => {
    const key = clean(getter(row)) || "Unknown";
    map.set(key, (map.get(key) || 0) + 1);
  });

  return Array.from(map.entries()).map(([label, value]) => ({
    label,
    value,
  }));
}

function sumBy(rows, getter) {
  return rows.reduce((sum, row) => {
    const value = Number(getter(row));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function groupDailyCount(rows) {
  const map = new Map();

  rows.forEach((row) => {
    const label = formatShortDate(getDateValue(row));
    if (label === "No date") return;
    map.set(label, (map.get(label) || 0) + 1);
  });

  return Array.from(map.entries())
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));
}

function groupDailySales(rows) {
  const map = new Map();

  rows.forEach((row) => {
    const label = formatShortDate(getDateValue(row));
    if (label === "No date") return;

    const value = Number(getOrderTotal(row));
    map.set(label, (map.get(label) || 0) + (Number.isFinite(value) ? value : 0));
  });

  return Array.from(map.entries())
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));
}

function filterByDateRange(rows, dateFrom, dateTo) {
  return rows.filter((row) => {
    const rawDate = getDateValue(row);
    const date = rawDate ? new Date(rawDate) : null;

    if (!date || Number.isNaN(date.getTime())) return true;

    const matchesFrom = !dateFrom || date >= new Date(`${dateFrom}T00:00:00`);
    const matchesTo = !dateTo || date <= new Date(`${dateTo}T23:59:59`);

    return matchesFrom && matchesTo;
  });
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

async function fetchRows(tableNames, userId, limit = 600) {
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

function downloadCsv(filename, rows) {
  if (!rows.length) return;

  const keys = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const escapeCell = (value) => {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  };

  const csv = [
    keys.join(","),
    ...rows.map((row) => keys.map((key) => escapeCell(row[key])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function StatCard({ icon: Icon, label, value, helper }) {
  return (
    <article className="reports-summary-card">
      <span>
        <Icon size={22} />
      </span>
      <strong>{value}</strong>
      <p>{label}</p>
      <small>{helper}</small>
    </article>
  );
}

function PieAnalytics({ title, subtitle, data }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  let current = 0;
  const gradient =
    total > 0
      ? `conic-gradient(${data
          .map((item, index) => {
            const start = current;
            const size = (item.value / total) * 100;
            current += size;
            return `${chartColors[index % chartColors.length]} ${start}% ${current}%`;
          })
          .join(", ")})`
      : "conic-gradient(rgba(0, 217, 199, 0.14) 0% 100%)";

  return (
    <article className="reports-panel">
      <div className="reports-panel-header">
        <div>
          <p className="dashboard-eyebrow">{subtitle}</p>
          <h3>{title}</h3>
        </div>
        <PieChart size={22} />
      </div>

      <div className="reports-pie-layout">
        <div className="reports-pie" style={{ background: gradient }}>
          <div>
            <strong>{formatNumber(total)}</strong>
            <span>Total</span>
          </div>
        </div>

        <div className="reports-legend-list">
          {data.length === 0 ? (
            <div className="reports-mini-empty">No chart data yet.</div>
          ) : (
            data.map((item, index) => (
              <div key={item.label}>
                <i style={{ background: chartColors[index % chartColors.length] }} />
                <span>{item.label}</span>
                <strong>{formatNumber(item.value)}</strong>
              </div>
            ))
          )}
        </div>
      </div>
    </article>
  );
}

function BarAnalytics({ title, subtitle, data, money = false }) {
  const max = Math.max(1, ...data.map((item) => Number(item.value) || 0));

  return (
    <article className="reports-panel">
      <div className="reports-panel-header">
        <div>
          <p className="dashboard-eyebrow">{subtitle}</p>
          <h3>{title}</h3>
        </div>
        <BarChart3 size={22} />
      </div>

      <div className="reports-bar-list">
        {data.length === 0 ? (
          <div className="reports-mini-empty">No graph data yet.</div>
        ) : (
          data.map((item) => (
            <div className="reports-bar-row" key={item.label}>
              <span>{item.label}</span>
              <div>
                <i style={{ width: `${((Number(item.value) || 0) / max) * 100}%` }} />
              </div>
              <strong>{money ? formatPrice(item.value) : formatNumber(item.value)}</strong>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function PreviewList({ title, subtitle, icon: Icon, rows }) {
  return (
    <article className="reports-panel reports-table-panel">
      <div className="reports-panel-header">
        <div>
          <p className="dashboard-eyebrow">{subtitle}</p>
          <h3>{title}</h3>
        </div>
        <Icon size={22} />
      </div>

      <div className="reports-preview-list">
        {rows.slice(0, 8).length === 0 ? (
          <div className="reports-mini-empty">No records available.</div>
        ) : (
          rows.slice(0, 8).map((row, index) => (
            <div className="reports-preview-row" key={row?.id || index}>
              <div>
                <strong>{getRecordTitle(row, "CrayThrive Record")}</strong>
                <span>{formatDate(getDateValue(row))}</span>
              </div>

              <b className={`reports-status-pill ${getStatus(row)}`}>
                {getStatus(row)}
              </b>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

export default function ReportsPage() {
  const [datasets, setDatasets] = useState({
    tanks: [],
    readings: [],
    ammonia: [],
    alerts: [],
    listings: [],
    orders: [],
  });

  const [sources, setSources] = useState({});
  const [activeReport, setActiveReport] = useState("overview");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
      console.error("Reports loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const filtered = useMemo(() => {
    return {
      tanks: datasets.tanks,
      readings: filterByDateRange(datasets.readings, dateFrom, dateTo),
      ammonia: filterByDateRange(datasets.ammonia, dateFrom, dateTo),
      alerts: filterByDateRange(datasets.alerts, dateFrom, dateTo),
      listings: filterByDateRange(datasets.listings, dateFrom, dateTo),
      orders: filterByDateRange(datasets.orders, dateFrom, dateTo),
    };
  }, [datasets, dateFrom, dateTo]);

  const exportRows = useMemo(() => {
    if (activeReport === "tanks") {
      return [...filtered.tanks, ...filtered.readings, ...filtered.ammonia, ...filtered.alerts];
    }

    if (activeReport === "marketplace") {
      return [...filtered.listings, ...filtered.orders];
    }

    return [
      ...filtered.tanks,
      ...filtered.readings,
      ...filtered.ammonia,
      ...filtered.alerts,
      ...filtered.listings,
      ...filtered.orders,
    ];
  }, [activeReport, filtered]);

  const avgTemp = averageNumber(filtered.readings, [
    "temperature",
    "temp",
    "water_temperature",
  ]);

  const avgPh = averageNumber(filtered.readings, ["ph", "pH", "ph_level"]);

  const avgTurbidity = averageNumber(filtered.readings, [
    "turbidity",
    "turbidity_level",
    "ntu",
  ]);

  const avgWaterLevel = averageNumber(filtered.readings, [
    "water_level",
    "level",
    "water_height",
  ]);

  const totalSales = sumBy(filtered.orders, getOrderTotal);
  const potentialListingValue = sumBy(
    filtered.listings,
    (listing) => Number(getListingPrice(listing)) * Number(getListingQuantity(listing))
  );

  const completedOrders = filtered.orders.filter(
    (order) => getStatus(order) === "completed" || getStatus(order) === "confirmed"
  ).length;

  const soldListings = filtered.listings.filter(
    (listing) => getStatus(listing) === "sold"
  ).length;

  const tankStatusData = countBy(filtered.tanks, getStatus);
  const readingStatusData = countBy(filtered.readings, getStatus);
  const tankTypeData = countBy(filtered.tanks, getTankType);
  const listingStatusData = countBy(filtered.listings, getStatus);
  const orderStatusData = countBy(filtered.orders, getStatus);
  const listingTypeData = countBy(filtered.listings, getListingType);
  const listingStageData = countBy(filtered.listings, getListingStage);

  const activityData = groupDailyCount([
    ...filtered.readings,
    ...filtered.alerts,
    ...filtered.listings,
    ...filtered.orders,
  ]);

  const sensorData = groupDailyCount(filtered.readings);
  const alertData = groupDailyCount(filtered.alerts);
  const salesData = groupDailySales(filtered.orders);
  const listingActivityData = groupDailyCount(filtered.listings);

  return (
    <div className="reports-page">
      <section className="reports-header-card">
        <div>
          <p className="dashboard-eyebrow">Analytics Center</p>
          <h2>Reports & Analytics</h2>
          <p>
            Switch between overview, tank analytics, and marketplace analytics.
            This page summarizes tank conditions, sensor performance, ammonia
            checks, listing activity, orders, and sales from your CrayThrive
            account.
          </p>

          <div className="reports-header-actions">
            <button className="dashboard-primary-button" onClick={loadReports}>
              {isLoading ? (
                <Loader2 className="spin-icon" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
              Refresh Reports
            </button>

            <button
              className="reports-secondary-button"
              type="button"
              onClick={() => window.print()}
            >
              <Printer size={18} />
              Print
            </button>

            <button
              className="reports-secondary-button"
              type="button"
              onClick={() =>
                downloadCsv(`craythrive-${activeReport}-analytics.csv`, exportRows)
              }
            >
              <Download size={18} />
              Export CSV
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : "Waiting for analytics sync"}
            </span>
          </div>
        </div>
      </section>

      <section className="reports-switch-card">
        <div className="reports-tabs">
          <button
            className={activeReport === "overview" ? "is-active" : ""}
            onClick={() => setActiveReport("overview")}
          >
            <BarChart3 size={18} />
            Overview
          </button>

          <button
            className={activeReport === "tanks" ? "is-active" : ""}
            onClick={() => setActiveReport("tanks")}
          >
            <Droplets size={18} />
            Tank Analytics
          </button>

          <button
            className={activeReport === "marketplace" ? "is-active" : ""}
            onClick={() => setActiveReport("marketplace")}
          >
            <ShoppingBag size={18} />
            Marketplace Analytics
          </button>
        </div>

        <div className="reports-date-controls">
          <label>
            <CalendarDays size={18} />
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>

          <label>
            <CalendarDays size={18} />
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
        </div>
      </section>

      {isLoading ? (
        <section className="reports-empty-state">
          <Loader2 className="spin-icon" size={30} />
          <h3>Loading analytics...</h3>
          <p>Please wait while CrayThrive summarizes your records.</p>
        </section>
      ) : (
        <>
          {activeReport === "overview" && (
            <>
              <section className="reports-summary-grid">
                <StatCard
                  icon={Droplets}
                  label="Tanks"
                  value={formatNumber(filtered.tanks.length)}
                  helper={`Source: ${sources.tanks || "tanks"}`}
                />

                <StatCard
                  icon={Activity}
                  label="Sensor readings"
                  value={formatNumber(filtered.readings.length)}
                  helper={`Avg temp: ${avgTemp}`}
                />

                <StatCard
                  icon={Camera}
                  label="Ammonia records"
                  value={formatNumber(filtered.ammonia.length)}
                  helper={`Source: ${sources.ammonia || "ammonia_readings"}`}
                />

                <StatCard
                  icon={AlertTriangle}
                  label="Alerts"
                  value={formatNumber(filtered.alerts.length)}
                  helper={`${countBy(filtered.alerts, getStatus)
                    .map((item) => `${item.label}: ${item.value}`)
                    .slice(0, 2)
                    .join(" • ") || "No alert summary"}`}
                />

                <StatCard
                  icon={ShoppingBag}
                  label="Listings"
                  value={formatNumber(filtered.listings.length)}
                  helper={`${soldListings} sold listing(s)`}
                />

                <StatCard
                  icon={PackageCheck}
                  label="Orders"
                  value={formatNumber(filtered.orders.length)}
                  helper={`${completedOrders} completed/confirmed`}
                />
              </section>

              <section className="reports-analytics-grid">
                <PieAnalytics
                  title="Overall Activity Mix"
                  subtitle="Overview"
                  data={[
                    { label: "Readings", value: filtered.readings.length },
                    { label: "Alerts", value: filtered.alerts.length },
                    { label: "Listings", value: filtered.listings.length },
                    { label: "Orders", value: filtered.orders.length },
                    { label: "Ammonia", value: filtered.ammonia.length },
                  ]}
                />

                <BarAnalytics
                  title="Daily Activity"
                  subtitle="Overview Graph"
                  data={activityData}
                />

                <PreviewList
                  title="Latest System Records"
                  subtitle="Preview"
                  icon={Database}
                  rows={exportRows}
                />
              </section>
            </>
          )}

          {activeReport === "tanks" && (
            <>
              <section className="reports-summary-grid">
                <StatCard
                  icon={Droplets}
                  label="Total tanks"
                  value={formatNumber(filtered.tanks.length)}
                  helper="Registered tank records"
                />

                <StatCard
                  icon={Thermometer}
                  label="Average temperature"
                  value={avgTemp === "N/A" ? "N/A" : `${avgTemp}°C`}
                  helper="From sensor readings"
                />

                <StatCard
                  icon={FlaskConical}
                  label="Average pH"
                  value={avgPh}
                  helper="From sensor readings"
                />

                <StatCard
                  icon={Waves}
                  label="Average turbidity"
                  value={avgTurbidity}
                  helper="From sensor readings"
                />

                <StatCard
                  icon={Gauge}
                  label="Average water level"
                  value={avgWaterLevel}
                  helper="From sensor readings"
                />

                <StatCard
                  icon={Camera}
                  label="Ammonia checks"
                  value={formatNumber(filtered.ammonia.length)}
                  helper="Camera/mobile ammonia records"
                />
              </section>

              <section className="reports-analytics-grid">
                <PieAnalytics
                  title="Tank Status Distribution"
                  subtitle="Tank Analytics"
                  data={tankStatusData}
                />

                <PieAnalytics
                  title="Tank Type Distribution"
                  subtitle="Tank Analytics"
                  data={tankTypeData}
                />

                <BarAnalytics
                  title="Sensor Reading Volume"
                  subtitle="Tank Graph"
                  data={sensorData}
                />

                <BarAnalytics
                  title="Alert Volume"
                  subtitle="Tank Graph"
                  data={alertData}
                />

                <PieAnalytics
                  title="Sensor Condition Status"
                  subtitle="Tank Analytics"
                  data={readingStatusData}
                />

                <PreviewList
                  title="Latest Tank Records"
                  subtitle="Tank Preview"
                  icon={Layers}
                  rows={[...filtered.tanks, ...filtered.readings, ...filtered.ammonia]}
                />
              </section>
            </>
          )}

          {activeReport === "marketplace" && (
            <>
              <section className="reports-summary-grid">
                <StatCard
                  icon={ShoppingBag}
                  label="Total listings"
                  value={formatNumber(filtered.listings.length)}
                  helper="Crayfish-only listings"
                />

                <StatCard
                  icon={Wallet}
                  label="Total sales"
                  value={formatPrice(totalSales)}
                  helper="From order records"
                />

                <StatCard
                  icon={TrendingUp}
                  label="Potential value"
                  value={formatPrice(potentialListingValue)}
                  helper="Price × quantity of listings"
                />

                <StatCard
                  icon={PackageCheck}
                  label="Orders"
                  value={formatNumber(filtered.orders.length)}
                  helper={`${completedOrders} completed/confirmed`}
                />

                <StatCard
                  icon={ShoppingBag}
                  label="Sold listings"
                  value={formatNumber(soldListings)}
                  helper="Marketplace sold records"
                />

                <StatCard
                  icon={FileText}
                  label="Listing source"
                  value={sources.listings || "listings"}
                  helper={`Orders source: ${sources.orders || "orders"}`}
                />
              </section>

              <section className="reports-analytics-grid">
                <PieAnalytics
                  title="Listing Status Distribution"
                  subtitle="Market Analytics"
                  data={listingStatusData}
                />

                <PieAnalytics
                  title="Order Status Distribution"
                  subtitle="Market Analytics"
                  data={orderStatusData}
                />

                <BarAnalytics
                  title="Daily Sales"
                  subtitle="Sales Graph"
                  data={salesData}
                  money
                />

                <BarAnalytics
                  title="Listing Activity"
                  subtitle="Market Graph"
                  data={listingActivityData}
                />

                <PieAnalytics
                  title="Crayfish Type Distribution"
                  subtitle="Market Analytics"
                  data={listingTypeData}
                />

                <PieAnalytics
                  title="Stage Distribution"
                  subtitle="Market Analytics"
                  data={listingStageData}
                />

                <PreviewList
                  title="Latest Marketplace Records"
                  subtitle="Market Preview"
                  icon={ShoppingBag}
                  rows={[...filtered.listings, ...filtered.orders]}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
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
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  normalizeSensorReading,
  toNumberOrNull,
} from "../../utils/sensorReadingUtils";
import { downloadCsv, printReport } from "../../utils/exportPrintUtils";

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

function normalizeStatusText(value) {
  return lower(value).replaceAll("_", " ").replaceAll("-", " ");
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

function averageFromNormalized(items, key) {
  const values = items
    .map((item) => toNumberOrNull(item.normalized[key]))
    .filter((value) => value !== null);

  if (!values.length) return "N/A";

  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(2);
}

function getMarketStatus(row) {
  const raw = normalizeStatusText(
    row?.status ||
      row?.listing_status ||
      row?.order_status ||
      row?.payment_status ||
      row?.reservation_status ||
      row?.availability ||
      ""
  );

  if (raw.includes("complete")) return "completed";
  if (raw.includes("confirm")) return "confirmed";
  if (raw.includes("paid")) return "paid";
  if (raw.includes("sold")) return "sold";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("reject")) return "rejected";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("active") || raw.includes("available")) return "active";

  return raw || "pending";
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
    raw.includes("high") ||
    raw.includes("unsafe")
  ) {
    return "critical";
  }

  if (
    raw.includes("warning") ||
    raw.includes("medium") ||
    raw.includes("dirty") ||
    raw.includes("low")
  ) {
    return "warning";
  }

  return "normal";
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

function getReadingName(reading, index) {
  return (
    reading?.tank_name ||
    reading?.tank_label ||
    reading?.name ||
    reading?.tank_id ||
    reading?.iot_device_id ||
    reading?.device_uid ||
    `Reading ${index + 1}`
  );
}

function getMarketTitle(record, index) {
  return (
    record?.title ||
    record?.product_name ||
    record?.listing_title ||
    record?.item_name ||
    record?.name ||
    `Market Record ${index + 1}`
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
      row?.created_at ||
      `row-${index}`;

    map.set(String(id), row);
  });

  return Array.from(map.values());
}

async function getCurrentUserWithRole() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  if (!user) {
    return {
      id: "",
      email: "",
      role: "",
      isAdmin: false,
    };
  }

  let profile = null;

  const byId = await supabase
    .from("profiles")
    .select("id,email,role")
    .eq("id", user.id)
    .maybeSingle();

  if (!byId.error && byId.data) {
    profile = byId.data;
  }

  if (!profile && user.email) {
    const byEmail = await supabase
      .from("profiles")
      .select("id,email,role")
      .ilike("email", user.email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      profile = byEmail.data;
    }
  }

  const role = lower(profile?.role);

  return {
    id: user.id || "",
    email: user.email || "",
    role,
    isAdmin: role === "admin",
  };
}

async function fetchAdminRows(tableNames, limit = 500) {
  for (const tableName of tableNames) {
    const ordered = await supabase
      .from(tableName)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!ordered.error && Array.isArray(ordered.data)) {
      return {
        rows: uniqueRows(ordered.data),
        tableUsed: tableName,
      };
    }

    const plain = await supabase.from(tableName).select("*").limit(limit);

    if (!plain.error && Array.isArray(plain.data)) {
      return {
        rows: uniqueRows(plain.data),
        tableUsed: tableName,
      };
    }
  }

  return {
    rows: [],
    tableUsed: tableNames[0],
  };
}

async function fetchUserRows(tableNames, userId, limit = 300) {
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

async function fetchRowsByScope(tableNames, currentUser, limit = 400) {
  if (currentUser.isAdmin) {
    return fetchAdminRows(tableNames, limit);
  }

  return fetchUserRows(tableNames, currentUser.id, limit);
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
      <div style={{ "--percent": `${percent}%` }}>
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
  const [exportScope, setExportScope] = useState("both");
  const [datasets, setDatasets] = useState({
    tanks: [],
    readings: [],
    alerts: [],
    listings: [],
    orders: [],
  });
  const [sources, setSources] = useState({});
  const [scopeLabel, setScopeLabel] = useState("User view");
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadReports = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUserWithRole();

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

      const [tanks, readings, alerts, listings, orders] = await Promise.all([
        fetchRowsByScope(tableGroups.tanks, currentUser, 500),
        fetchRowsByScope(tableGroups.readings, currentUser, 500),
        fetchRowsByScope(tableGroups.alerts, currentUser, 500),
        fetchRowsByScope(tableGroups.listings, currentUser, 500),
        fetchRowsByScope(tableGroups.orders, currentUser, 500),
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

      setScopeLabel(
        currentUser.isAdmin ? "Admin all-records view" : "User account view"
      );
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

  const enrichedReadings = useMemo(() => {
    return datasets.readings.map((reading, index) => {
      const normalized = normalizeSensorReading(reading);
      const status = getOverallReadingStatus(normalized);

      return {
        reading,
        normalized,
        status,
        name: getReadingName(reading, index),
        date:
          normalized.createdAt ||
          reading?.timestamp ||
          reading?.date ||
          reading?.updated_at,
      };
    });
  }, [datasets.readings]);

  const latestReading = enrichedReadings[0] || null;

  const tankAnalytics = useMemo(() => {
    const normal = enrichedReadings.filter((item) => item.status === "normal").length;
    const warning = enrichedReadings.filter((item) => item.status === "warning").length;
    const critical = enrichedReadings.filter((item) => item.status === "critical").length;

    const phWarning = enrichedReadings.filter((item) =>
      ["warning", "critical"].includes(getStatusSeverity([item.normalized.phStatus]))
    ).length;

    const turbidityWarning = enrichedReadings.filter((item) =>
      ["warning", "critical"].includes(
        getStatusSeverity([item.normalized.turbidityStatus])
      )
    ).length;

    const alertCritical = datasets.alerts.filter(
      (alert) => getAlertSeverity(alert) === "critical"
    ).length;

    return {
      totalTanks: datasets.tanks.length,
      totalReadings: enrichedReadings.length,
      totalAlerts: datasets.alerts.length,
      normal,
      warning,
      critical,
      alertCritical,
      phWarning,
      turbidityWarning,
      avgTemp: averageFromNormalized(enrichedReadings, "temperatureValue"),
      avgWaterLevel: averageFromNormalized(enrichedReadings, "waterValue"),
      latestPhStatus: latestReading?.normalized?.phStatus || "No Reading",
      latestTurbidityStatus:
        latestReading?.normalized?.turbidityStatus || "No Reading",
      latestTemperatureStatus:
        latestReading?.normalized?.temperatureStatus || "No Reading",
      latestWaterStatus: latestReading?.normalized?.waterStatus || "No Reading",
    };
  }, [datasets.tanks, datasets.alerts, enrichedReadings, latestReading]);

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
  }, [datasets.listings, datasets.orders]);

  const tankBars = [
    { label: "Normal readings", value: tankAnalytics.normal, tone: "success" },
    { label: "Warning readings", value: tankAnalytics.warning, tone: "warning" },
    { label: "Critical readings", value: tankAnalytics.critical, tone: "danger" },
    { label: "pH issues", value: tankAnalytics.phWarning, tone: "warning" },
    {
      label: "Turbidity issues",
      value: tankAnalytics.turbidityWarning,
      tone: "warning",
    },
    {
      label: "Critical alerts",
      value: tankAnalytics.alertCritical,
      tone: "danger",
    },
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

  const recentTankRecords = useMemo(() => {
    const alerts = datasets.alerts.map((alert, index) => ({
      type: "Alert",
      title:
        alert?.title ||
        alert?.alert_title ||
        alert?.notification_title ||
        alert?.type ||
        `Alert ${index + 1}`,
      status: getAlertSeverity(alert),
      date: getRecordDate(alert),
    }));

    const readings = enrichedReadings.map((item) => ({
      type: "Reading",
      title: item.name,
      status: item.status,
      date: item.date,
      ph: item.normalized.phStatus,
      turbidity: item.normalized.turbidityStatus,
    }));

    return [...alerts, ...readings]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 6);
  }, [datasets.alerts, enrichedReadings]);

  const recentMarketRecords = useMemo(() => {
    return [...datasets.orders, ...datasets.listings]
      .map((record, index) => ({
        title: getMarketTitle(record, index),
        status: getMarketStatus(record),
        date: getRecordDate(record),
      }))
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 6);
  }, [datasets.orders, datasets.listings]);

  const tankExportRows = useMemo(() => {
    const readingRows = enrichedReadings.map((item, index) => ({
      Type: "Sensor Reading",
      Name: item.name || `Reading ${index + 1}`,
      Temperature: item.normalized.temperatureLabel,
      "Temperature Status": item.normalized.temperatureStatus,
      "pH Status": item.normalized.phStatus,
      "Turbidity Status": item.normalized.turbidityStatus,
      "Water Depth": item.normalized.waterLabel,
      "Water Status": item.normalized.waterStatus,
      "Overall Status": item.status,
      Date: formatDate(item.date),
    }));

    const alertRows = datasets.alerts.map((alert, index) => ({
      Type: "Alert",
      Name:
        alert?.title ||
        alert?.alert_title ||
        alert?.notification_title ||
        alert?.type ||
        `Alert ${index + 1}`,
      Severity: getAlertSeverity(alert),
      Status: alert?.status || alert?.alert_status || "open",
      Message: alert?.message || alert?.description || alert?.body || "N/A",
      Date: formatDate(getRecordDate(alert)),
    }));

    return [...readingRows, ...alertRows];
  }, [enrichedReadings, datasets.alerts]);

  const marketExportRows = useMemo(() => {
    const listingRows = datasets.listings.map((listing, index) => ({
      Type: "Marketplace Listing",
      Name: getMarketTitle(listing, index),
      Status: getMarketStatus(listing),
      Price: getValue(
        listing,
        ["price", "amount", "unit_price", "selling_price"],
        "N/A"
      ),
      Stock: getValue(listing, ["stock", "quantity", "available_count"], "N/A"),
      Date: formatDate(getRecordDate(listing)),
    }));

    const orderRows = datasets.orders.map((order, index) => ({
      Type: "Marketplace Order",
      Name: getMarketTitle(order, index),
      Status: getMarketStatus(order),
      Amount: formatPeso(getOrderTotal(order)),
      Quantity: getValue(order, ["quantity", "qty", "count", "order_quantity"], "N/A"),
      Date: formatDate(getRecordDate(order)),
    }));

    return [...listingRows, ...orderRows];
  }, [datasets.listings, datasets.orders]);

  function getSelectedReportSections() {
    if (exportScope === "tanks") {
      return [
        {
          title: "Tank Reports",
          description:
            "Sensor readings, pH status, turbidity status, water depth, and tank alerts.",
          rows: tankExportRows,
        },
      ];
    }

    if (exportScope === "market") {
      return [
        {
          title: "Marketplace Reports",
          description:
            "Marketplace listings, orders, reservations, and sales-related records.",
          rows: marketExportRows,
        },
      ];
    }

    return [
      {
        title: "Tank Reports",
        description:
          "Sensor readings, pH status, turbidity status, water depth, and tank alerts.",
        rows: tankExportRows,
      },
      {
        title: "Marketplace Reports",
        description:
          "Marketplace listings, orders, reservations, and sales-related records.",
        rows: marketExportRows,
      },
    ];
  }

  function handleExportReportsCsv() {
    const sections = getSelectedReportSections();

    const rows = sections.flatMap((section) =>
      section.rows.map((row) => ({
        Section: section.title,
        ...row,
      }))
    );

    const filename =
      exportScope === "tanks"
        ? "craythrive-tank-reports.csv"
        : exportScope === "market"
          ? "craythrive-marketplace-reports.csv"
          : "craythrive-combined-reports.csv";

    downloadCsv(filename, rows);
  }

  function handlePrintReports() {
    const sections = getSelectedReportSections();

    printReport({
      title: "CrayThrive Reports",
      subtitle:
        exportScope === "tanks"
          ? "Tank Reports Only"
          : exportScope === "market"
            ? "Marketplace Reports Only"
            : "Tank and Marketplace Reports",
      sections,
    });
  }

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
            Switch between aquaculture reports and marketplace analytics. You
            can export or print tank reports, marketplace reports, or both.
          </p>

          <div className="modern-report-actions">
            <button className="dashboard-primary-button" onClick={loadReports}>
              <RefreshCw size={18} />
              Refresh Reports
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()} • ${scopeLabel}`
                : `Waiting for report sync • ${scopeLabel}`}
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

      <section className="modern-report-exportbar">
        <label>
          <FileText size={18} />
          <select
            value={exportScope}
            onChange={(event) => setExportScope(event.target.value)}
          >
            <option value="tanks">Tank Reports Only</option>
            <option value="market">Marketplace Reports Only</option>
            <option value="both">Tank + Marketplace Reports</option>
          </select>
        </label>

        <button type="button" onClick={handleExportReportsCsv}>
          <Download size={18} />
          Export CSV
        </button>

        <button type="button" onClick={handlePrintReports}>
          <Printer size={18} />
          Print Report
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
              helper={`${tankAnalytics.totalAlerts} total alert(s)`}
              tone={tankAnalytics.alertCritical > 0 ? "danger" : "success"}
            />

            <SummaryCard
              icon={Waves}
              label="Turbidity Issues"
              value={tankAnalytics.turbidityWarning}
              helper="Dirty / critical turbidity statuses"
              tone={tankAnalytics.turbidityWarning > 0 ? "warning" : "success"}
            />
          </section>

          <section className="modern-report-grid">
            <article className="modern-report-panel">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Water Metrics</p>
                  <h3>Latest readable condition</h3>
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
                  <span>{tankAnalytics.latestTemperatureStatus}</span>
                </div>

                <div>
                  <Droplets size={20} />
                  <strong>{tankAnalytics.latestPhStatus}</strong>
                  <span>Latest pH Status</span>
                </div>

                <div>
                  <Waves size={20} />
                  <strong>{tankAnalytics.latestTurbidityStatus}</strong>
                  <span>Latest Turbidity Status</span>
                </div>

                <div>
                  <Gauge size={20} />
                  <strong>
                    {tankAnalytics.avgWaterLevel === "N/A"
                      ? "N/A"
                      : `${tankAnalytics.avgWaterLevel} cm`}
                  </strong>
                  <span>{tankAnalytics.latestWaterStatus}</span>
                </div>
              </div>
            </article>

            <article className="modern-report-panel">
              <div className="modern-panel-heading">
                <div>
                  <p className="dashboard-eyebrow">Status Graph</p>
                  <h3>Sensor issue distribution</h3>
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
                  <h3>Reading safety percentage</h3>
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
                    <div className="modern-report-row" key={`${record.type}-${index}`}>
                      <div>
                        <strong>
                          {record.type}: {record.title}
                        </strong>
                        <span>
                          {formatDate(record.date)}
                          {record.ph ? ` • pH: ${record.ph}` : ""}
                          {record.turbidity
                            ? ` • Turbidity: ${record.turbidity}`
                            : ""}
                        </span>
                      </div>

                      <b className={`modern-report-chip ${record.status}`}>
                        {record.status}
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
                    <div className="modern-report-row" key={`market-${index}`}>
                      <div>
                        <strong>{record.title}</strong>
                        <span>{formatDate(record.date)}</span>
                      </div>

                      <b className={`modern-report-chip ${record.status}`}>
                        {record.status}
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
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DollarSign,
  Filter,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  XCircle,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const orderTables = [
  "marketplace_orders",
  "orders",
  "reservations",
  "marketplace_reservations",
];

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "seller_id",
  "buyer_id",
  "breeder_id",
];

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
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

function formatPeso(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return "₱0";

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getValue(row, keys, fallback = "N/A") {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "") {
      return row[key];
    }
  }

  return fallback;
}

function getOrderTitle(row, index) {
  return (
    row?.product_name ||
    row?.listing_title ||
    row?.item_name ||
    row?.title ||
    row?.crayfish_name ||
    `Order ${index + 1}`
  );
}

function getOrderStatus(row) {
  const raw = lower(
    row?.status ||
      row?.order_status ||
      row?.payment_status ||
      row?.reservation_status
  );

  if (raw.includes("complete")) return "completed";
  if (raw.includes("confirm")) return "confirmed";
  if (raw.includes("paid")) return "paid";
  if (raw.includes("ship") || raw.includes("deliver")) return "delivering";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("reject")) return "rejected";
  if (raw.includes("pending")) return "pending";

  return raw || "pending";
}

function getOrderTotal(row) {
  return getValue(
    row,
    ["total_price", "total", "amount", "price_total", "subtotal", "price"],
    0
  );
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id = row?.id || row?.uuid || row?.order_id || row?.reservation_id || `row-${index}`;
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

async function fetchRows(tableNames, userId, limit = 220) {
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
    <article className={`modern-order-summary-card ${tone}`}>
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

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [source, setSource] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState("newest");
  const [isLoading, setIsLoading] = useState(true);

  const loadOrders = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      if (!currentUser.id) {
        setOrders([]);
        return;
      }

      const result = await fetchRows(orderTables, currentUser.id);

      setOrders(result.rows);
      setSource(result.tableUsed);
    } catch (error) {
      console.error("Orders loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const enrichedOrders = useMemo(() => {
    return orders.map((order, index) => {
      const status = getOrderStatus(order);
      const title = getOrderTitle(order, index);
      const total = Number(getOrderTotal(order) || 0);
      const date = order?.created_at || order?.updated_at || order?.date;

      return {
        order,
        index,
        status,
        title,
        total,
        date,
      };
    });
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const filtered = enrichedOrders.filter((item) => {
      const search = searchTerm.trim().toLowerCase();

      const buyer =
        item.order?.buyer_name ||
        item.order?.customer_name ||
        item.order?.buyer_email ||
        item.order?.customer_email ||
        "";

      const matchesSearch =
        !search ||
        item.title.toLowerCase().includes(search) ||
        item.status.toLowerCase().includes(search) ||
        String(buyer).toLowerCase().includes(search) ||
        String(item.total).includes(search);

      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      return matchesSearch && matchesStatus;
    });

    return filtered.sort((a, b) => {
      if (sortMode === "oldest") {
        return new Date(a.date || 0) - new Date(b.date || 0);
      }

      if (sortMode === "highest") {
        return b.total - a.total;
      }

      if (sortMode === "lowest") {
        return a.total - b.total;
      }

      return new Date(b.date || 0) - new Date(a.date || 0);
    });
  }, [enrichedOrders, searchTerm, statusFilter, sortMode]);

  const summary = useMemo(() => {
    const completed = enrichedOrders.filter((item) =>
      ["completed", "confirmed", "paid"].includes(item.status)
    );

    const pending = enrichedOrders.filter((item) => item.status === "pending");
    const cancelled = enrichedOrders.filter((item) =>
      ["cancelled", "rejected"].includes(item.status)
    );

    const delivering = enrichedOrders.filter((item) => item.status === "delivering");

    const totalSales = completed.reduce((sum, item) => sum + item.total, 0);

    return {
      total: enrichedOrders.length,
      completed: completed.length,
      pending: pending.length,
      cancelled: cancelled.length,
      delivering: delivering.length,
      totalSales,
    };
  }, [enrichedOrders]);

  if (isLoading) {
    return (
      <section className="modern-order-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading orders...</h3>
        <p>CrayThrive is syncing your order and reservation records.</p>
      </section>
    );
  }

  return (
    <div className="modern-orders-page">
      <section className="modern-orders-hero">
        <div>
          <p className="dashboard-eyebrow">Orders</p>
          <h2>Track sales, reservations, and buyer activity.</h2>
          <p>
            Review order status, sales value, pending requests, cancellations,
            and completed transactions connected to your CrayThrive marketplace.
          </p>

          <div className="modern-orders-actions">
            <button className="dashboard-primary-button" onClick={loadOrders}>
              <RefreshCw size={18} />
              Refresh Orders
            </button>

            <span>Source: {source || "marketplace_orders"}</span>
          </div>
        </div>

        <div className="modern-orders-hero-card">
          <DollarSign size={38} />
          <strong>{formatPeso(summary.totalSales)}</strong>
          <span>Completed sales value</span>
        </div>
      </section>

      <section className="modern-order-summary-grid">
        <SummaryCard
          icon={PackageCheck}
          label="Total Orders"
          value={summary.total}
          helper="All synced order records"
        />

        <SummaryCard
          icon={CheckCircle2}
          label="Completed"
          value={summary.completed}
          helper="Completed, confirmed, or paid"
          tone="success"
        />

        <SummaryCard
          icon={Clock3}
          label="Pending"
          value={summary.pending}
          helper="Waiting for action"
          tone="warning"
        />

        <SummaryCard
          icon={Truck}
          label="Delivering"
          value={summary.delivering}
          helper="In delivery or shipment"
        />

        <SummaryCard
          icon={XCircle}
          label="Cancelled"
          value={summary.cancelled}
          helper="Cancelled or rejected"
          tone="danger"
        />
      </section>

      <section className="modern-order-toolbar">
        <div className="modern-order-search">
          <Search size={18} />
          <input
            placeholder="Search order, buyer, status, or amount..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <label className="modern-order-filter">
          <Filter size={18} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="delivering">Delivering</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>

        <label className="modern-order-filter">
          <ShoppingBag size={18} />
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="highest">Highest Amount</option>
            <option value="lowest">Lowest Amount</option>
          </select>
        </label>
      </section>

      {filteredOrders.length === 0 ? (
        <section className="modern-order-empty">
          <PackageCheck size={34} />
          <h3>No orders found</h3>
          <p>
            No order records matched your current filters. Orders from the
            marketplace will appear here once synced.
          </p>
        </section>
      ) : (
        <section className="modern-order-table-card">
          <div className="modern-order-table-header">
            <span>Order</span>
            <span>Buyer</span>
            <span>Quantity</span>
            <span>Total</span>
            <span>Status</span>
            <span>Date</span>
          </div>

          <div className="modern-order-table-body">
            {filteredOrders.map((item) => {
              const order = item.order;

              const buyer =
                order?.buyer_name ||
                order?.customer_name ||
                order?.buyer_email ||
                order?.customer_email ||
                "Buyer";

              const quantity = getValue(
                order,
                ["quantity", "qty", "count", "order_quantity"],
                "N/A"
              );

              return (
                <div className="modern-order-table-row" key={order?.id || item.index}>
                  <span data-label="Order">
                    <strong>{item.title}</strong>
                    <small>
                      #{String(order?.id || order?.order_id || item.index + 1).slice(0, 8)}
                    </small>
                  </span>

                  <span data-label="Buyer">{buyer}</span>
                  <span data-label="Quantity">{quantity}</span>
                  <span data-label="Total">{formatPeso(item.total)}</span>

                  <span data-label="Status">
                    <b className={`modern-order-status ${item.status}`}>
                      {item.status}
                    </b>
                  </span>

                  <span data-label="Date">{formatDate(item.date)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
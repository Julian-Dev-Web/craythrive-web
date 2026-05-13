import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  UserRound,
  Wallet,
  XCircle,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const orderTableNames = [
  "marketplace_orders",
  "orders",
  "reservations",
  "marketplace_reservations",
];

const listingTableNames = ["marketplace_listings", "listings", "products"];

const orderUserColumns = [
  "buyer_id",
  "seller_id",
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
];

const listingUserColumns = [
  "seller_id",
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
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

function formatPrice(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return "No total";

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getOrderId(order, index) {
  return order?.id || order?.order_id || order?.reservation_id || `order-${index}`;
}

function getListingId(order) {
  return order?.listing_id || order?.product_id || order?.marketplace_listing_id || "";
}

function getOrderStatus(order) {
  const raw = lower(order?.status || order?.order_status || "pending");

  if (raw.includes("complete")) return "completed";
  if (raw.includes("confirm")) return "confirmed";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("pending")) return "pending";

  return raw || "pending";
}

function getOrderQuantity(order) {
  return order?.quantity || order?.qty || order?.count || 1;
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

function getOrderNote(order) {
  return (
    order?.buyer_note ||
    order?.note ||
    order?.notes ||
    order?.message ||
    "No note provided."
  );
}

function getBuyerLabel(order) {
  return (
    order?.buyer_name ||
    order?.buyer_username ||
    order?.buyer_email ||
    order?.buyer_id ||
    "Buyer"
  );
}

function getSellerLabel(order) {
  return (
    order?.seller_name ||
    order?.seller_username ||
    order?.seller_email ||
    order?.seller_id ||
    "Seller"
  );
}

function getListingTitle(order, listingMap) {
  const listingId = getListingId(order);

  return (
    order?.listing_title ||
    order?.title ||
    order?.product_name ||
    order?.listing_name ||
    listingMap[listingId]?.title ||
    listingId ||
    "Marketplace Order"
  );
}

function getOrderRole(order, userId) {
  if (order?.buyer_id === userId) return "buyer";
  if (order?.seller_id === userId) return "seller";
  return "linked";
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id = row?.id || row?.order_id || row?.reservation_id || `row-${index}`;
    map.set(id, row);
  });

  return Array.from(map.values());
}

async function fetchUserOrders(userId, limit = 300) {
  for (const tableName of orderTableNames) {
    let successfulColumn = "";
    const mergedRows = [];

    for (const userColumn of orderUserColumns) {
      const ordered = await supabase
        .from(tableName)
        .select("*")
        .eq(userColumn, userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!ordered.error && Array.isArray(ordered.data)) {
        successfulColumn = userColumn;
        mergedRows.push(...ordered.data);
        continue;
      }

      const plain = await supabase
        .from(tableName)
        .select("*")
        .eq(userColumn, userId)
        .limit(limit);

      if (!plain.error && Array.isArray(plain.data)) {
        successfulColumn = userColumn;
        mergedRows.push(...plain.data);
      }
    }

    if (successfulColumn) {
      return {
        rows: uniqueRows(mergedRows),
        tableUsed: tableName,
        userColumnUsed: successfulColumn,
      };
    }
  }

  return {
    rows: [],
    tableUsed: orderTableNames[0],
    userColumnUsed: "",
  };
}

async function fetchUserListings(userId, limit = 250) {
  for (const tableName of listingTableNames) {
    for (const userColumn of listingUserColumns) {
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq(userColumn, userId)
        .limit(limit);

      if (!error && Array.isArray(data)) {
        return data;
      }
    }
  }

  return [];
}

function getListingTitleFromListing(listing) {
  return (
    listing?.title ||
    listing?.name ||
    listing?.product_name ||
    listing?.listing_title ||
    "Untitled Listing"
  );
}

export default function MarketplaceOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [listingMap, setListingMap] = useState({});
  const [tableUsed, setTableUsed] = useState("marketplace_orders");
  const [authUserId, setAuthUserId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

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
        setListingMap({});
        return;
      }

      const [orderResult, listings] = await Promise.all([
        fetchUserOrders(currentUser.id),
        fetchUserListings(currentUser.id),
      ]);

      const nextListingMap = {};

      listings.forEach((listing) => {
        const id =
          listing?.id || listing?.listing_id || listing?.product_id || listing?.uuid;

        if (id) {
          nextListingMap[id] = {
            title: getListingTitleFromListing(listing),
          };
        }
      });

      const sortedOrders = [...orderResult.rows].sort((a, b) => {
        const aDate = new Date(a.created_at || a.updated_at || 0).getTime();
        const bDate = new Date(b.created_at || b.updated_at || 0).getTime();
        return bDate - aDate;
      });

      setAuthUserId(currentUser.id);
      setOrders(sortedOrders);
      setListingMap(nextListingMap);
      setTableUsed(orderResult.tableUsed);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Marketplace orders loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const search = lower(searchTerm);
      const status = getOrderStatus(order);
      const role = getOrderRole(order, authUserId);
      const title = lower(getListingTitle(order, listingMap));
      const buyer = lower(getBuyerLabel(order));
      const seller = lower(getSellerLabel(order));
      const note = lower(getOrderNote(order));

      const matchesSearch =
        !search ||
        title.includes(search) ||
        buyer.includes(search) ||
        seller.includes(search) ||
        note.includes(search) ||
        status.includes(search);

      const matchesStatus =
        statusFilter === "all" || status === lower(statusFilter);

      const matchesRole = roleFilter === "all" || role === roleFilter;

      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [orders, listingMap, authUserId, searchTerm, statusFilter, roleFilter]);

  const stats = useMemo(() => {
    return orders.reduce(
      (acc, order) => {
        const status = getOrderStatus(order);

        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;

        return acc;
      },
      {
        total: 0,
        pending: 0,
        confirmed: 0,
        cancelled: 0,
        completed: 0,
      }
    );
  }, [orders]);

  return (
    <div className="orders-page">
      <section className="orders-header-card">
        <div>
          <p className="dashboard-eyebrow">Marketplace Transactions</p>
          <h2>Orders & Reservations</h2>
          <p>
            Review marketplace reservations and order records connected to your
            CrayThrive mobile account. Track pending, confirmed, cancelled, and
            completed transactions.
          </p>

          <div className="orders-header-actions">
            <button className="dashboard-primary-button" onClick={loadOrders}>
              {isLoading ? (
                <Loader2 className="spin-icon" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
              Refresh Orders
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : `Source table: ${tableUsed}`}
            </span>
          </div>
        </div>
      </section>

      <section className="orders-summary-grid">
        <article className="orders-summary-card">
          <span>
            <PackageCheck size={22} />
          </span>
          <strong>{stats.total}</strong>
          <p>Total orders</p>
        </article>

        <article className="orders-summary-card">
          <span>
            <Clock3 size={22} />
          </span>
          <strong>{stats.pending || 0}</strong>
          <p>Pending</p>
        </article>

        <article className="orders-summary-card">
          <span>
            <CheckCircle2 size={22} />
          </span>
          <strong>{stats.confirmed || 0}</strong>
          <p>Confirmed</p>
        </article>

        <article className="orders-summary-card">
          <span>
            <Wallet size={22} />
          </span>
          <strong>{stats.completed || 0}</strong>
          <p>Completed</p>
        </article>
      </section>

      <section className="orders-toolbar">
        <label className="orders-search-box">
          <Search size={18} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search listing, buyer, seller, note..."
          />
        </label>

        <label className="orders-filter">
          <Filter size={18} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All status</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>
        </label>

        <label className="orders-filter">
          <UserRound size={18} />
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <option value="all">Buyer & seller</option>
            <option value="buyer">As buyer</option>
            <option value="seller">As seller</option>
            <option value="linked">Linked</option>
          </select>
        </label>
      </section>

      {isLoading ? (
        <section className="orders-empty-state">
          <Loader2 className="spin-icon" size={30} />
          <h3>Loading orders...</h3>
          <p>Please wait while CrayThrive checks your transaction records.</p>
        </section>
      ) : filteredOrders.length === 0 ? (
        <section className="orders-empty-state">
          <AlertTriangle size={34} />
          <h3>No orders found</h3>
          <p>
            No marketplace transactions matched your filters. Reservations and
            completed orders will appear here once synced from the mobile app.
          </p>
        </section>
      ) : (
        <section className="orders-table-card">
          <div className="orders-table-header">
            <div>
              <p className="dashboard-eyebrow">Order History</p>
              <h3>Marketplace transactions</h3>
            </div>

            <span>{filteredOrders.length} result(s)</span>
          </div>

          <div className="orders-table">
            <div className="orders-table-row orders-table-head">
              <span>Listing</span>
              <span>Role</span>
              <span>Buyer</span>
              <span>Seller</span>
              <span>Quantity</span>
              <span>Total</span>
              <span>Status</span>
              <span>Date</span>
            </div>

            {filteredOrders.map((order, index) => {
              const status = getOrderStatus(order);
              const role = getOrderRole(order, authUserId);

              return (
                <div className="orders-table-row" key={getOrderId(order, index)}>
                  <span>
                    <strong>{getListingTitle(order, listingMap)}</strong>
                    <small>{getOrderNote(order)}</small>
                  </span>

                  <span>
                    <b className="order-role-pill">{role}</b>
                  </span>

                  <span>{getBuyerLabel(order)}</span>
                  <span>{getSellerLabel(order)}</span>
                  <span>{getOrderQuantity(order)}</span>
                  <span>{formatPrice(getOrderTotal(order))}</span>

                  <span>
                    <b className={`order-status-pill ${status}`}>
                      {status}
                    </b>
                  </span>

                  <span>{formatDate(order.created_at || order.updated_at)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
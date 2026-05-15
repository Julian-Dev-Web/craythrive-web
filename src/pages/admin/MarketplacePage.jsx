import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Filter,
  ImageIcon,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Tag,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const listingTables = ["marketplace_listings", "listings", "products"];
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

function getListingTitle(row, index) {
  return (
    row?.title ||
    row?.name ||
    row?.product_name ||
    row?.listing_title ||
    row?.crayfish_name ||
    `Crayfish Listing ${index + 1}`
  );
}

function getListingStatus(row) {
  const raw = lower(
    row?.status || row?.listing_status || row?.availability || row?.state
  );

  if (raw.includes("sold")) return "sold";
  if (raw.includes("inactive")) return "inactive";
  if (raw.includes("archived")) return "archived";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("active") || raw.includes("available")) return "active";

  return raw || "active";
}

function getOrderStatus(row) {
  const raw = lower(row?.status || row?.order_status || row?.payment_status);

  if (raw.includes("complete")) return "completed";
  if (raw.includes("confirm")) return "confirmed";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("paid")) return "paid";

  return raw || "pending";
}

function getListingPrice(row) {
  return getValue(row, ["price", "amount", "unit_price", "selling_price"], 0);
}

function getOrderTotal(row) {
  return getValue(row, ["total_price", "total", "amount", "price_total", "subtotal"], 0);
}

function getListingImage(row) {
  const direct =
    row?.image_url ||
    row?.photo_url ||
    row?.thumbnail_url ||
    row?.cover_image ||
    row?.main_image;

  if (direct) return direct;

  if (Array.isArray(row?.images) && row.images.length > 0) {
    return row.images[0]?.url || row.images[0];
  }

  if (Array.isArray(row?.image_urls) && row.image_urls.length > 0) {
    return row.image_urls[0];
  }

  return "";
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id = row?.id || row?.uuid || row?.listing_id || row?.order_id || `row-${index}`;
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

async function fetchRows(tableNames, userId, limit = 180) {
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
    <article className={`modern-market-summary-card ${tone}`}>
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

export default function MarketplacePage() {
  const [listings, setListings] = useState([]);
  const [orders, setOrders] = useState([]);
  const [sources, setSources] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const loadMarketplace = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();

      if (!currentUser.id) {
        setListings([]);
        setOrders([]);
        return;
      }

      const [listingResult, orderResult] = await Promise.all([
        fetchRows(listingTables, currentUser.id),
        fetchRows(orderTables, currentUser.id),
      ]);

      setListings(listingResult.rows);
      setOrders(orderResult.rows);
      setSources({
        listings: listingResult.tableUsed,
        orders: orderResult.tableUsed,
      });
    } catch (error) {
      console.error("Marketplace loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMarketplace();
  }, []);

  const enrichedListings = useMemo(() => {
    return listings.map((listing, index) => {
      const status = getListingStatus(listing);
      const title = getListingTitle(listing, index);
      const type = getValue(
        listing,
        ["type", "category", "breed", "crayfish_type", "variant"],
        "Crayfish"
      );

      return {
        listing,
        index,
        status,
        title,
        type,
        image: getListingImage(listing),
      };
    });
  }, [listings]);

  const listingTypes = useMemo(() => {
    return Array.from(new Set(enrichedListings.map((item) => item.type))).filter(Boolean);
  }, [enrichedListings]);

  const filteredListings = useMemo(() => {
    return enrichedListings.filter((item) => {
      const search = searchTerm.trim().toLowerCase();

      const matchesSearch =
        !search ||
        item.title.toLowerCase().includes(search) ||
        item.type.toLowerCase().includes(search) ||
        item.status.toLowerCase().includes(search);

      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      const matchesType = typeFilter === "all" || item.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [enrichedListings, searchTerm, statusFilter, typeFilter]);

  const summary = useMemo(() => {
    const active = enrichedListings.filter((item) => item.status === "active").length;
    const sold = enrichedListings.filter((item) => item.status === "sold").length;

    const completedOrders = orders.filter((order) => {
      const status = getOrderStatus(order);
      return status === "completed" || status === "confirmed" || status === "paid";
    });

    const totalSales = completedOrders.reduce(
      (sum, order) => sum + Number(getOrderTotal(order) || 0),
      0
    );

    return {
      totalListings: enrichedListings.length,
      active,
      sold,
      totalOrders: orders.length,
      completedOrders: completedOrders.length,
      totalSales,
    };
  }, [enrichedListings, orders]);

  const recentOrders = useMemo(() => {
    return [...orders]
      .sort(
        (a, b) =>
          new Date(b?.created_at || b?.updated_at || 0) -
          new Date(a?.created_at || a?.updated_at || 0)
      )
      .slice(0, 6);
  }, [orders]);

  if (isLoading) {
    return (
      <section className="modern-market-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading marketplace...</h3>
        <p>CrayThrive is syncing your marketplace listings and order records.</p>
      </section>
    );
  }

  return (
    <div className="modern-market-page">
      <section className="modern-market-hero">
        <div>
          <p className="dashboard-eyebrow">Marketplace</p>
          <h2>Manage your live crayfish listings.</h2>
          <p>
            Track active listings, sold crayfish, reservations, order activity,
            and sales value from the same account connected to the mobile app.
          </p>

          <div className="modern-market-actions">
            <button className="dashboard-primary-button" onClick={loadMarketplace}>
              <RefreshCw size={18} />
              Refresh Marketplace
            </button>

            <button className="modern-secondary-link" type="button">
              <Store size={18} />
              Add Listing from Mobile
            </button>

            <span>
              Source: {sources.listings || "marketplace_listings"} /{" "}
              {sources.orders || "orders"}
            </span>
          </div>
        </div>

        <div className="modern-market-hero-card">
          <ShoppingBag size={38} />
          <strong>{summary.active}</strong>
          <span>Active marketplace listings</span>
        </div>
      </section>

      <section className="modern-market-summary-grid">
        <SummaryCard
          icon={ShoppingBag}
          label="Total Listings"
          value={summary.totalListings}
          helper="All marketplace records"
        />

        <SummaryCard
          icon={CheckCircle2}
          label="Active Listings"
          value={summary.active}
          helper="Available for buyers"
          tone="success"
        />

        <SummaryCard
          icon={Package}
          label="Sold Listings"
          value={summary.sold}
          helper="Marked as sold"
        />

        <SummaryCard
          icon={PackageCheck}
          label="Orders"
          value={summary.totalOrders}
          helper={`${summary.completedOrders} completed/paid`}
        />

        <SummaryCard
          icon={DollarSign}
          label="Sales Value"
          value={formatPeso(summary.totalSales)}
          helper="Computed from completed orders"
        />
      </section>

      <section className="modern-market-grid">
        <article className="modern-market-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Listings</p>
              <h3>Crayfish marketplace catalog</h3>
            </div>
            <Tag size={22} />
          </div>

          <div className="modern-market-toolbar">
            <div className="modern-market-search">
              <Search size={18} />
              <input
                placeholder="Search listing name, type, or status..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>

            <label className="modern-market-filter">
              <Filter size={18} />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="sold">Sold</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            <label className="modern-market-filter">
              <Package size={18} />
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="all">All Types</option>
                {listingTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {filteredListings.length === 0 ? (
            <div className="modern-market-empty-small">
              <ShoppingBag size={30} />
              <strong>No listings found</strong>
              <span>
                No marketplace records matched your filters. Listings created
                from mobile will appear here.
              </span>
            </div>
          ) : (
            <div className="modern-market-listing-grid">
              {filteredListings.map((item) => {
                const listing = item.listing;

                return (
                  <article
                    className="modern-market-listing-card"
                    key={listing?.id || item.index}
                  >
                    <div className="modern-market-image">
                      {item.image ? (
                        <img src={item.image} alt={item.title} />
                      ) : (
                        <ImageIcon size={26} />
                      )}
                    </div>

                    <div className="modern-market-listing-body">
                      <div className="modern-market-listing-top">
                        <span className="modern-market-type">{item.type}</span>
                        <b className={`modern-market-status ${item.status}`}>
                          {item.status}
                        </b>
                      </div>

                      <h4>{item.title}</h4>

                      <div className="modern-market-meta">
                        <span>Price: {formatPeso(getListingPrice(listing))}</span>
                        <span>
                          Stock:{" "}
                          {getValue(listing, ["stock", "quantity", "available_count"], "N/A")}
                        </span>
                        <span>
                          Posted: {formatDate(listing?.created_at || listing?.updated_at)}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <article className="modern-market-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Orders</p>
              <h3>Recent buyer activity</h3>
            </div>
            <PackageCheck size={22} />
          </div>

          <div className="modern-market-order-list">
            {recentOrders.length === 0 ? (
              <div className="modern-market-empty-small">
                <AlertTriangle size={30} />
                <strong>No order records yet</strong>
                <span>Orders and reservations will appear here once synced.</span>
              </div>
            ) : (
              recentOrders.map((order, index) => {
                const title =
                  order?.product_name ||
                  order?.listing_title ||
                  order?.title ||
                  order?.item_name ||
                  `Order ${index + 1}`;

                const status = getOrderStatus(order);

                return (
                  <div className="modern-market-order-row" key={order?.id || index}>
                    <div>
                      <strong>{title}</strong>
                      <span>{formatDate(order?.created_at || order?.updated_at)}</span>
                    </div>

                    <div>
                      <b>{formatPeso(getOrderTotal(order))}</b>
                      <small className={`modern-market-status ${status}`}>
                        {status}
                      </small>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
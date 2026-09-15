import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  AlertTriangle,
  ArrowRight,
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
  Tag,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

/* =========================================================
   TABLES
========================================================= */

const listingTables = [
  "marketplace_listings",
  "listings",
  "products",
];

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

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function formatFriendlyText(value) {
  const text = clean(value);

  if (!text) {
    return "N/A";
  }

  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
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

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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

function getValue(
  row,
  keys,
  fallback = "N/A"
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

/* =========================================================
   LISTING HELPERS
========================================================= */

function getListingTitle(
  row,
  index
) {
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
    row?.status ||
      row?.listing_status ||
      row?.availability ||
      row?.state
  );

  if (raw.includes("deleted")) {
    return "deleted";
  }

  if (raw.includes("hidden")) {
    return "hidden";
  }

  if (raw.includes("sold")) {
    return "sold";
  }

  if (raw.includes("reserved")) {
    return "reserved";
  }

  if (raw.includes("inactive")) {
    return "inactive";
  }

  if (raw.includes("archived")) {
    return "archived";
  }

  if (raw.includes("pending")) {
    return "pending";
  }

  if (
    raw.includes("active") ||
    raw.includes("available")
  ) {
    return "active";
  }

  return raw || "active";
}

function getFriendlyListingStatus(status) {
  switch (status) {
    case "active":
      return "Available";

    case "reserved":
      return "Reserved";

    case "pending":
      return "Pending";

    case "sold":
      return "Sold";

    case "hidden":
      return "Hidden";

    case "inactive":
      return "Inactive";

    case "archived":
      return "Archived";

    case "deleted":
      return "Deleted";

    default:
      return formatFriendlyText(status);
  }
}

function getListingPrice(row) {
  return getValue(
    row,
    [
      "price",
      "amount",
      "unit_price",
      "selling_price",
    ],
    0
  );
}

function getListingStock(row) {
  return getValue(
    row,
    [
      "stock",
      "quantity",
      "available_count",
      "available_stock",
      "count",
    ],
    "N/A"
  );
}

function getListingImage(row) {
  const direct =
    row?.image_url ||
    row?.photo_url ||
    row?.thumbnail_url ||
    row?.cover_image ||
    row?.main_image;

  if (direct) {
    return direct;
  }

  if (
    Array.isArray(row?.images) &&
    row.images.length > 0
  ) {
    return (
      row.images[0]?.url ||
      row.images[0] ||
      ""
    );
  }

  if (
    Array.isArray(row?.image_urls) &&
    row.image_urls.length > 0
  ) {
    return row.image_urls[0];
  }

  return "";
}

/* =========================================================
   ORDER HELPERS
========================================================= */

function getOrderStatus(row) {
  const raw = lower(
    row?.status ||
      row?.order_status ||
      row?.payment_status ||
      row?.reservation_status
  );

  if (raw.includes("complete")) {
    return "completed";
  }

  if (raw.includes("confirm")) {
    return "confirmed";
  }

  if (raw.includes("cancel")) {
    return "cancelled";
  }

  if (raw.includes("paid")) {
    return "paid";
  }

  if (raw.includes("pending")) {
    return "pending";
  }

  return raw || "pending";
}

function getFriendlyOrderStatus(status) {
  switch (status) {
    case "pending":
      return "Pending";

    case "confirmed":
      return "Confirmed";

    case "completed":
      return "Completed";

    case "paid":
      return "Paid";

    case "cancelled":
      return "Cancelled";

    default:
      return formatFriendlyText(status);
  }
}

function getOrderTotal(row) {
  return getValue(
    row,
    [
      "total_price",
      "total",
      "amount",
      "price_total",
      "subtotal",
    ],
    0
  );
}

function getOrderTitle(
  order,
  index
) {
  return (
    order?.product_name ||
    order?.listing_title ||
    order?.title ||
    order?.item_name ||
    `Reservation ${index + 1}`
  );
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach(
    (row, index) => {
      const id =
        row?.id ||
        row?.uuid ||
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

async function getCurrentUser() {
  const { data } =
    await supabase.auth.getSession();

  const user =
    data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

async function fetchRows(
  tableNames,
  userId,
  limit = 180
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
        successful = true;

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
        successful = true;

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
      className={`modern-market-summary-card ${tone}`}
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

/* =========================================================
   PAGE
========================================================= */

export default function MarketplacePage() {
  const [
    listings,
    setListings,
  ] = useState([]);

  const [
    orders,
    setOrders,
  ] = useState([]);

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("all");

  const [
    typeFilter,
    setTypeFilter,
  ] = useState("all");

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  /* =======================================================
     LOAD
  ======================================================= */

  const loadMarketplace =
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
          await getCurrentUser();

        if (
          !currentUser.id
        ) {
          setListings([]);
          setOrders([]);
          return;
        }

        const [
          listingResult,
          orderResult,
        ] =
          await Promise.all([
            fetchRows(
              listingTables,
              currentUser.id
            ),

            fetchRows(
              orderTables,
              currentUser.id
            ),
          ]);

        setListings(
          listingResult.rows
        );

        setOrders(
          orderResult.rows
        );

        setLastUpdated(
          new Date()
        );
      } catch (error) {
        console.error(
          "Marketplace loading error:",
          error
        );
      } finally {
        setIsLoading(false);
      }
    };

  useEffect(() => {
    loadMarketplace();
  }, []);

  /* =======================================================
     LISTINGS
  ======================================================= */

  const enrichedListings =
    useMemo(() => {
      return listings.map(
        (
          listing,
          index
        ) => {
          const status =
            getListingStatus(
              listing
            );

          const title =
            getListingTitle(
              listing,
              index
            );

          const type =
            getValue(
              listing,
              [
                "type",
                "category",
                "breed",
                "crayfish_type",
                "variant",
              ],
              "Crayfish"
            );

          return {
            listing,
            index,
            status,
            title,
            type:
              String(type),
            image:
              getListingImage(
                listing
              ),
          };
        }
      );
    }, [listings]);

  const listingTypes =
    useMemo(() => {
      return Array.from(
        new Set(
          enrichedListings.map(
            (item) =>
              item.type
          )
        )
      ).filter(Boolean);
    }, [enrichedListings]);

  const filteredListings =
    useMemo(() => {
      return enrichedListings.filter(
        (item) => {
          const search =
            searchTerm
              .trim()
              .toLowerCase();

          const matchesSearch =
            !search ||
            item.title
              .toLowerCase()
              .includes(
                search
              ) ||
            item.type
              .toLowerCase()
              .includes(
                search
              ) ||
            item.status
              .toLowerCase()
              .includes(
                search
              );

          const matchesStatus =
            statusFilter ===
              "all" ||
            item.status ===
              statusFilter;

          const matchesType =
            typeFilter ===
              "all" ||
            item.type ===
              typeFilter;

          return (
            matchesSearch &&
            matchesStatus &&
            matchesType
          );
        }
      );
    }, [
      enrichedListings,
      searchTerm,
      statusFilter,
      typeFilter,
    ]);

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary =
    useMemo(() => {
      const active =
        enrichedListings.filter(
          (item) =>
            item.status ===
            "active"
        ).length;

      const sold =
        enrichedListings.filter(
          (item) =>
            item.status ===
            "sold"
        ).length;

      const pendingOrders =
        orders.filter(
          (order) =>
            getOrderStatus(
              order
            ) === "pending"
        ).length;

      const completedOrders =
        orders.filter(
          (order) => {
            const status =
              getOrderStatus(
                order
              );

            return [
              "completed",
              "confirmed",
              "paid",
            ].includes(
              status
            );
          }
        );

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

      return {
        totalListings:
          enrichedListings.length,

        active,

        sold,

        pendingOrders,

        totalOrders:
          orders.length,

        completedOrders:
          completedOrders.length,

        totalSales,
      };
    }, [
      enrichedListings,
      orders,
    ]);

  /* =======================================================
     RECENT ORDERS
  ======================================================= */

  const recentOrders =
    useMemo(() => {
      return [...orders]
        .sort(
          (a, b) =>
            new Date(
              b?.created_at ||
                b?.updated_at ||
                0
            ) -
            new Date(
              a?.created_at ||
                a?.updated_at ||
                0
            )
        )
        .slice(0, 6);
    }, [orders]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="modern-market-loading">

        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading marketplace...
        </h3>

        <p>
          Getting your latest
          listings and reservations.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="modern-market-page">

      {/* ===============================================
          HERO
      ================================================ */}

      <section className="modern-market-hero">

        <div>
          <p className="dashboard-eyebrow">
            Marketplace
          </p>

          <h2>
            Manage your crayfish
            listings in one place.
          </h2>

          <p>
            Check available listings,
            sold items, buyer requests,
            and your recent marketplace
            activity.
          </p>

          <div className="modern-market-actions">

            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                loadMarketplace
              }
            >
              <RefreshCw
                size={18}
              />

              Refresh
            </button>

            <Link
              to="/admin/orders"
              className="modern-market-orders-link"
            >
              <PackageCheck
                size={18}
              />

              View Orders

              <ArrowRight
                size={16}
              />
            </Link>

            <span>
              {lastUpdated
                ? `Updated ${formatShortTime(
                    lastUpdated
                  )}`
                : "Waiting for latest data"}
            </span>
          </div>
        </div>

        <div className="modern-market-hero-card">

          <ShoppingBag
            size={34}
          />

          <strong>
            {
              summary.totalListings
            }
          </strong>

          <span>
            Total Listings
          </span>
        </div>
      </section>

      {/* ===============================================
          SUMMARY
      ================================================ */}

      <section className="modern-market-summary-grid">

        <SummaryCard
          icon={
            CheckCircle2
          }
          label="Available"
          value={
            summary.active
          }
          helper="Listings buyers can see"
          tone="success"
        />

        <SummaryCard
          icon={Package}
          label="Sold"
          value={
            summary.sold
          }
          helper="Completed listings"
        />

        <SummaryCard
          icon={
            PackageCheck
          }
          label="Pending Orders"
          value={
            summary.pendingOrders
          }
          helper="Buyer requests to review"
          tone={
            summary.pendingOrders >
            0
              ? "warning"
              : "default"
          }
        />

        <SummaryCard
          icon={DollarSign}
          label="Sales"
          value={formatPeso(
            summary.totalSales
          )}
          helper="Completed marketplace sales"
        />
      </section>

      {/* ===============================================
          CONTENT
      ================================================ */}

      <section className="modern-market-grid">

        {/* LISTINGS */}

        <article className="modern-market-panel">

          <div className="modern-market-panel-heading">

            <div>
              <p className="dashboard-eyebrow">
                My Listings
              </p>

              <h3>
                Crayfish for sale
              </h3>
            </div>

            <Tag size={22} />
          </div>

          {/* FILTERS */}

          <div className="modern-market-toolbar">

            <div className="modern-market-search">

              <Search
                size={18}
              />

              <input
                type="search"
                placeholder="Search listing name or type..."
                value={
                  searchTerm
                }
                onChange={(
                  event
                ) =>
                  setSearchTerm(
                    event
                      .target
                      .value
                  )
                }
              />
            </div>

            <label className="modern-market-filter">

              <Filter
                size={18}
              />

              <select
                value={
                  statusFilter
                }
                onChange={(
                  event
                ) =>
                  setStatusFilter(
                    event
                      .target
                      .value
                  )
                }
              >
                <option value="all">
                  All Status
                </option>

                <option value="active">
                  Available
                </option>

                <option value="reserved">
                  Reserved
                </option>

                <option value="pending">
                  Pending
                </option>

                <option value="sold">
                  Sold
                </option>

                <option value="hidden">
                  Hidden
                </option>

                <option value="inactive">
                  Inactive
                </option>

                <option value="archived">
                  Archived
                </option>
              </select>
            </label>

            <label className="modern-market-filter">

              <Package
                size={18}
              />

              <select
                value={
                  typeFilter
                }
                onChange={(
                  event
                ) =>
                  setTypeFilter(
                    event
                      .target
                      .value
                  )
                }
              >
                <option value="all">
                  All Types
                </option>

                {listingTypes.map(
                  (type) => (
                    <option
                      key={type}
                      value={type}
                    >
                      {formatFriendlyText(
                        type
                      )}
                    </option>
                  )
                )}
              </select>
            </label>
          </div>

          {/* EMPTY */}

          {filteredListings.length ===
          0 ? (
            <div className="modern-market-empty-small">

              <ShoppingBag
                size={30}
              />

              <strong>
                No listings found
              </strong>

              <span>
                Try changing your search
                or filter. Listings created
                from the mobile app will
                appear here.
              </span>
            </div>
          ) : (

            /* LISTING CARDS */

            <div className="modern-market-listing-grid">

              {filteredListings.map(
                (item) => {
                  const listing =
                    item.listing;

                  return (
                    <article
                      className="modern-market-listing-card"
                      key={
                        listing?.id ||
                        item.index
                      }
                    >

                      <div className="modern-market-image">

                        {item.image ? (
                          <img
                            src={
                              item.image
                            }
                            alt={
                              item.title
                            }
                          />
                        ) : (
                          <ImageIcon
                            size={28}
                          />
                        )}
                      </div>

                      <div className="modern-market-listing-body">

                        <div className="modern-market-listing-top">

                          <span className="modern-market-type">
                            {formatFriendlyText(
                              item.type
                            )}
                          </span>

                          <b
                            className={`modern-market-status ${item.status}`}
                          >
                            {getFriendlyListingStatus(
                              item.status
                            )}
                          </b>
                        </div>

                        <h4>
                          {item.title}
                        </h4>

                        <strong className="modern-market-price">
                          {formatPeso(
                            getListingPrice(
                              listing
                            )
                          )}
                        </strong>

                        <div className="modern-market-meta">

                          <span>
                            Stock:{" "}
                            <strong>
                              {getListingStock(
                                listing
                              )}
                            </strong>
                          </span>

                          <span>
                            Posted:{" "}
                            {formatDate(
                              listing?.created_at ||
                                listing?.updated_at
                            )}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          )}
        </article>

        {/* ORDERS */}

        <article className="modern-market-panel">

          <div className="modern-market-panel-heading">

            <div>
              <p className="dashboard-eyebrow">
                Recent Orders
              </p>

              <h3>
                Buyer activity
              </h3>
            </div>

            <PackageCheck
              size={22}
            />
          </div>

          {recentOrders.length ===
          0 ? (
            <div className="modern-market-empty-small">

              <ShoppingBag
                size={28}
              />

              <strong>
                No orders yet
              </strong>

              <span>
                Buyer reservations and
                orders will appear here.
              </span>
            </div>
          ) : (
            <>
              <div className="modern-market-order-list">

                {recentOrders.map(
                  (
                    order,
                    index
                  ) => {
                    const title =
                      getOrderTitle(
                        order,
                        index
                      );

                    const status =
                      getOrderStatus(
                        order
                      );

                    return (
                      <div
                        className="modern-market-order-row"
                        key={
                          order?.id ||
                          index
                        }
                      >
                        <div>
                          <strong>
                            {title}
                          </strong>

                          <span>
                            {formatDate(
                              order?.created_at ||
                                order?.updated_at
                            )}
                          </span>
                        </div>

                        <div>
                          <b>
                            {formatPeso(
                              getOrderTotal(
                                order
                              )
                            )}
                          </b>

                          <small
                            className={`modern-market-status ${status}`}
                          >
                            {getFriendlyOrderStatus(
                              status
                            )}
                          </small>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>

              <Link
                to="/admin/orders"
                className="modern-market-view-orders"
              >
                View All Orders

                <ArrowRight
                  size={17}
                />
              </Link>
            </>
          )}
        </article>
      </section>
    </div>
  );
}
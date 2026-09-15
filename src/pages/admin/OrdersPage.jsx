import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  ArrowLeft,
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

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

/* =========================================================
   TABLES
========================================================= */

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

const ORDERS_PER_PAGE = 10;

/* =========================================================
   GENERAL HELPERS
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
   ORDER HELPERS
========================================================= */

function getOrderTitle(
  row,
  index
) {
  return (
    row?.product_name ||
    row?.listing_title ||
    row?.item_name ||
    row?.title ||
    row?.crayfish_name ||
    `Marketplace Order ${index + 1}`
  );
}

function getOrderStatus(row) {
  const raw = lower(
    row?.status ||
      row?.order_status ||
      row?.payment_status ||
      row?.reservation_status
  );

  if (
    raw.includes("complete")
  ) {
    return "completed";
  }

  if (
    raw.includes("confirm")
  ) {
    return "confirmed";
  }

  if (
    raw.includes("paid")
  ) {
    return "paid";
  }

  if (
    raw.includes("ship") ||
    raw.includes("deliver")
  ) {
    return "delivering";
  }

  if (
    raw.includes("cancel") ||
    raw.includes("reject")
  ) {
    return "cancelled";
  }

  if (
    raw.includes("pending")
  ) {
    return "pending";
  }

  return raw || "pending";
}

function getFriendlyStatus(status) {
  switch (status) {
    case "pending":
      return "Pending";

    case "confirmed":
      return "Confirmed";

    case "paid":
      return "Paid";

    case "delivering":
      return "Delivering";

    case "completed":
      return "Completed";

    case "cancelled":
      return "Cancelled";

    default:
      return formatFriendlyText(
        status
      );
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
      "price",
    ],
    0
  );
}

function getOrderQuantity(row) {
  return getValue(
    row,
    [
      "quantity",
      "qty",
      "count",
      "order_quantity",
    ],
    "N/A"
  );
}

function getBuyerLabel(row) {
  return (
    row?.buyer_name ||
    row?.customer_name ||
    row?.buyer_username ||
    row?.customer_username ||
    row?.buyer_email ||
    row?.customer_email ||
    "Buyer"
  );
}

function getOrderNote(row) {
  return (
    row?.buyer_note ||
    row?.note ||
    row?.notes ||
    row?.message ||
    ""
  );
}

/* =========================================================
   UNIQUE
========================================================= */

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach(
    (row, index) => {
      const id =
        row?.id ||
        row?.uuid ||
        row?.order_id ||
        row?.reservation_id ||
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

/* =========================================================
   CURRENT USER
========================================================= */

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

/* =========================================================
   FETCH
========================================================= */

async function fetchRows(
  tableNames,
  userId,
  limit = 220
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
   SUMMARY CARD
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
      className={`cray-orders-summary-card ${tone}`}
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

export default function OrdersPage() {
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
    sortMode,
    setSortMode,
  ] = useState("newest");

  const [
    currentPage,
    setCurrentPage,
  ] = useState(1);

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

  const loadOrders =
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
          setOrders([]);
          return;
        }

        const result =
          await fetchRows(
            orderTables,
            currentUser.id
          );

        setOrders(
          result.rows
        );

        setLastUpdated(
          new Date()
        );
      } catch (error) {
        console.error(
          "Orders loading error:",
          error
        );
      } finally {
        setIsLoading(false);
      }
    };

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    statusFilter,
    sortMode,
  ]);

  /* =======================================================
     ENRICH
  ======================================================= */

  const enrichedOrders =
    useMemo(() => {
      return orders.map(
        (
          order,
          index
        ) => {
          const status =
            getOrderStatus(
              order
            );

          const title =
            getOrderTitle(
              order,
              index
            );

          const total =
            Number(
              getOrderTotal(
                order
              ) || 0
            );

          const date =
            order?.created_at ||
            order?.updated_at ||
            order?.date;

          return {
            order,
            index,
            status,
            title,
            total,
            date,
          };
        }
      );
    }, [orders]);

  /* =======================================================
     FILTER
  ======================================================= */

  const filteredOrders =
    useMemo(() => {
      const filtered =
        enrichedOrders.filter(
          (item) => {
            const search =
              searchTerm
                .trim()
                .toLowerCase();

            const buyer =
              getBuyerLabel(
                item.order
              );

            const note =
              getOrderNote(
                item.order
              );

            const matchesSearch =
              !search ||
              item.title
                .toLowerCase()
                .includes(
                  search
                ) ||
              item.status
                .toLowerCase()
                .includes(
                  search
                ) ||
              String(buyer)
                .toLowerCase()
                .includes(
                  search
                ) ||
              String(note)
                .toLowerCase()
                .includes(
                  search
                ) ||
              String(
                item.total
              ).includes(
                search
              );

            const matchesStatus =
              statusFilter ===
                "all" ||
              item.status ===
                statusFilter;

            return (
              matchesSearch &&
              matchesStatus
            );
          }
        );

      return filtered.sort(
        (a, b) => {
          if (
            sortMode ===
            "oldest"
          ) {
            return (
              new Date(
                a.date || 0
              ) -
              new Date(
                b.date || 0
              )
            );
          }

          if (
            sortMode ===
            "highest"
          ) {
            return (
              b.total -
              a.total
            );
          }

          if (
            sortMode ===
            "lowest"
          ) {
            return (
              a.total -
              b.total
            );
          }

          return (
            new Date(
              b.date || 0
            ) -
            new Date(
              a.date || 0
            )
          );
        }
      );
    }, [
      enrichedOrders,
      searchTerm,
      statusFilter,
      sortMode,
    ]);

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary =
    useMemo(() => {
      const successful =
        enrichedOrders.filter(
          (item) =>
            [
              "completed",
              "confirmed",
              "paid",
            ].includes(
              item.status
            )
        );

      const pending =
        enrichedOrders.filter(
          (item) =>
            item.status ===
            "pending"
        );

      const cancelled =
        enrichedOrders.filter(
          (item) =>
            item.status ===
            "cancelled"
        );

      const delivering =
        enrichedOrders.filter(
          (item) =>
            item.status ===
            "delivering"
        );

      const totalSales =
        successful.reduce(
          (sum, item) =>
            sum +
            item.total,
          0
        );

      return {
        total:
          enrichedOrders.length,

        successful:
          successful.length,

        pending:
          pending.length,

        cancelled:
          cancelled.length,

        delivering:
          delivering.length,

        totalSales,
      };
    }, [enrichedOrders]);

  /* =======================================================
     PAGINATION
  ======================================================= */

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        filteredOrders.length /
          ORDERS_PER_PAGE
      )
    );

  const safeCurrentPage =
    Math.min(
      currentPage,
      totalPages
    );

  const paginatedOrders =
    filteredOrders.slice(
      (safeCurrentPage -
        1) *
        ORDERS_PER_PAGE,

      safeCurrentPage *
        ORDERS_PER_PAGE
    );

  const showingStart =
    filteredOrders.length ===
    0
      ? 0
      : (safeCurrentPage -
          1) *
          ORDERS_PER_PAGE +
        1;

  const showingEnd =
    Math.min(
      safeCurrentPage *
        ORDERS_PER_PAGE,
      filteredOrders.length
    );

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="cray-orders-loading">

        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading orders...
        </h3>

        <p>
          Getting your latest
          marketplace transactions.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="cray-orders-page">

      {/* ===============================================
          HERO
      ================================================ */}

      <section className="cray-orders-hero">

        <div>

          <Link
            to="/admin/marketplace"
            className="cray-orders-back"
          >
            <ArrowLeft
              size={17}
            />

            Back to Marketplace
          </Link>

          <p className="dashboard-eyebrow">
            Orders
          </p>

          <h2>
            Keep track of buyer
            requests and sales.
          </h2>

          <p>
            Review pending orders,
            deliveries, completed
            transactions, and
            cancellations without
            unnecessary technical details.
          </p>

          <div className="cray-orders-actions">

            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                loadOrders
              }
            >
              <RefreshCw
                size={18}
              />

              Refresh
            </button>

            <span>
              {lastUpdated
                ? `Updated ${formatShortTime(
                    lastUpdated
                  )}`
                : "Waiting for latest data"}
            </span>
          </div>
        </div>

        <div className="cray-orders-hero-card">

          <PackageCheck
            size={34}
          />

          <strong>
            {summary.total}
          </strong>

          <span>
            Total Orders
          </span>
        </div>
      </section>

      {/* ===============================================
          SUMMARY
      ================================================ */}

      <section className="cray-orders-summary-grid">

        <SummaryCard
          icon={Clock3}
          label="Needs Action"
          value={
            summary.pending
          }
          helper="Pending buyer requests"
          tone={
            summary.pending >
            0
              ? "warning"
              : "default"
          }
        />

        <SummaryCard
          icon={Truck}
          label="Delivering"
          value={
            summary.delivering
          }
          helper="Orders on the way"
        />

        <SummaryCard
          icon={
            CheckCircle2
          }
          label="Successful"
          value={
            summary.successful
          }
          helper="Confirmed, paid, or completed"
          tone="success"
        />

        <SummaryCard
          icon={DollarSign}
          label="Sales"
          value={formatPeso(
            summary.totalSales
          )}
          helper="Value from successful orders"
        />
      </section>

      {/* ===============================================
          FILTERS
      ================================================ */}

      <section className="cray-orders-toolbar">

        <div className="cray-orders-search">

          <Search size={18} />

          <input
            type="search"
            placeholder="Search order or buyer..."
            value={
              searchTerm
            }
            onChange={(
              event
            ) =>
              setSearchTerm(
                event.target.value
              )
            }
          />
        </div>

        <label className="cray-orders-filter">

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
                event.target.value
              )
            }
          >
            <option value="all">
              All Status
            </option>

            <option value="pending">
              Pending
            </option>

            <option value="confirmed">
              Confirmed
            </option>

            <option value="paid">
              Paid
            </option>

            <option value="delivering">
              Delivering
            </option>

            <option value="completed">
              Completed
            </option>

            <option value="cancelled">
              Cancelled
            </option>
          </select>
        </label>

        <label className="cray-orders-filter">

          <ShoppingBag
            size={18}
          />

          <select
            value={
              sortMode
            }
            onChange={(
              event
            ) =>
              setSortMode(
                event.target.value
              )
            }
          >
            <option value="newest">
              Newest First
            </option>

            <option value="oldest">
              Oldest First
            </option>

            <option value="highest">
              Highest Amount
            </option>

            <option value="lowest">
              Lowest Amount
            </option>
          </select>
        </label>
      </section>

      {/* ===============================================
          EMPTY
      ================================================ */}

      {filteredOrders.length ===
      0 ? (
        <section className="cray-orders-empty">

          <PackageCheck
            size={34}
          />

          <h3>
            No orders found
          </h3>

          <p>
            Try changing your search
            or filters. New marketplace
            orders will appear here.
          </p>
        </section>
      ) : (

        /* =============================================
            TABLE
        ============================================== */

        <section className="cray-orders-table-card">

          <div className="cray-orders-table-title">

            <div>
              <span>
                Order History
              </span>

              <h3>
                Marketplace transactions
              </h3>
            </div>

            <small>
              {
                filteredOrders.length
              }{" "}
              result
              {filteredOrders.length !==
              1
                ? "s"
                : ""}
            </small>
          </div>

          <div className="cray-orders-table-head">

            <span>
              Order
            </span>

            <span>
              Buyer
            </span>

            <span>
              Quantity
            </span>

            <span>
              Total
            </span>

            <span>
              Status
            </span>

            <span>
              Date
            </span>
          </div>

          <div className="cray-orders-table-body">

            {paginatedOrders.map(
              (item) => {
                const order =
                  item.order;

                const buyer =
                  getBuyerLabel(
                    order
                  );

                const quantity =
                  getOrderQuantity(
                    order
                  );

                const note =
                  getOrderNote(
                    order
                  );

                return (
                  <div
                    className="cray-orders-table-row"
                    key={
                      order?.id ||
                      order?.order_id ||
                      item.index
                    }
                  >

                    <span data-label="Order">

                      <strong>
                        {item.title}
                      </strong>

                      {note && (
                        <small>
                          {note}
                        </small>
                      )}
                    </span>

                    <span data-label="Buyer">
                      {buyer}
                    </span>

                    <span data-label="Quantity">
                      {quantity}
                    </span>

                    <span data-label="Total">

                      <strong>
                        {formatPeso(
                          item.total
                        )}
                      </strong>
                    </span>

                    <span data-label="Status">

                      <b
                        className={`cray-order-status ${item.status}`}
                      >
                        {getFriendlyStatus(
                          item.status
                        )}
                      </b>
                    </span>

                    <span data-label="Date">
                      {formatDate(
                        item.date
                      )}
                    </span>
                  </div>
                );
              }
            )}
          </div>

          {/* PAGINATION */}

          <div className="cray-orders-pagination">

            <span>
              Showing{" "}
              {showingStart}-
              {showingEnd} of{" "}
              {
                filteredOrders.length
              }
            </span>

            <div>

              <button
                type="button"
                disabled={
                  safeCurrentPage ===
                  1
                }
                onClick={() =>
                  setCurrentPage(
                    (page) =>
                      Math.max(
                        1,
                        page - 1
                      )
                  )
                }
              >
                Previous
              </button>

              <strong>
                Page{" "}
                {
                  safeCurrentPage
                }{" "}
                of{" "}
                {totalPages}
              </strong>

              <button
                type="button"
                disabled={
                  safeCurrentPage ===
                  totalPages
                }
                onClick={() =>
                  setCurrentPage(
                    (page) =>
                      Math.min(
                        totalPages,
                        page + 1
                      )
                  )
                }
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}

      {/* CANCELLED NOTE */}

      {summary.cancelled > 0 && (
        <div className="cray-orders-cancelled-note">

          <XCircle
            size={17}
          />

          <span>
            {summary.cancelled} cancelled{" "}
            {summary.cancelled === 1
              ? "order is"
              : "orders are"}{" "}
            included in your transaction history.
          </span>
        </div>
      )}
    </div>
  );
}
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
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

const orderStatusOptions = [
  {
    value: "all",
    label: "All Status",
  },
  {
    value: "pending",
    label: "Pending",
  },
  {
    value: "confirmed",
    label: "Confirmed",
  },
  {
    value: "paid",
    label: "Paid",
  },
  {
    value: "delivering",
    label: "Delivering",
  },
  {
    value: "completed",
    label: "Completed",
  },
  {
    value: "cancelled",
    label: "Cancelled",
  },
];

const orderSortOptions = [
  {
    value: "newest",
    label: "Newest First",
  },
  {
    value: "oldest",
    label: "Oldest First",
  },
  {
    value: "highest",
    label: "Highest Amount",
  },
  {
    value: "lowest",
    label: "Lowest Amount",
  },
];

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
   MINIMAL THEME-AWARE DROPDOWN
========================================================= */

function OrderFilterDropdown({
  icon: Icon,
  value,
  options,
  onChange,
  ariaLabel,
}) {
  const [
    isOpen,
    setIsOpen,
  ] =
    useState(false);

  const dropdownRef =
    useRef(null);

  const selectedOption =
    options.find(
      (option) =>
        option.value === value
    ) || options[0];

  useEffect(() => {
    function handleOutsideClick(
      event
    ) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(
          event.target
        )
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(
      event
    ) {
      if (
        event.key === "Escape"
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleOutsideClick
    );

    document.addEventListener(
      "keydown",
      handleEscape
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleOutsideClick
      );

      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, []);

  function handleSelect(option) {
    onChange(
      option.value
    );

    setIsOpen(false);
  }

  return (
    <div
      ref={dropdownRef}
      style={orderDropdownWrapStyle}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() =>
          setIsOpen(
            (current) =>
              !current
          )
        }
        style={{
          ...orderDropdownTriggerStyle,

          ...(isOpen
            ? orderDropdownTriggerOpenStyle
            : {}),
        }}
      >
        <Icon
          size={17}
          style={orderDropdownIconStyle}
        />

        <span
          style={orderDropdownSelectedTextStyle}
        >
          {selectedOption?.label}
        </span>

        <ChevronDown
          size={16}
          style={{
            ...orderDropdownChevronStyle,

            transform:
              isOpen
                ? "rotate(180deg)"
                : "rotate(0deg)",
          }}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          style={orderDropdownMenuStyle}
        >
          {options.map(
            (option) => {
              const isSelected =
                option.value ===
                value;

              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={
                    isSelected
                  }
                  key={
                    option.value
                  }
                  onClick={() =>
                    handleSelect(
                      option
                    )
                  }
                  style={{
                    ...orderDropdownItemStyle,

                    ...(isSelected
                      ? orderDropdownItemActiveStyle
                      : {}),
                  }}
                >
                  <span>
                    {
                      option.label
                    }
                  </span>

                  {isSelected && (
                    <Check
                      size={15}
                      style={{
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function OrdersPage() {
  const [
    orders,
    setOrders,
  ] =
    useState([]);

  const [
    searchTerm,
    setSearchTerm,
  ] =
    useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState("all");

  const [
    sortMode,
    setSortMode,
  ] =
    useState("newest");

  const [
    currentPage,
    setCurrentPage,
  ] =
    useState(1);

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  const [
    lastUpdated,
    setLastUpdated,
  ] =
    useState(null);

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
    }, [
      enrichedOrders,
    ]);

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
      (
        safeCurrentPage -
        1
      ) *
        ORDERS_PER_PAGE,

      safeCurrentPage *
        ORDERS_PER_PAGE
    );

  const showingStart =
    filteredOrders.length ===
      0
      ? 0
      : (
          safeCurrentPage -
          1
        ) *
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
          Getting your latest marketplace transactions.
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
            Keep track of buyer requests and sales.
          </h2>

          <p>
            Review pending orders, deliveries, completed
            transactions, and cancellations without
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
            summary.pending > 0
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

      <section
        className="cray-orders-toolbar"
        style={
          orderToolbarStyle
        }
      >
        <div
          className="cray-orders-search"
          style={
            orderSearchStyle
          }
        >
          <Search
            size={18}
            style={
              orderSearchIconStyle
            }
          />

          <input
            type="search"
            placeholder="Search order or buyer..."
            value={
              searchTerm
            }
            onChange={(event) =>
              setSearchTerm(
                event.target.value
              )
            }
            style={
              orderSearchInputStyle
            }
          />
        </div>

        <OrderFilterDropdown
          ariaLabel="Filter orders by status"
          icon={Filter}
          value={
            statusFilter
          }
          options={
            orderStatusOptions
          }
          onChange={
            setStatusFilter
          }
        />

        <OrderFilterDropdown
          ariaLabel="Sort marketplace orders"
          icon={ShoppingBag}
          value={
            sortMode
          }
          options={
            orderSortOptions
          }
          onChange={
            setSortMode
          }
        />
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
            Try changing your search or filters.
            New marketplace orders will appear here.
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
                        {
                          item.title
                        }
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
                      {
                        quantity
                      }
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
                {
                  totalPages
                }
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

/* =========================================================
   MINIMAL THEME-AWARE ORDER FILTER UI
========================================================= */

const orderToolbarStyle = {
  display: "grid",

  gridTemplateColumns:
    "minmax(260px, 1fr) minmax(170px, 200px) minmax(170px, 200px)",

  alignItems:
    "center",

  gap:
    "10px",

  overflow:
    "visible",

  position:
    "relative",

  zIndex:
    12,
};

const orderSearchStyle = {
  height:
    "48px",

  minHeight:
    "48px",

  display:
    "flex",

  alignItems:
    "center",

  gap:
    "9px",

  padding:
    "0 14px",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  borderRadius:
    "12px",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",

  boxShadow:
    "var(--ct-shadow-soft, 0 4px 14px rgba(15, 23, 42, 0.04))",
};

const orderSearchIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",
};

const orderSearchInputStyle = {
  width:
    "100%",

  minWidth:
    0,

  padding:
    0,

  border:
    "none",

  outline:
    "none",

  background:
    "transparent",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  font:
    "inherit",

  fontSize:
    "0.82rem",
};

const orderDropdownWrapStyle = {
  position:
    "relative",

  minWidth:
    0,
};

const orderDropdownTriggerStyle = {
  width:
    "100%",

  height:
    "48px",

  display:
    "flex",

  alignItems:
    "center",

  gap:
    "8px",

  padding:
    "0 13px",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  borderRadius:
    "12px",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  boxShadow:
    "var(--ct-shadow-soft, 0 4px 14px rgba(15, 23, 42, 0.04))",

  font:
    "inherit",

  fontSize:
    "0.8rem",

  fontWeight:
    600,

  cursor:
    "pointer",

  textAlign:
    "left",

  transition:
    "background 150ms ease, border-color 150ms ease, box-shadow 150ms ease",
};

const orderDropdownTriggerOpenStyle = {
  borderColor:
    "var(--ct-brand, #00b8a9)",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  boxShadow:
    "0 0 0 3px rgba(0, 217, 199, 0.08)",
};

const orderDropdownIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-brand, #00b8a9)",
};

const orderDropdownSelectedTextStyle = {
  minWidth:
    0,

  overflow:
    "hidden",

  textOverflow:
    "ellipsis",

  whiteSpace:
    "nowrap",
};

const orderDropdownChevronStyle = {
  marginLeft:
    "auto",

  flexShrink:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",

  opacity:
    0.8,

  transition:
    "transform 160ms ease",
};

const orderDropdownMenuStyle = {
  position:
    "absolute",

  top:
    "calc(100% + 6px)",

  left:
    0,

  right:
    0,

  zIndex:
    120,

  padding:
    "5px",

  maxHeight:
    "260px",

  overflowY:
    "auto",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  borderRadius:
    "12px",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  boxShadow:
    "0 14px 32px rgba(15, 23, 42, 0.14)",

  backdropFilter:
    "blur(18px)",
};

const orderDropdownItemStyle = {
  width:
    "100%",

  minHeight:
    "38px",

  display:
    "flex",

  alignItems:
    "center",

  justifyContent:
    "space-between",

  gap:
    "10px",

  padding:
    "0 10px",

  border:
    "none",

  borderRadius:
    "8px",

  background:
    "transparent",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  font:
    "inherit",

  fontSize:
    "0.78rem",

  fontWeight:
    500,

  cursor:
    "pointer",

  textAlign:
    "left",
};

const orderDropdownItemActiveStyle = {
  background:
    "var(--ct-brand-soft, var(--accent-bg, rgba(0, 217, 199, 0.10)))",

  color:
    "var(--ct-brand, var(--accent, #008f83))",

  fontWeight:
    700,
};
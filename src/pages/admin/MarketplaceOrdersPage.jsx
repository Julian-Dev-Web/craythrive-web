import { logDiagnostic } from "../../utils/securityDiagnostics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  UserRound,
  Wallet,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

/* =========================================================
   TABLES
========================================================= */

const orderTableNames = [
  "marketplace_orders",
  "orders",
  "reservations",
  "marketplace_reservations",
];

const listingTableNames = [
  "marketplace_listings",
  "listings",
  "products",
];

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

const ORDERS_PER_PAGE = 10;

const orderStatusFilterOptions = [
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
    value: "completed",
    label: "Completed",
  },
  {
    value: "paid",
    label: "Paid",
  },
  {
    value: "cancelled",
    label: "Cancelled",
  },
];

const orderRoleFilterOptions = [
  {
    value: "all",
    label: "All Transactions",
  },
  {
    value: "buyer",
    label: "Buying",
  },
  {
    value: "seller",
    label: "Selling",
  },
  {
    value: "linked",
    label: "Related",
  },
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

function formatPrice(value) {
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

/* =========================================================
   ORDER HELPERS
========================================================= */

function getOrderId(
  order,
  index
) {
  return (
    order?.id ||
    order?.order_id ||
    order?.reservation_id ||
    `order-${index}`
  );
}

function getListingId(order) {
  return (
    order?.listing_id ||
    order?.product_id ||
    order?.marketplace_listing_id ||
    ""
  );
}

function getOrderStatus(order) {
  const raw = lower(
    order?.status ||
      order?.order_status ||
      order?.payment_status ||
      order?.reservation_status ||
      "pending"
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

function getFriendlyStatus(status) {
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

function getOrderQuantity(order) {
  return (
    order?.quantity ||
    order?.qty ||
    order?.count ||
    1
  );
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
    ""
  );
}

/* =========================================================
   FRIENDLY PEOPLE LABELS
========================================================= */

function getBuyerLabel(order) {
  return (
    order?.buyer_name ||
    order?.buyer_username ||
    order?.buyer_full_name ||
    order?.buyer_email ||
    "Buyer"
  );
}

function getSellerLabel(order) {
  return (
    order?.seller_name ||
    order?.seller_username ||
    order?.seller_full_name ||
    order?.seller_email ||
    "Seller"
  );
}

/* =========================================================
   LISTING TITLE
========================================================= */

function getListingTitle(
  order,
  listingMap
) {
  const listingId =
    getListingId(order);

  return (
    order?.listing_title ||
    order?.title ||
    order?.product_name ||
    order?.listing_name ||
    listingMap[
      listingId
    ]?.title ||
    "Marketplace Order"
  );
}

function getListingTitleFromListing(
  listing
) {
  return (
    listing?.title ||
    listing?.name ||
    listing?.product_name ||
    listing?.listing_title ||
    "Untitled Listing"
  );
}

/* =========================================================
   ROLE
========================================================= */

function getOrderRole(
  order,
  userId
) {
  if (
    String(
      order?.buyer_id ||
        ""
    ) ===
    String(userId)
  ) {
    return "buyer";
  }

  if (
    String(
      order?.seller_id ||
        ""
    ) ===
    String(userId)
  ) {
    return "seller";
  }

  return "linked";
}

function getFriendlyRole(role) {
  switch (role) {
    case "buyer":
      return "Buying";

    case "seller":
      return "Selling";

    default:
      return "Related";
  }
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
   UNIQUE
========================================================= */

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach(
    (row, index) => {
      const id =
        row?.id ||
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
   FETCH ORDERS
========================================================= */

async function fetchUserOrders(
  userId,
  limit = 300
) {
  for (
    const tableName
    of orderTableNames
  ) {
    let successfulColumn = "";
    const mergedRows = [];

    for (
      const userColumn
      of orderUserColumns
    ) {
      const ordered =
        await supabase
          .from(tableName)
          .select("*")
          .eq(
            userColumn,
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
        successfulColumn =
          userColumn;

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
            userColumn,
            userId
          )
          .limit(limit);

      if (
        !plain.error &&
        Array.isArray(
          plain.data
        )
      ) {
        successfulColumn =
          userColumn;

        mergedRows.push(
          ...plain.data
        );
      }
    }

    if (successfulColumn) {
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
      orderTableNames[0],
  };
}

/* =========================================================
   FETCH LISTINGS
========================================================= */

async function fetchUserListings(
  userId,
  limit = 250
) {
  for (
    const tableName
    of listingTableNames
  ) {
    for (
      const userColumn
      of listingUserColumns
    ) {
      const {
        data,
        error,
      } =
        await supabase
          .from(tableName)
          .select("*")
          .eq(
            userColumn,
            userId
          )
          .limit(limit);

      if (
        !error &&
        Array.isArray(data)
      ) {
        return data;
      }
    }
  }

  return [];
}

/* =========================================================
   SUMMARY CARD
========================================================= */

function OrderSummaryCard({
  icon: Icon,
  label,
  value,
  helper,
  tone = "default",
}) {
  return (
    <article
      className={`modern-orders-summary-card ${tone}`}
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

function MarketplaceOrderFilterDropdown({
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
    ) ||
    options[0];

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

    function handleEscape(event) {
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
      ref={
        dropdownRef
      }
      style={
        marketOrderDropdownWrapStyle
      }
    >
      <button
        type="button"
        aria-label={
          ariaLabel
        }
        aria-haspopup="listbox"
        aria-expanded={
          isOpen
        }
        onClick={() =>
          setIsOpen(
            (current) =>
              !current
          )
        }
        style={{
          ...marketOrderDropdownTriggerStyle,

          ...(isOpen
            ? marketOrderDropdownTriggerOpenStyle
            : {}),
        }}
      >
        <Icon
          size={17}
          style={
            marketOrderDropdownIconStyle
          }
        />

        <span
          style={
            marketOrderDropdownSelectedTextStyle
          }
        >
          {
            selectedOption?.label
          }
        </span>

        <ChevronDown
          size={16}
          style={{
            ...marketOrderDropdownChevronStyle,

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
          style={
            marketOrderDropdownMenuStyle
          }
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
                    ...marketOrderDropdownItemStyle,

                    ...(isSelected
                      ? marketOrderDropdownItemActiveStyle
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
                        flexShrink:
                          0,
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

export default function MarketplaceOrdersPage() {
  const [
    orders,
    setOrders,
  ] =
    useState([]);

  const [
    listingMap,
    setListingMap,
  ] =
    useState({});

  const [
    authUserId,
    setAuthUserId,
  ] =
    useState("");

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
    roleFilter,
    setRoleFilter,
  ] =
    useState("all");

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
          setListingMap({});
          return;
        }

        const [
          orderResult,
          listings,
        ] =
          await Promise.all([
            fetchUserOrders(
              currentUser.id
            ),

            fetchUserListings(
              currentUser.id
            ),
          ]);

        const nextListingMap =
          {};

        listings.forEach(
          (listing) => {
            const id =
              listing?.id ||
              listing?.listing_id ||
              listing?.product_id ||
              listing?.uuid;

            if (id) {
              nextListingMap[
                String(id)
              ] = {
                title:
                  getListingTitleFromListing(
                    listing
                  ),
              };
            }
          }
        );

        const sortedOrders =
          [
            ...orderResult.rows,
          ].sort(
            (a, b) => {
              const aDate =
                new Date(
                  a.created_at ||
                    a.updated_at ||
                    0
                ).getTime();

              const bDate =
                new Date(
                  b.created_at ||
                    b.updated_at ||
                    0
                ).getTime();

              return (
                bDate -
                aDate
              );
            }
          );

        setAuthUserId(
          currentUser.id
        );

        setOrders(
          sortedOrders
        );

        setListingMap(
          nextListingMap
        );

        setLastUpdated(
          new Date()
        );
      } catch (error) {
        logDiagnostic(
          "Marketplace orders loading error:",
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
    roleFilter,
  ]);

  /* =======================================================
     FILTER
  ======================================================= */

  const filteredOrders =
    useMemo(() => {
      return orders.filter(
        (order) => {
          const search =
            lower(
              searchTerm
            );

          const status =
            getOrderStatus(
              order
            );

          const role =
            getOrderRole(
              order,
              authUserId
            );

          const title =
            lower(
              getListingTitle(
                order,
                listingMap
              )
            );

          const buyer =
            lower(
              getBuyerLabel(
                order
              )
            );

          const seller =
            lower(
              getSellerLabel(
                order
              )
            );

          const note =
            lower(
              getOrderNote(
                order
              )
            );

          const matchesSearch =
            !search ||
            title.includes(
              search
            ) ||
            buyer.includes(
              search
            ) ||
            seller.includes(
              search
            ) ||
            note.includes(
              search
            ) ||
            status.includes(
              search
            );

          const matchesStatus =
            statusFilter ===
              "all" ||
            status ===
              lower(
                statusFilter
              );

          const matchesRole =
            roleFilter ===
              "all" ||
            role ===
              roleFilter;

          return (
            matchesSearch &&
            matchesStatus &&
            matchesRole
          );
        }
      );
    }, [
      orders,
      listingMap,
      authUserId,
      searchTerm,
      statusFilter,
      roleFilter,
    ]);

  /* =======================================================
     STATS
  ======================================================= */

  const stats =
    useMemo(() => {
      return orders.reduce(
        (
          accumulator,
          order
        ) => {
          const status =
            getOrderStatus(
              order
            );

          accumulator.total +=
            1;

          accumulator[
            status
          ] =
            (accumulator[
              status
            ] || 0) + 1;

          return accumulator;
        },
        {
          total: 0,
          pending: 0,
          confirmed: 0,
          cancelled: 0,
          completed: 0,
          paid: 0,
        }
      );
    }, [orders]);

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
     UI
  ======================================================= */

  return (
    <div className="modern-orders-page">
      {/* ===============================================
          HERO
      ================================================ */}

      <section className="modern-orders-hero">
        <div>
          <Link
            to="/admin/marketplace"
            className="modern-orders-back"
          >
            <ArrowLeft
              size={17}
            />

            Back to Marketplace
          </Link>

          <p className="dashboard-eyebrow">
            Orders & Reservations
          </p>

          <h2>
            Keep track of your
            marketplace transactions.
          </h2>

          <p>
            Review pending buyer
            requests, confirmed orders,
            completed transactions,
            and cancelled reservations.
          </p>

          <div className="modern-orders-actions">
            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                loadOrders
              }
              disabled={
                isLoading
              }
            >
              {isLoading ? (
                <Loader2
                  className="spin-icon"
                  size={18}
                />
              ) : (
                <RefreshCw
                  size={18}
                />
              )}

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

        <div className="modern-orders-hero-card">
          <PackageCheck
            size={34}
          />

          <strong>
            {
              stats.total
            }
          </strong>

          <span>
            Total Transactions
          </span>
        </div>
      </section>

      {/* ===============================================
          SUMMARY
      ================================================ */}

      <section className="modern-orders-summary-grid">
        <OrderSummaryCard
          icon={
            Clock3
          }
          label="Pending"
          value={
            stats.pending ||
            0
          }
          helper="Waiting for action"
          tone="warning"
        />

        <OrderSummaryCard
          icon={
            CheckCircle2
          }
          label="Confirmed"
          value={
            stats.confirmed ||
            0
          }
          helper="Approved transactions"
          tone="success"
        />

        <OrderSummaryCard
          icon={
            Wallet
          }
          label="Completed"
          value={
            (stats.completed ||
              0) +
            (stats.paid ||
              0)
          }
          helper="Finished transactions"
        />

        <OrderSummaryCard
          icon={
            AlertTriangle
          }
          label="Cancelled"
          value={
            stats.cancelled ||
            0
          }
          helper="Cancelled requests"
          tone="danger"
        />
      </section>

      {/* ===============================================
          FILTER
      ================================================ */}

      <section
        className="modern-orders-toolbar"
        style={
          marketOrderToolbarStyle
        }
      >
        <div
          className="modern-orders-search"
          style={
            marketOrderSearchStyle
          }
        >
          <Search
            size={18}
            style={
              marketOrderSearchIconStyle
            }
          />

          <input
            type="search"
            value={
              searchTerm
            }
            onChange={(event) =>
              setSearchTerm(
                event.target.value
              )
            }
            placeholder="Search listing or customer..."
            style={
              marketOrderSearchInputStyle
            }
          />
        </div>

        <MarketplaceOrderFilterDropdown
          ariaLabel="Filter marketplace orders by status"
          icon={
            Filter
          }
          value={
            statusFilter
          }
          options={
            orderStatusFilterOptions
          }
          onChange={
            setStatusFilter
          }
        />

        <MarketplaceOrderFilterDropdown
          ariaLabel="Filter marketplace orders by transaction type"
          icon={
            UserRound
          }
          value={
            roleFilter
          }
          options={
            orderRoleFilterOptions
          }
          onChange={
            setRoleFilter
          }
        />
      </section>

      {/* ===============================================
          LOADING / EMPTY
      ================================================ */}

      {isLoading ? (
        <section className="modern-orders-empty">
          <Loader2
            className="spin-icon"
            size={30}
          />

          <h3>
            Loading orders...
          </h3>

          <p>
            Getting your latest
            marketplace transactions.
          </p>
        </section>
      ) : filteredOrders.length ===
        0 ? (
        <section className="modern-orders-empty">
          <ShoppingBag
            size={34}
          />

          <h3>
            No orders found
          </h3>

          <p>
            Try changing your search
            or filters. New buyer
            reservations will appear
            here.
          </p>
        </section>
      ) : (
        /* =============================================
            ORDERS TABLE
        ============================================== */

        <section className="modern-orders-table-card">
          <div className="modern-orders-table-title">
            <div>
              <span>
                Transaction History
              </span>

              <h3>
                Marketplace orders
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

          <div className="modern-orders-table-head">
            <span>
              Listing
            </span>

            <span>
              Type
            </span>

            <span>
              Buyer
            </span>

            <span>
              Seller
            </span>

            <span>
              Qty
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

          <div className="modern-orders-table-body">
            {paginatedOrders.map(
              (
                order,
                index
              ) => {
                const status =
                  getOrderStatus(
                    order
                  );

                const role =
                  getOrderRole(
                    order,
                    authUserId
                  );

                const note =
                  getOrderNote(
                    order
                  );

                return (
                  <div
                    className="modern-orders-table-row"
                    key={
                      getOrderId(
                        order,
                        index
                      )
                    }
                  >
                    <span data-label="Listing">
                      <strong>
                        {getListingTitle(
                          order,
                          listingMap
                        )}
                      </strong>

                      {note && (
                        <small>
                          {
                            note
                          }
                        </small>
                      )}
                    </span>

                    <span data-label="Type">
                      <b
                        className={`modern-order-role ${role}`}
                      >
                        {getFriendlyRole(
                          role
                        )}
                      </b>
                    </span>

                    <span data-label="Buyer">
                      {getBuyerLabel(
                        order
                      )}
                    </span>

                    <span data-label="Seller">
                      {getSellerLabel(
                        order
                      )}
                    </span>

                    <span data-label="Quantity">
                      {getOrderQuantity(
                        order
                      )}
                    </span>

                    <span data-label="Total">
                      <strong>
                        {formatPrice(
                          getOrderTotal(
                            order
                          )
                        )}
                      </strong>
                    </span>

                    <span data-label="Status">
                      <b
                        className={`modern-order-status ${status}`}
                      >
                        {getFriendlyStatus(
                          status
                        )}
                      </b>
                    </span>

                    <span data-label="Date">
                      {formatDate(
                        order.created_at ||
                          order.updated_at
                      )}
                    </span>
                  </div>
                );
              }
            )}
          </div>

          {/* PAGINATION */}

          <div className="modern-orders-pagination">
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
    </div>
  );
}

/* =========================================================
   MINIMAL THEME-AWARE MARKETPLACE ORDER FILTER UI
========================================================= */

const marketOrderToolbarStyle = {
  display:
    "flex",

  alignItems:
    "center",

  flexWrap:
    "wrap",

  gap:
    "10px",

  overflow:
    "visible",

  position:
    "relative",

  zIndex:
    12,
};

const marketOrderSearchStyle = {
  flex:
    "1 1 280px",

  minWidth:
    "220px",

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
};

const marketOrderSearchIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",
};

const marketOrderSearchInputStyle = {
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

const marketOrderDropdownWrapStyle = {
  position:
    "relative",

  flex:
    "0 1 190px",

  minWidth:
    "165px",
};

const marketOrderDropdownTriggerStyle = {
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

const marketOrderDropdownTriggerOpenStyle = {
  borderColor:
    "var(--ct-brand, #00b8a9)",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  boxShadow:
    "0 0 0 3px rgba(0, 217, 199, 0.08)",
};

const marketOrderDropdownIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-brand, #00b8a9)",
};

const marketOrderDropdownSelectedTextStyle = {
  minWidth:
    0,

  overflow:
    "hidden",

  textOverflow:
    "ellipsis",

  whiteSpace:
    "nowrap",
};

const marketOrderDropdownChevronStyle = {
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

const marketOrderDropdownMenuStyle = {
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

const marketOrderDropdownItemStyle = {
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

const marketOrderDropdownItemActiveStyle = {
  background:
    "var(--ct-brand-soft, var(--accent-bg, rgba(0, 217, 199, 0.10)))",

  color:
    "var(--ct-brand, var(--accent, #008f83))",

  fontWeight:
    700,
};
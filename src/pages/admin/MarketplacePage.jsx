import { getServerNowDate } from '../../services/serverTimeService';
import { formatPhilippineDate, formatPhilippineTime } from '../../utils/philippineTime';
import { logDiagnostic, getSafeErrorMessage } from "../../utils/securityDiagnostics";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  Link,
} from "react-router-dom";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import "../../styles/marketplace.css";

/* =========================================================
   CONFIG
========================================================= */

const CATEGORY_OPTIONS = [
  {
    value: "all",
    label: "All",
  },
  {
    value: "crayfish",
    label: "Crayfish",
  },
  {
    value: "feeds",
    label: "Feeds",
  },
  {
    value: "tanks_enclosures",
    label: "Tanks & Enclosures",
  },
  {
    value: "water_care",
    label: "Water Care",
  },
  {
    value: "test_kits",
    label: "Test Kits",
  },
  {
    value: "equipment",
    label: "Equipment",
  },
  {
    value: "accessories",
    label: "Accessories",
  },
  {
    value: "others",
    label: "Others",
  },
];

const STATUS_OPTIONS = [
  {
    value: "all",
    label: "All Status",
  },
  {
    value: "active",
    label: "Active",
  },
  {
    value: "reserved",
    label: "Reserved",
  },
  {
    value: "hidden",
    label: "Hidden",
  },
  {
    value: "sold",
    label: "Sold",
  },
  {
    value: "inactive",
    label: "Inactive",
  },
];

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function lower(value) {
  return clean(
    value
  ).toLowerCase();
}

function formatFriendlyText(
  value
) {
  const text =
    clean(value);

  if (!text) {
    return "N/A";
  }

  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase()
    );
}

function formatPeso(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return "₱0";
  }

  return new Intl.NumberFormat(
    "en-PH",
    {
      style: "currency",
      currency: "PHP",
      minimumFractionDigits:
        Number.isInteger(
          number
        )
          ? 0
          : 2,
    }
  ).format(number);
}

function formatDate(value) { return formatPhilippineDate(value); }

function formatShortTime(value) { return formatPhilippineTime(value); }

function getListingCategory(
  listing
) {
  /*
    Old listings existed before
    category was added.

    Treat old records as crayfish
    for backwards compatibility.
  */

  return (
    clean(
      listing?.category
    ) ||
    "crayfish"
  );
}

function getCategoryLabel(
  value
) {
  return (
    CATEGORY_OPTIONS.find(
      (item) =>
        item.value === value
    )?.label ||
    formatFriendlyText(
      value
    )
  );
}

function getListingSubtitle(
  listing
) {
  const category =
    getListingCategory(
      listing
    );

  if (
    category ===
    "crayfish"
  ) {
    return (
      clean(
        listing?.crayfish_type
      ) ||
      clean(
        listing?.subcategory
      ) ||
      "Crayfish"
    );
  }

  return (
    clean(
      listing?.subcategory
    ) ||
    getCategoryLabel(
      category
    )
  );
}

function getListingUnit(
  listing
) {
  const unit =
    clean(
      listing?.unit
    );

  if (unit) {
    return formatFriendlyText(
      unit
    );
  }

  return getListingCategory(
    listing
  ) === "crayfish"
    ? "Piece"
    : "Item";
}

function getSearchText(
  listing
) {
  return [
    listing?.title,
    listing?.category,
    listing?.subcategory,
    listing?.description,
    listing?.brand,
    listing?.sku,
    listing?.crayfish_type,
    listing?.stage,
    listing?.sex,
    listing?.size_label,
    listing?.location,
    listing
      ?.pickup_municipality,
    listing
      ?.pickup_barangay,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getStatusTone(
  status
) {
  const value =
    lower(status);

  if (
    value === "active"
  ) {
    return "success";
  }

  if (
    value ===
      "reserved" ||
    value === "pending"
  ) {
    return "warning";
  }

  if (
    value === "sold"
  ) {
    return "info";
  }

  if (
    value ===
      "hidden" ||
    value ===
      "inactive"
  ) {
    return "muted";
  }

  return "default";
}

/* =========================================================
   PAGE
========================================================= */

export default function MarketplacePage() {
  const [
    currentUser,
    setCurrentUser,
  ] = useState(null);

  const [
    sellerProfile,
    setSellerProfile,
  ] = useState(null);

  const [
    browseListings,
    setBrowseListings,
  ] = useState([]);

  const [
    myListings,
    setMyListings,
  ] = useState([]);

  const [
    orders,
    setOrders,
  ] = useState([]);

  const [
    activeTab,
    setActiveTab,
  ] = useState("browse");

  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState("all");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("all");

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    isRefreshing,
    setIsRefreshing,
  ] = useState(false);

  const [
    updatingListingId,
    setUpdatingListingId,
  ] = useState("");

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    messageType,
    setMessageType,
  ] = useState(
    "success"
  );

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    loadMarketplace(
      true
    );
  }, []);

  async function loadMarketplace(
    fullLoading = false
  ) {
    if (
      !isSupabaseConfigured ||
      !supabase
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "Supabase is not configured."
      );

      setIsLoading(
        false
      );

      return;
    }

    try {
      if (
        fullLoading
      ) {
        setIsLoading(
          true
        );
      } else {
        setIsRefreshing(
          true
        );
      }

      setMessage("");

      const {
        data: userData,
        error: userError,
      } =
        await supabase
          .auth
          .getUser();

      if (
        userError
      ) {
        throw userError;
      }

      const user =
        userData?.user;

      if (!user?.id) {
        throw new Error(
          "No logged in user found."
        );
      }

      setCurrentUser(
        user
      );

      const [
        activeResult,
        mineResult,
        sellerResult,
        orderResult,
      ] =
        await Promise.all([
          supabase
            .from(
              "marketplace_listings"
            )
            .select("*")
            .eq(
              "status",
              "active"
            )
            .order(
              "created_at",
              {
                ascending:
                  false,
              }
            ),

          supabase
            .from(
              "marketplace_listings"
            )
            .select("*")
            .eq(
              "seller_id",
              user.id
            )
            .neq(
              "status",
              "deleted"
            )
            .order(
              "created_at",
              {
                ascending:
                  false,
              }
            ),

          supabase
            .from(
              "seller_profiles"
            )
            .select("*")
            .eq(
              "user_id",
              user.id
            )
            .maybeSingle(),

          supabase
            .from(
              "marketplace_orders"
            )
            .select("*")
            .eq(
              "seller_id",
              user.id
            )
            .order(
              "created_at",
              {
                ascending:
                  false,
              }
            )
            .limit(20),
        ]);

      if (
        activeResult.error
      ) {
        throw activeResult.error;
      }

      if (
        mineResult.error
      ) {
        throw mineResult.error;
      }

      setBrowseListings(
        activeResult.data ||
          []
      );

      setMyListings(
        mineResult.data ||
          []
      );

      if (
        sellerResult.error
      ) {
        logDiagnostic(
          "Seller profile load:",
          sellerResult.error
        );

        setSellerProfile(
          null
        );
      } else {
        setSellerProfile(
          sellerResult.data ||
            null
        );
      }

      if (
        orderResult.error
      ) {
        logDiagnostic(
          "Marketplace orders load:",
          orderResult.error
        );

        setOrders([]);
      } else {
        setOrders(
          orderResult.data ||
            []
        );
      }

      setLastUpdated(
        getServerNowDate()
      );
    } catch (error) {
      logDiagnostic(
        "Marketplace page load error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        getSafeErrorMessage(error, "Unable to load Marketplace.")
      );
    } finally {
      setIsLoading(
        false
      );

      setIsRefreshing(
        false
      );
    }
  }

  /* =======================================================
     FILTERED DATA
  ======================================================= */

  const filteredBrowse =
    useMemo(() => {
      const search =
        lower(
          searchQuery
        );

      return browseListings.filter(
        (listing) => {
          const category =
            getListingCategory(
              listing
            );

          const matchesCategory =
            categoryFilter ===
              "all" ||
            category ===
              categoryFilter;

          const matchesSearch =
            !search ||
            getSearchText(
              listing
            ).includes(
              search
            );

          return (
            matchesCategory &&
            matchesSearch
          );
        }
      );
    }, [
      browseListings,
      searchQuery,
      categoryFilter,
    ]);

  const filteredMine =
    useMemo(() => {
      const search =
        lower(
          searchQuery
        );

      return myListings.filter(
        (listing) => {
          const category =
            getListingCategory(
              listing
            );

          const status =
            lower(
              listing?.status
            );

          const matchesCategory =
            categoryFilter ===
              "all" ||
            category ===
              categoryFilter;

          const matchesStatus =
            statusFilter ===
              "all" ||
            status ===
              statusFilter;

          const matchesSearch =
            !search ||
            getSearchText(
              listing
            ).includes(
              search
            );

          return (
            matchesCategory &&
            matchesStatus &&
            matchesSearch
          );
        }
      );
    }, [
      myListings,
      searchQuery,
      categoryFilter,
      statusFilter,
    ]);

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary =
    useMemo(() => {
      const active =
        myListings.filter(
          (item) =>
            lower(
              item?.status
            ) === "active"
        ).length;

      const sold =
        myListings.filter(
          (item) =>
            lower(
              item?.status
            ) === "sold"
        ).length;

      const hidden =
        myListings.filter(
          (item) =>
            [
              "hidden",
              "inactive",
            ].includes(
              lower(
                item?.status
              )
            )
        ).length;

      const pendingOrders =
        orders.filter(
          (order) =>
            lower(
              order?.status
            ) === "pending"
        ).length;

      return {
        allAvailable:
          browseListings.length,

        myProducts:
          myListings.length,

        active,

        sold,

        hidden,

        pendingOrders,
      };
    }, [
      browseListings,
      myListings,
      orders,
    ]);

  /* =======================================================
     LISTING ACTIONS
  ======================================================= */

  async function updateListingStatus(
    listing,
    nextStatus
  ) {
    if (
      !listing?.id ||
      !currentUser?.id
    ) {
      return;
    }

    if (
      listing.seller_id !==
      currentUser.id
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "You can only manage your own listings."
      );

      return;
    }

    setUpdatingListingId(
      listing.id
    );

    setMessage("");

    try {
      const {
        data,
        error,
      } =
        await supabase
          .from(
            "marketplace_listings"
          )
          .update({
            status:
              nextStatus,
          })
          .eq(
            "id",
            listing.id
          )
          .eq(
            "seller_id",
            currentUser.id
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error(
          "No listing was updated."
        );
      }

      setMessageType(
        "success"
      );

      if (
        nextStatus ===
        "active"
      ) {
        setMessage(
          "Product activated."
        );
      } else if (
        nextStatus ===
        "hidden"
      ) {
        setMessage(
          "Product hidden from Marketplace."
        );
      } else if (
        nextStatus ===
        "sold"
      ) {
        setMessage(
          "Product marked as sold."
        );
      }

      await loadMarketplace(
        false
      );
    } catch (error) {
      logDiagnostic(
        "Listing status update error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        getSafeErrorMessage(error, "Unable to update this listing.")
      );
    } finally {
      setUpdatingListingId(
        ""
      );
    }
  }

  function confirmStatusChange(
    listing,
    nextStatus
  ) {
    const labels = {
      active:
        "activate",
      hidden:
        "hide",
      sold:
        "mark as sold",
    };

    const action =
      labels[
        nextStatus
      ] ||
      nextStatus;

    const confirmed =
      window.confirm(
        `Do you want to ${action} "${listing.title}"?`
      );

    if (!confirmed) {
      return;
    }

    updateListingStatus(
      listing,
      nextStatus
    );
  }

  async function handleDeleteListing(
    listing
  ) {
    if (
      !listing?.id ||
      !currentUser?.id
    ) {
      return;
    }

    if (
      lower(
        listing?.status
      ) === "reserved"
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "A reserved product cannot be deleted while an order is active."
      );

      return;
    }

    const confirmed =
      window.confirm(
        `Remove "${listing.title}" from Marketplace? Its record will remain in the database for history.`
      );

    if (!confirmed) {
      return;
    }

    setUpdatingListingId(
      listing.id
    );

    try {
      const {
        error,
      } =
        await supabase
          .from(
            "marketplace_listings"
          )
          .update({
            status:
              "deleted",
          })
          .eq(
            "id",
            listing.id
          )
          .eq(
            "seller_id",
            currentUser.id
          );

      if (error) {
        throw error;
      }

      setMessageType(
        "success"
      );

      setMessage(
        "Product removed from Marketplace."
      );

      await loadMarketplace(
        false
      );
    } catch (error) {
      logDiagnostic(
        "Marketplace delete error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        getSafeErrorMessage(error, "Unable to remove this listing.")
      );
    } finally {
      setUpdatingListingId(
        ""
      );
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="market-hub-loading">
        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading Marketplace...
        </h3>

        <p>
          Getting products,
          listings, and seller
          activity.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="market-hub-page">

      {/* ===============================================
          HERO
      ================================================ */}

      <section className="market-hub-hero" data-tour="marketplace-overview">
        <div>
          <p className="dashboard-eyebrow">
            CrayThrive Marketplace
          </p>

          <h2>
            Buy, sell, and manage
            aquaculture products.
          </h2>

          <p>
            Browse crayfish,
            feeds, tanks,
            equipment, test kits,
            accessories, and other
            useful farming
            supplies.
          </p>

          <div className="market-hub-hero-actions">

            <Link
              to="/admin/marketplace/sell"
              className="dashboard-primary-button"
            >
              <Plus
                size={18}
              />

              Sell Product
            </Link>

            <Link
              to="/admin/marketplace/seller-profile"
              className="market-hub-secondary-link"
            >
              <Store
                size={18}
              />

              Seller Profile
            </Link>

            <button
              type="button"
              className="market-hub-icon-button"
              onClick={() =>
                loadMarketplace(
                  false
                )
              }
              disabled={
                isRefreshing
              }
              title="Refresh Marketplace"
            >
              <RefreshCw
                size={18}
                className={
                  isRefreshing
                    ? "spin-icon"
                    : ""
                }
              />

              Refresh
            </button>

            <span className="market-hub-updated">
              {lastUpdated
                ? `Updated ${formatShortTime(
                    lastUpdated
                  )}`
                : "Marketplace ready"}
            </span>

          </div>
        </div>

        <div className="market-hub-store-card">
          <Store
            size={33}
          />

          <strong>
            {sellerProfile
              ?.store_name ||
              "Your Store"}
          </strong>

          <span
            className={
              sellerProfile
                ?.is_active ===
              false
                ? "inactive"
                : "active"
            }
          >
            {!sellerProfile
              ? "Seller profile not set"
              : sellerProfile
                    .is_active ===
                  false
                ? "Inactive Seller"
                : "Active Seller"}
          </span>
        </div>
      </section>

      {/* ===============================================
          MESSAGE
      ================================================ */}

      {message ? (
        <div
          className={`market-hub-message ${messageType}`}
        >
          {messageType ===
          "success" ? (
            <CheckCircle2
              size={19}
            />
          ) : (
            <AlertCircle
              size={19}
            />
          )}

          <span>
            {message}
          </span>
        </div>
      ) : null}

      {/* ===============================================
          SELLER PROFILE NOTICE
      ================================================ */}

      {!sellerProfile ? (
        <section className="market-hub-seller-notice">
          <UserRound
            size={22}
          />

          <div>
            <strong>
              Setup your Seller
              Profile
            </strong>

            <span>
              Add your store name,
              contact number,
              pickup location, and
              online shop links
              before selling.
            </span>
          </div>

          <Link
            to="/admin/marketplace/seller-profile"
          >
            Setup Profile

            <ChevronRight
              size={16}
            />
          </Link>
        </section>
      ) : null}

      {/* ===============================================
          SUMMARY
      ================================================ */}

      <section className="market-hub-summary-grid">

        <SummaryCard
          icon={
            ShoppingBag
          }
          label="Available Products"
          value={
            summary.allAvailable
          }
          helper="Active marketplace listings"
        />

        <SummaryCard
          icon={
            Package
          }
          label="My Products"
          value={
            summary.myProducts
          }
          helper={`${summary.active} currently active`}
        />

        <SummaryCard
          icon={
            PackageCheck
          }
          label="Pending Orders"
          value={
            summary.pendingOrders
          }
          helper="Buyer requests awaiting action"
          tone={
            summary.pendingOrders >
            0
              ? "warning"
              : "default"
          }
        />

        <SummaryCard
          icon={
            CheckCircle2
          }
          label="Sold"
          value={
            summary.sold
          }
          helper="Products marked sold"
          tone="success"
        />

      </section>

      {/* ===============================================
          QUICK SELLER ACTIONS
      ================================================ */}

      <section className="market-hub-quick-actions">

        <Link
          to="/admin/marketplace/sell"
          className="market-hub-quick-card"
        >
          <div>
            <Plus
              size={21}
            />
          </div>

          <span>
            <strong>
              Add Product
            </strong>

            <small>
              Create a new
              marketplace listing.
            </small>
          </span>

          <ChevronRight
            size={18}
          />
        </Link>

        <Link
          to="/admin/marketplace/seller-profile"
          className="market-hub-quick-card"
        >
          <div>
            <Store
              size={21}
            />
          </div>

          <span>
            <strong>
              Seller Profile
            </strong>

            <small>
              Manage store and
              external links.
            </small>
          </span>

          <ChevronRight
            size={18}
          />
        </Link>

        <Link
          to="/admin/orders"
          className="market-hub-quick-card"
        >
          <div>
            <PackageCheck
              size={21}
            />
          </div>

          <span>
            <strong>
              Orders
            </strong>

            <small>
              Review reservations
              and buyer requests.
            </small>
          </span>

          <ChevronRight
            size={18}
          />
        </Link>

      </section>

      {/* ===============================================
          TABS
      ================================================ */}

      <section className="market-hub-tabs">
        <button
          type="button"
          className={
            activeTab ===
            "browse"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveTab(
              "browse"
            )
          }
        >
          <ShoppingBag
            size={17}
          />

          Browse Marketplace
        </button>

        <button
          type="button"
          className={
            activeTab ===
            "mine"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveTab(
              "mine"
            )
          }
        >
          <Package
            size={17}
          />

          My Products

          <span>
            {
              summary.myProducts
            }
          </span>
        </button>
      </section>

      {/* ===============================================
          CATEGORY CHIPS
      ================================================ */}

      <section className="market-hub-category-strip">
        {CATEGORY_OPTIONS.map(
          (category) => (
            <button
              key={
                category.value
              }
              type="button"
              className={
                categoryFilter ===
                category.value
                  ? "active"
                  : ""
              }
              onClick={() =>
                setCategoryFilter(
                  category.value
                )
              }
            >
              {
                category.label
              }
            </button>
          )
        )}
      </section>

      {/* ===============================================
          TOOLBAR
      ================================================ */}

      <section className="market-hub-toolbar">

        <label className="market-hub-search">
          <Search
            size={18}
          />

          <input
            type="search"
            value={
              searchQuery
            }
            onChange={(
              event
            ) =>
              setSearchQuery(
                event.target.value
              )
            }
            placeholder="Search products, category, location..."
          />
        </label>

        {activeTab ===
        "mine" ? (
          <label className="market-hub-status-filter">
            <Tag
              size={17}
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
              {STATUS_OPTIONS.map(
                (item) => (
                  <option
                    key={
                      item.value
                    }
                    value={
                      item.value
                    }
                  >
                    {
                      item.label
                    }
                  </option>
                )
              )}
            </select>
          </label>
        ) : null}

      </section>

      {/* ===============================================
          BROWSE
      ================================================ */}

      {activeTab ===
      "browse" ? (
        <section className="market-hub-content">

          <div className="market-hub-section-heading">
            <div>
              <p className="dashboard-eyebrow">
                Marketplace
              </p>

              <h3>
                Available Products
              </h3>

              <span>
                {
                  filteredBrowse.length
                }{" "}
                {filteredBrowse.length ===
                1
                  ? "product"
                  : "products"}{" "}
                found
              </span>
            </div>

            <Boxes
              size={22}
            />
          </div>

          {filteredBrowse.length ===
          0 ? (
            <EmptyState
              title="No products found"
              text="Try another search or product category."
            />
          ) : (
            <div className="market-hub-product-grid">
              {filteredBrowse.map(
                (
                  listing
                ) => (
                  <MarketplaceProductCard
                    key={
                      listing.id
                    }
                    listing={
                      listing
                    }
                    currentUserId={
                      currentUser?.id
                    }
                  />
                )
              )}
            </div>
          )}

        </section>
      ) : (
        /* ===============================================
           MY PRODUCTS
        ================================================ */

        <section className="market-hub-content">

          <div className="market-hub-section-heading">
            <div>
              <p className="dashboard-eyebrow">
                Seller Center
              </p>

              <h3>
                My Products
              </h3>

              <span>
                Manage listings
                created from web
                or mobile.
              </span>
            </div>

            <Link
              to="/admin/marketplace/sell"
              className="dashboard-primary-button"
            >
              <Plus
                size={17}
              />

              Add Product
            </Link>
          </div>

          {filteredMine.length ===
          0 ? (
            <EmptyState
              title="No products found"
              text="Create a new listing or change your filters."
              action
            />
          ) : (
            <div className="market-hub-product-grid">
              {filteredMine.map(
                (
                  listing
                ) => (
                  <SellerProductCard
                    key={
                      listing.id
                    }
                    listing={
                      listing
                    }
                    updating={
                      updatingListingId ===
                      listing.id
                    }
                    onStatusChange={
                      confirmStatusChange
                    }
                    onDelete={
                      handleDeleteListing
                    }
                  />
                )
              )}
            </div>
          )}

        </section>
      )}

    </div>
  );
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
      className={`market-hub-summary-card ${tone}`}
    >
      <div>
        <Icon
          size={20}
        />
      </div>

      <span>
        <small>
          {label}
        </small>

        <strong>
          {value}
        </strong>

        <p>
          {helper}
        </p>
      </span>
    </article>
  );
}

/* =========================================================
   PRODUCT IMAGE
========================================================= */

function ProductImage({
  listing,
}) {
  if (
    listing?.image_url
  ) {
    return (
      <img
        src={
          listing.image_url
        }
        alt={
          listing.title ||
          "Marketplace product"
        }
        loading="lazy"
      />
    );
  }

  return (
    <div className="market-hub-image-placeholder">
      <ShoppingBag
        size={35}
      />

      <span>
        No Image
      </span>
    </div>
  );
}

/* =========================================================
   BROWSE PRODUCT
========================================================= */

function MarketplaceProductCard({
  listing,
  currentUserId,
}) {
  const category =
    getListingCategory(
      listing
    );

  const isOwn =
    currentUserId &&
    currentUserId ===
      listing?.seller_id;

  return (
    <article className="market-hub-product-card">

      <div className="market-hub-product-image">
        <ProductImage
          listing={
            listing
          }
        />

        <span className="market-hub-category-badge">
          {getCategoryLabel(
            category
          )}
        </span>
      </div>

      <div className="market-hub-product-body">

        <div className="market-hub-product-title-row">
          <div>
            <span className="market-hub-product-subtitle">
              {getListingSubtitle(
                listing
              )}
            </span>

            <h4>
              {listing.title ||
                "Marketplace Product"}
            </h4>
          </div>

          {isOwn ? (
            <span className="market-hub-own-badge">
              Yours
            </span>
          ) : null}
        </div>

        <div className="market-hub-product-price">
          {formatPeso(
            listing.price
          )}

          <span>
            /{" "}
            {getListingUnit(
              listing
            )}
          </span>
        </div>

        <div className="market-hub-product-meta">

          <span>
            <Package
              size={14}
            />

            {Number(
              listing.quantity ||
                0
            )}{" "}
            available
          </span>

          <span>
            <MapPin
              size={14}
            />

            {listing
              .pickup_municipality ||
              listing.location ||
              "Location not set"}
          </span>

        </div>

        {category ===
        "crayfish" ? (
          <div className="market-hub-product-tags">

            {listing.stage ? (
              <span>
                {formatFriendlyText(
                  listing.stage
                )}
              </span>
            ) : null}

            {listing.size_label ? (
              <span>
                {
                  listing.size_label
                }
              </span>
            ) : null}

          </div>
        ) : (
          <div className="market-hub-product-tags">

            {listing.brand ? (
              <span>
                {
                  listing.brand
                }
              </span>
            ) : null}

            {listing
              .product_condition ? (
              <span>
                {formatFriendlyText(
                  listing
                    .product_condition
                )}
              </span>
            ) : null}

          </div>
        )}

        <div className="market-hub-card-footer">

          <span>
            Listed{" "}
            {formatDate(
              listing.created_at
            )}
          </span>

          <Link
            to={`/admin/marketplace/${listing.id}`}
          >
            View Details

            <ChevronRight
              size={15}
            />
          </Link>

        </div>
      </div>
    </article>
  );
}

/* =========================================================
   SELLER PRODUCT
========================================================= */

function SellerProductCard({
  listing,
  updating,
  onStatusChange,
  onDelete,
}) {
  const category =
    getListingCategory(
      listing
    );

  const status =
    lower(
      listing.status
    ) ||
    "active";

  const locked =
    [
      "reserved",
      "sold",
    ].includes(
      status
    );

  return (
    <article className="market-hub-product-card seller">

      <div className="market-hub-product-image">
        <ProductImage
          listing={
            listing
          }
        />

        <span className="market-hub-category-badge">
          {getCategoryLabel(
            category
          )}
        </span>

        <span
          className={`market-hub-status-badge ${getStatusTone(
            status
          )}`}
        >
          {formatFriendlyText(
            status
          )}
        </span>
      </div>

      <div className="market-hub-product-body">

        <span className="market-hub-product-subtitle">
          {getListingSubtitle(
            listing
          )}
        </span>

        <h4>
          {listing.title ||
            "Marketplace Product"}
        </h4>

        <div className="market-hub-product-price">
          {formatPeso(
            listing.price
          )}

          <span>
            /{" "}
            {getListingUnit(
              listing
            )}
          </span>
        </div>

        <div className="market-hub-product-meta">

          <span>
            <Package
              size={14}
            />

            {Number(
              listing.quantity ||
                0
            )}{" "}
            stock
          </span>

          <span>
            <MapPin
              size={14}
            />

            {listing
              .pickup_municipality ||
              "No location"}
          </span>

        </div>

        <div className="market-hub-seller-actions">

          <Link
            to={`/admin/marketplace/${listing.id}`}
            className="view"
          >
            <Eye
              size={15}
            />

            View
          </Link>

          {status ===
          "active" ? (
            <button
              type="button"
              disabled={
                updating
              }
              onClick={() =>
                onStatusChange(
                  listing,
                  "hidden"
                )
              }
            >
              <EyeOff
                size={15}
              />

              Hide
            </button>
          ) : null}

          {[
            "hidden",
            "inactive",
          ].includes(
            status
          ) ? (
            <button
              type="button"
              disabled={
                updating
              }
              onClick={() =>
                onStatusChange(
                  listing,
                  "active"
                )
              }
            >
              <Eye
                size={15}
              />

              Activate
            </button>
          ) : null}

          {!locked &&
          status !==
            "sold" ? (
            <button
              type="button"
              disabled={
                updating
              }
              onClick={() =>
                onStatusChange(
                  listing,
                  "sold"
                )
              }
            >
              <CheckCircle2
                size={15}
              />

              Sold
            </button>
          ) : null}

          {!locked ? (
            <button
              type="button"
              className="danger"
              disabled={
                updating
              }
              onClick={() =>
                onDelete(
                  listing
                )
              }
            >
              {updating ? (
                <Loader2
                  className="spin-icon"
                  size={15}
                />
              ) : (
                <Trash2
                  size={15}
                />
              )}

              Remove
            </button>
          ) : null}

        </div>

        {locked ? (
          <div className="market-hub-product-lock">
            <AlertCircle
              size={14}
            />

            {status ===
            "reserved"
              ? "This product has an active reservation."
              : "Sold listings are kept for transaction history."}
          </div>
        ) : null}

      </div>
    </article>
  );
}

/* =========================================================
   EMPTY
========================================================= */

function EmptyState({
  title,
  text,
  action = false,
}) {
  return (
    <div className="market-hub-empty">
      <ShoppingBag
        size={34}
      />

      <strong>
        {title}
      </strong>

      <span>
        {text}
      </span>

      {action ? (
        <Link
          to="/admin/marketplace/sell"
          className="dashboard-primary-button"
        >
          <Plus
            size={17}
          />

          Sell Product
        </Link>
      ) : null}
    </div>
  );
}

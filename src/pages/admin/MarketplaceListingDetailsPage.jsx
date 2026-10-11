import { formatPhilippineDateTime } from '../../utils/philippineTime';
import { logDiagnostic, getSafeErrorMessage } from "../../utils/securityDiagnostics";
import { normalizeExternalUrl } from "../../utils/safeUrls";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  Loader2,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import "../../styles/marketplaceListingDetails.css";

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

function formatFriendlyText(value) {
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

function formatDate(value) { return formatPhilippineDateTime(value); }

function getCategory(listing) {
  return (
    clean(
      listing?.category
    ) ||
    "crayfish"
  );
}

function getUnit(listing) {
  return (
    clean(
      listing?.unit
    ) ||
    (getCategory(
      listing
    ) === "crayfish"
      ? "piece"
      : "item")
  );
}

function normalizeUrl(value) {
  return normalizeExternalUrl(value);
}

/* =========================================================
   PAGE
========================================================= */

export default function MarketplaceListingDetailsPage() {
  const {
    listingId,
  } = useParams();

  const navigate =
    useNavigate();

  const [
    listing,
    setListing,
  ] = useState(null);

  const [
    seller,
    setSeller,
  ] = useState(null);

  const [
    currentUser,
    setCurrentUser,
  ] = useState(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    updating,
    setUpdating,
  ] = useState(false);

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

  const isOwner =
    Boolean(
      currentUser?.id &&
        listing?.seller_id &&
        currentUser.id ===
          listing.seller_id
    );

  const category =
    getCategory(
      listing
    );

  const status =
    lower(
      listing?.status
    ) || "active";

  const canEdit =
    isOwner &&
    ![
      "reserved",
      "sold",
      "deleted",
    ].includes(status);

  const sellerMobile =
    seller?.seller_mobile ||
    listing?.seller_mobile ||
    "";

  const sellerLocation =
    [
      seller?.pickup_barangay ||
        listing?.pickup_barangay,

      seller
        ?.pickup_municipality ||
        listing
          ?.pickup_municipality,
    ]
      .filter(Boolean)
      .join(", ") ||
    listing?.location ||
    "Location not provided";

  const shopLinks =
    useMemo(() => {
      if (!seller) {
        return [];
      }

      return [
        {
          label: "Shopee",

          value:
            seller.shopee_url,

          icon:
            ShoppingBag,
        },

        {
          label: "Lazada",

          value:
            seller.lazada_url,

          icon:
            ShoppingBag,
        },

        {
          label: "Facebook",

          value:
            seller.facebook_url,

          icon:
            Globe2,
        },

        {
          label:
            "TikTok Shop",

          value:
            seller.tiktok_url,

          icon:
            ExternalLink,
        },

        {
          label: "Website",

          value:
            seller.website_url,

          icon:
            Globe2,
        },
      ].map(item => ({ ...item, value: normalizeExternalUrl(item.value) })).filter(item => item.value);
    }, [
      seller,
    ]);

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    loadPage(true);
  }, [
    listingId,
  ]);

  async function loadPage(
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

      setLoading(false);

      return;
    }

    try {
      if (
        fullLoading
      ) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setMessage("");

      const {
        data: userData,
      } =
        await supabase
          .auth
          .getUser();

      setCurrentUser(
        userData?.user ||
          null
      );

      const {
        data:
          listingData,

        error:
          listingError,
      } =
        await supabase
          .from(
            "marketplace_listings"
          )
          .select("*")
          .eq(
            "id",
            listingId
          )
          .maybeSingle();

      if (
        listingError
      ) {
        throw listingError;
      }

      if (
        !listingData
      ) {
        throw new Error(
          "Marketplace product was not found."
        );
      }

      setListing(
        listingData
      );

      /*
        Seller profile may have stricter RLS.
        Listing details can still work using
        the seller contact fields stored
        inside marketplace_listings.
      */

      const {
        data:
          sellerData,

        error:
          sellerError,
      } =
        await supabase
          .from(
            "seller_profiles"
          )
          .select("*")
          .eq(
            "user_id",
            listingData.seller_id
          )
          .maybeSingle();

      if (
        sellerError
      ) {
        logDiagnostic(
          "Seller profile could not be loaded:",
          sellerError
        );

        setSeller(null);
      } else {
        setSeller(
          sellerData ||
            null
        );
      }
    } catch (
      error
    ) {
      logDiagnostic(
        "Marketplace listing load error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        getSafeErrorMessage(error, "Unable to load this product.")
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  /* =======================================================
     OWNER STATUS
  ======================================================= */

  async function updateStatus(
    nextStatus
  ) {
    if (
      !isOwner ||
      !listing?.id
    ) {
      return;
    }

    setUpdating(true);
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

      setListing(
        data
      );

      setMessageType(
        "success"
      );

      if (
        nextStatus ===
        "active"
      ) {
        setMessage(
          "Product activated successfully."
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
    } catch (
      error
    ) {
      logDiagnostic(
        "Listing status error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        getSafeErrorMessage(error, "Unable to update product status.")
      );
    } finally {
      setUpdating(false);
    }
  }

  function confirmStatus(
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

    const confirmed =
      window.confirm(
        `Do you want to ${
          labels[
            nextStatus
          ] ||
          nextStatus
        } this product?`
      );

    if (
      confirmed
    ) {
      updateStatus(
        nextStatus
      );
    }
  }

  /* =======================================================
     REMOVE
  ======================================================= */

  async function removeListing() {
    if (
      !isOwner ||
      !listing?.id
    ) {
      return;
    }

    if (
      [
        "reserved",
        "sold",
      ].includes(
        status
      )
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "Reserved or sold products are kept for transaction history."
      );

      return;
    }

    const confirmed =
      window.confirm(
        "Remove this product from Marketplace? The database record will remain for history."
      );

    if (
      !confirmed
    ) {
      return;
    }

    setUpdating(true);

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

      navigate(
        "/admin/marketplace"
      );
    } catch (
      error
    ) {
      logDiagnostic(
        "Remove listing error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        getSafeErrorMessage(error, "Unable to remove this product.")
      );

      setUpdating(false);
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <section className="listing-details-loading">

        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading product...
        </h3>

        <p>
          Getting marketplace
          product information.
        </p>

      </section>
    );
  }

  /* =======================================================
     NOT FOUND
  ======================================================= */

  if (
    !listing
  ) {
    return (
      <section className="listing-details-error">

        <AlertCircle
          size={34}
        />

        <h3>
          Product unavailable
        </h3>

        <p>
          {message ||
            "This marketplace product could not be found."}
        </p>

        <Link
          to="/admin/marketplace"
          className="dashboard-primary-button"
        >
          <ArrowLeft
            size={17}
          />

          Back to Marketplace
        </Link>

      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="listing-details-page">

      {/* ===============================================
          TOP
      ================================================ */}

      <section className="listing-details-top">

        <div>

          <Link
            to="/admin/marketplace"
            className="listing-details-back"
          >
            <ArrowLeft
              size={16}
            />

            Back to Marketplace
          </Link>

          <p className="dashboard-eyebrow">
            Marketplace Product
          </p>

          <h2>
            {listing.title ||
              "Marketplace Product"}
          </h2>

          <div className="listing-details-header-meta">

            <span>
              <Tag
                size={14}
              />

              {formatFriendlyText(
                category
              )}
            </span>

            <span>
              <Package
                size={14}
              />

              {formatFriendlyText(
                listing.subcategory ||
                  listing.stage ||
                  "Product"
              )}
            </span>

          </div>

        </div>

        <button
          type="button"
          className="listing-details-refresh"
          onClick={() =>
            loadPage(false)
          }
          disabled={
            refreshing
          }
        >
          <RefreshCw
            size={17}
            className={
              refreshing
                ? "spin-icon"
                : ""
            }
          />

          Refresh
        </button>

      </section>

      {/* ===============================================
          MESSAGE
      ================================================ */}

      {message ? (
        <div
          className={`listing-details-message ${messageType}`}
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
          PRODUCT
      ================================================ */}

      <section className="listing-details-main">

        {/* IMAGE */}

        <article className="listing-details-image-card">

          {listing.image_url ? (
            <img
              src={
                listing.image_url
              }
              alt={
                listing.title ||
                "Marketplace product"
              }
            />
          ) : (
            <div className="listing-details-image-empty">

              <ShoppingBag
                size={48}
              />

              <strong>
                No product image
              </strong>

            </div>
          )}

          <span
            className={`listing-details-status ${status}`}
          >
            {formatFriendlyText(
              status
            )}
          </span>

        </article>

        {/* DETAILS */}

        <article className="listing-details-info">

          <div className="listing-details-price">

            <span>
              Price
            </span>

            <strong>
              {formatPeso(
                listing.price
              )}
            </strong>

            <small>
              per{" "}
              {formatFriendlyText(
                getUnit(
                  listing
                )
              )}
            </small>

          </div>

          <div className="listing-details-stat-grid">

            <DetailStat
              icon={
                Package
              }
              label="Stock"
              value={`${Number(
                listing.quantity ||
                  0
              )} ${formatFriendlyText(
                getUnit(
                  listing
                )
              )}`}
            />

            <DetailStat
              icon={
                Tag
              }
              label="Category"
              value={formatFriendlyText(
                category
              )}
            />

            <DetailStat
              icon={
                ShoppingBag
              }
              label="Subcategory"
              value={formatFriendlyText(
                listing.subcategory ||
                  listing.stage ||
                  "N/A"
              )}
            />

            <DetailStat
              icon={
                MapPin
              }
              label="Pickup"
              value={
                listing.pickup_municipality ||
                "Not set"
              }
            />

          </div>

          {/* CRAYFISH DETAILS */}

          {category ===
          "crayfish" ? (
            <div className="listing-details-crayfish-grid">

              <DetailStat
                label="Crayfish Type"
                value={
                  listing.crayfish_type ||
                  "Redclaw Crayfish"
                }
              />

              <DetailStat
                label="Stage"
                value={formatFriendlyText(
                  listing.stage
                )}
              />

              <DetailStat
                label="Sex"
                value={formatFriendlyText(
                  listing.sex
                )}
              />

              <DetailStat
                label="Size"
                value={
                  listing.size_label ||
                  "Not specified"
                }
              />

            </div>
          ) : (
            <div className="listing-details-crayfish-grid">

              <DetailStat
                label="Brand"
                value={
                  listing.brand ||
                  "Not specified"
                }
              />

              <DetailStat
                label="Condition"
                value={formatFriendlyText(
                  listing.product_condition ||
                    "Not Applicable"
                )}
              />

              <DetailStat
                label="SKU"
                value={
                  listing.sku ||
                  "Not specified"
                }
              />

              <DetailStat
                label="Custom Product"
                value={
                  listing.is_custom_product
                    ? "Yes"
                    : "No"
                }
              />

            </div>
          )}

          {/* DESCRIPTION */}

          <div className="listing-details-description">

            <span>
              Description
            </span>

            <p>
              {listing.description ||
                "No additional product description was provided."}
            </p>

          </div>

          <div className="listing-details-date">
            Listed{" "}
            {formatDate(
              listing.created_at
            )}
          </div>

        </article>

      </section>

      {/* ===============================================
          OWNER CONTROLS
      ================================================ */}

      {isOwner ? (
        <section className="listing-details-owner-panel">

          <div>

            <p className="dashboard-eyebrow">
              Seller Controls
            </p>

            <h3>
              Manage this product
            </h3>

            <span>
              This listing belongs
              to your account.
            </span>

          </div>

          <div className="listing-details-owner-actions">

            {canEdit ? (
              <Link
                to={`/admin/marketplace/${listing.id}/edit`}
                className="dashboard-primary-button"
              >
                <Edit3
                  size={17}
                />

                Edit Product
              </Link>
            ) : null}

            {status ===
            "active" ? (
              <button
                type="button"
                disabled={
                  updating
                }
                onClick={() =>
                  confirmStatus(
                    "hidden"
                  )
                }
              >
                <EyeOff
                  size={16}
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
                  confirmStatus(
                    "active"
                  )
                }
              >
                <Eye
                  size={16}
                />

                Activate
              </button>
            ) : null}

            {![
              "reserved",
              "sold",
            ].includes(
              status
            ) ? (
              <button
                type="button"
                disabled={
                  updating
                }
                onClick={() =>
                  confirmStatus(
                    "sold"
                  )
                }
              >
                <CheckCircle2
                  size={16}
                />

                Mark Sold
              </button>
            ) : null}

            {![
              "reserved",
              "sold",
            ].includes(
              status
            ) ? (
              <button
                type="button"
                className="danger"
                disabled={
                  updating
                }
                onClick={
                  removeListing
                }
              >
                {updating ? (
                  <Loader2
                    size={16}
                    className="spin-icon"
                  />
                ) : (
                  <Trash2
                    size={16}
                  />
                )}

                Remove
              </button>
            ) : null}

          </div>

        </section>
      ) : null}

      {/* ===============================================
          SELLER
      ================================================ */}

      <section className="listing-details-seller">

        <div className="listing-details-panel-heading">

          <div>

            <p className="dashboard-eyebrow">
              Seller
            </p>

            <h3>
              Seller Information
            </h3>

          </div>

          <Store
            size={22}
          />

        </div>

        <div className="listing-details-seller-main">

          <div className="listing-details-store-name">

            <div>
              <UserRound
                size={22}
              />
            </div>

            <span>

              <strong>
                {seller?.store_name ||
                  "Marketplace Seller"}
              </strong>

              <small>
                {seller?.store_description ||
                  "CrayThrive Marketplace seller"}
              </small>

            </span>

          </div>

          <div className="listing-details-contact-grid">

            <div>

              <Phone
                size={17}
              />

              <span>

                <small>
                  Mobile
                </small>

                <strong>
                  {sellerMobile ||
                    "Not provided"}
                </strong>

              </span>

            </div>

            <div>

              <MapPin
                size={17}
              />

              <span>

                <small>
                  Pickup Location
                </small>

                <strong>
                  {sellerLocation}
                </strong>

              </span>

            </div>

          </div>

          <div className="listing-details-contact-actions">

            {sellerMobile ? (
              <a
                href={`tel:${sellerMobile}`}
              >
                <Phone
                  size={16}
                />

                Contact Seller
              </a>
            ) : null}

            {shopLinks.map(
              ({
                label,
                value,
                icon:
                  Icon,
              }) => (
                <a
                  key={
                    label
                  }
                  href={
                    normalizeUrl(
                      value
                    )
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon
                    size={16}
                  />

                  {label}

                  <ExternalLink
                    size={12}
                  />
                </a>
              )
            )}

          </div>

        </div>

      </section>

    </div>
  );
}

/* =========================================================
   STAT
========================================================= */

function DetailStat({
  icon: Icon,
  label,
  value,
}) {
  return (
    <div className="listing-details-stat">

      {Icon ? (
        <Icon
          size={17}
        />
      ) : null}

      <span>

        <small>
          {label}
        </small>

        <strong>
          {value}
        </strong>

      </span>

    </div>
  );
}
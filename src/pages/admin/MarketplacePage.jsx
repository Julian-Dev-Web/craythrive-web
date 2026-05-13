import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Filter,
  ImageOff,
  Loader2,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  Tag,
  Wallet,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const listingTableNames = ["marketplace_listings", "listings", "products"];

const userFilterColumns = [
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

  if (!Number.isFinite(amount)) return "No price";

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getListingId(listing) {
  return (
    listing?.id ||
    listing?.listing_id ||
    listing?.product_id ||
    listing?.uuid ||
    ""
  );
}

function getListingTitle(listing) {
  return (
    listing?.title ||
    listing?.name ||
    listing?.product_name ||
    listing?.listing_title ||
    "Untitled Crayfish Listing"
  );
}

function getListingType(listing) {
  return (
    listing?.crayfish_type ||
    listing?.type ||
    listing?.species ||
    listing?.category ||
    "Crayfish"
  );
}

function getListingStage(listing) {
  return (
    listing?.stage ||
    listing?.life_stage ||
    listing?.size_stage ||
    listing?.age_stage ||
    "Unspecified"
  );
}

function getListingSex(listing) {
  return listing?.sex || listing?.gender || listing?.crayfish_sex || "N/A";
}

function getListingSize(listing) {
  return (
    listing?.size_label ||
    listing?.size ||
    listing?.length_label ||
    listing?.classification ||
    "N/A"
  );
}

function getListingQuantity(listing) {
  return listing?.quantity || listing?.qty || listing?.stock || listing?.count || 1;
}

function getListingPrice(listing) {
  return (
    listing?.price ||
    listing?.unit_price ||
    listing?.selling_price ||
    listing?.amount ||
    0
  );
}

function getListingStatus(listing) {
  const raw = lower(listing?.status || listing?.listing_status || "active");

  if (listing?.deleted_at && !raw.includes("deleted")) return "deleted";
  if (raw.includes("sold")) return "sold";
  if (raw.includes("reserve")) return "reserved";
  if (raw.includes("hide")) return "hidden";
  if (raw.includes("delete")) return "deleted";
  if (raw.includes("inactive")) return "hidden";
  return raw || "active";
}

function getListingImage(listing) {
  return (
    listing?.image_url ||
    listing?.photo_url ||
    listing?.thumbnail_url ||
    listing?.cover_image_url ||
    listing?.main_image_url ||
    listing?.image ||
    ""
  );
}

function getSellerMobile(listing) {
  return (
    listing?.seller_mobile ||
    listing?.mobile ||
    listing?.phone ||
    listing?.contact_number ||
    "No mobile"
  );
}

function getLocation(listing) {
  const direct =
    listing?.location ||
    listing?.pickup_location ||
    listing?.address ||
    listing?.seller_location;

  if (direct) return direct;

  const parts = [
    listing?.pickup_barangay || listing?.barangay,
    listing?.pickup_municipality || listing?.municipality || listing?.city,
    listing?.province,
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "No location";
}

function getStatusLabel(status) {
  if (status === "active") return "Active";
  if (status === "reserved") return "Reserved";
  if (status === "sold") return "Sold";
  if (status === "hidden") return "Hidden";
  if (status === "deleted") return "Deleted";
  return status || "Active";
}

async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  return {
    id: user?.id || "",
    email: user?.email || "",
  };
}

async function fetchUserListings(userId, limit = 250) {
  for (const tableName of listingTableNames) {
    for (const userColumn of userFilterColumns) {
      const ordered = await supabase
        .from(tableName)
        .select("*")
        .eq(userColumn, userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!ordered.error && Array.isArray(ordered.data)) {
        return {
          rows: ordered.data,
          tableUsed: tableName,
          userColumnUsed: userColumn,
        };
      }

      const plain = await supabase
        .from(tableName)
        .select("*")
        .eq(userColumn, userId)
        .limit(limit);

      if (!plain.error && Array.isArray(plain.data)) {
        return {
          rows: plain.data,
          tableUsed: tableName,
          userColumnUsed: userColumn,
        };
      }
    }
  }

  return {
    rows: [],
    tableUsed: listingTableNames[0],
    userColumnUsed: "",
  };
}

export default function MarketplacePage() {
  const [listings, setListings] = useState([]);
  const [tableUsed, setTableUsed] = useState("marketplace_listings");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

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
        return;
      }

      const result = await fetchUserListings(currentUser.id);

      const sortedListings = [...result.rows].sort((a, b) => {
        const aDate = new Date(a.created_at || a.updated_at || 0).getTime();
        const bDate = new Date(b.created_at || b.updated_at || 0).getTime();
        return bDate - aDate;
      });

      setListings(sortedListings);
      setTableUsed(result.tableUsed);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Marketplace loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMarketplace();
  }, []);

  const typeOptions = useMemo(() => {
    const unique = new Set();

    listings.forEach((listing) => {
      unique.add(getListingType(listing));
    });

    return Array.from(unique).filter(Boolean);
  }, [listings]);

  const stageOptions = useMemo(() => {
    const unique = new Set();

    listings.forEach((listing) => {
      unique.add(getListingStage(listing));
    });

    return Array.from(unique).filter(Boolean);
  }, [listings]);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      const search = lower(searchTerm);
      const title = lower(getListingTitle(listing));
      const type = lower(getListingType(listing));
      const stage = lower(getListingStage(listing));
      const status = getListingStatus(listing);
      const location = lower(getLocation(listing));

      const matchesSearch =
        !search ||
        title.includes(search) ||
        type.includes(search) ||
        stage.includes(search) ||
        status.includes(search) ||
        location.includes(search);

      const matchesStatus =
        statusFilter === "all" || status === lower(statusFilter);

      const matchesType = typeFilter === "all" || type === lower(typeFilter);

      const matchesStage =
        stageFilter === "all" || stage === lower(stageFilter);

      return matchesSearch && matchesStatus && matchesType && matchesStage;
    });
  }, [listings, searchTerm, statusFilter, typeFilter, stageFilter]);

  const stats = useMemo(() => {
    return listings.reduce(
      (acc, listing) => {
        const status = getListingStatus(listing);

        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;

        return acc;
      },
      {
        total: 0,
        active: 0,
        reserved: 0,
        sold: 0,
        hidden: 0,
        deleted: 0,
      }
    );
  }, [listings]);

  return (
    <div className="marketplace-page">
      <section className="marketplace-header-card">
        <div>
          <p className="dashboard-eyebrow">Crayfish Marketplace</p>
          <h2>Marketplace Listings</h2>
          <p>
            Manage crayfish-only listings connected to your CrayThrive mobile
            account. View listing status, stock quantity, price, location, and
            seller contact details.
          </p>

          <div className="marketplace-header-actions">
            <button
              className="dashboard-primary-button"
              onClick={loadMarketplace}
            >
              {isLoading ? (
                <Loader2 className="spin-icon" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
              Refresh Listings
            </button>

            <span>
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : `Source table: ${tableUsed}`}
            </span>
          </div>
        </div>
      </section>

      <section className="marketplace-summary-grid">
        <article className="marketplace-summary-card">
          <span>
            <ShoppingBag size={22} />
          </span>
          <strong>{stats.total}</strong>
          <p>Total listings</p>
        </article>

        <article className="marketplace-summary-card">
          <span>
            <CheckCircle2 size={22} />
          </span>
          <strong>{stats.active || 0}</strong>
          <p>Active</p>
        </article>

        <article className="marketplace-summary-card">
          <span>
            <PackageCheck size={22} />
          </span>
          <strong>{stats.reserved || 0}</strong>
          <p>Reserved</p>
        </article>

        <article className="marketplace-summary-card">
          <span>
            <Wallet size={22} />
          </span>
          <strong>{stats.sold || 0}</strong>
          <p>Sold</p>
        </article>
      </section>

      <section className="marketplace-toolbar">
        <label className="marketplace-search-box">
          <Search size={18} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search title, type, stage, location..."
          />
        </label>

        <label className="marketplace-filter">
          <Filter size={18} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="reserved">Reserved</option>
            <option value="sold">Sold</option>
            <option value="hidden">Hidden</option>
            <option value="deleted">Deleted</option>
          </select>
        </label>

        <label className="marketplace-filter">
          <Tag size={18} />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All types</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="marketplace-filter">
          <ShoppingBag size={18} />
          <select
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value)}
          >
            <option value="all">All stages</option>
            {stageOptions.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
      </section>

      {isLoading ? (
        <section className="marketplace-empty-state">
          <Loader2 className="spin-icon" size={30} />
          <h3>Loading marketplace listings...</h3>
          <p>Please wait while CrayThrive checks your marketplace records.</p>
        </section>
      ) : filteredListings.length === 0 ? (
        <section className="marketplace-empty-state">
          <AlertTriangle size={34} />
          <h3>No listings found</h3>
          <p>
            No marketplace listings matched your filters. Add or sync crayfish
            listings from the mobile app.
          </p>
        </section>
      ) : (
        <section className="marketplace-card-grid">
          {filteredListings.map((listing, index) => {
            const listingId = getListingId(listing) || `listing-${index}`;
            const imageUrl = getListingImage(listing);
            const status = getListingStatus(listing);

            return (
              <article className="marketplace-card" key={listingId}>
                <div className="marketplace-image">
                  {imageUrl ? (
                    <img src={imageUrl} alt={getListingTitle(listing)} />
                  ) : (
                    <div>
                      <ImageOff size={30} />
                      <span>No image</span>
                    </div>
                  )}

                  <span className={`marketplace-status-pill ${status}`}>
                    {getStatusLabel(status)}
                  </span>
                </div>

                <div className="marketplace-card-body">
                  <div className="marketplace-title-row">
                    <div>
                      <span className="marketplace-type-pill">
                        {getListingType(listing)}
                      </span>
                      <h3>{getListingTitle(listing)}</h3>
                    </div>

                    <strong>{formatPrice(getListingPrice(listing))}</strong>
                  </div>

                  <div className="marketplace-info-grid">
                    <div>
                      <span>Stage</span>
                      <strong>{getListingStage(listing)}</strong>
                    </div>

                    <div>
                      <span>Sex</span>
                      <strong>{getListingSex(listing)}</strong>
                    </div>

                    <div>
                      <span>Size</span>
                      <strong>{getListingSize(listing)}</strong>
                    </div>

                    <div>
                      <span>Quantity</span>
                      <strong>{getListingQuantity(listing)}</strong>
                    </div>
                  </div>

                  <div className="marketplace-location-row">
                    <MapPin size={17} />
                    <span>{getLocation(listing)}</span>
                  </div>

                  <div className="marketplace-meta-row">
                    <span>Mobile: {getSellerMobile(listing)}</span>
                    <span>{formatDate(listing.created_at)}</span>
                  </div>

                  <Link
                    className="marketplace-details-link"
                    to={`/admin/marketplace/${listingId}`}
                  >
                    View listing details
                    <ArrowRight size={17} />
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
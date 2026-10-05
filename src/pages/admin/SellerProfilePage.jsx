import { normalizeExternalUrl } from "../../utils/safeUrls";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertCircle,
  CheckCircle2,
  Globe2,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Power,
  RefreshCw,
  Save,
  ShoppingBag,
  Store,
  UserRound,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import "../../styles/sellerProfile.css";

/* =========================================================
   CONFIG
========================================================= */

const PSGC_BASE_URL =
  "https://psgc.cloud/api/v2";

const BULACAN_PROVINCE_NAME =
  "Bulacan";

const BULACAN_FALLBACK_LOCALITIES = [
  {
    name: "Angat",
    code: "Angat",
  },

  {
    name: "Balagtas",
    code: "Balagtas",
  },

  {
    name: "Baliwag",
    code: "Baliwag",
  },

  {
    name: "Bocaue",
    code: "Bocaue",
  },

  {
    name: "Bulakan",
    code: "Bulakan",
  },

  {
    name: "Bustos",
    code: "Bustos",
  },

  {
    name: "Calumpit",
    code: "Calumpit",
  },

  {
    name:
      "Doña Remedios Trinidad",

    code:
      "Doña Remedios Trinidad",
  },

  {
    name: "Guiguinto",
    code: "Guiguinto",
  },

  {
    name: "Hagonoy",
    code: "Hagonoy",
  },

  {
    name:
      "City of Malolos",

    code:
      "City of Malolos",
  },

  {
    name: "Marilao",
    code: "Marilao",
  },

  {
    name:
      "City of Meycauayan",

    code:
      "City of Meycauayan",
  },

  {
    name: "Norzagaray",
    code: "Norzagaray",
  },

  {
    name: "Obando",
    code: "Obando",
  },

  {
    name: "Pandi",
    code: "Pandi",
  },

  {
    name: "Paombong",
    code: "Paombong",
  },

  {
    name: "Plaridel",
    code: "Plaridel",
  },

  {
    name: "Pulilan",
    code: "Pulilan",
  },

  {
    name: "San Ildefonso",
    code: "San Ildefonso",
  },

  {
    name:
      "City of San Jose del Monte",

    code:
      "City of San Jose del Monte",
  },

  {
    name: "San Miguel",
    code: "San Miguel",
  },

  {
    name: "San Rafael",
    code: "San Rafael",
  },

  {
    name: "Santa Maria",
    code: "Santa Maria",
  },
];

const EMPTY_FORM = {
  store_name: "",
  store_description: "",

  seller_mobile: "",

  pickup_municipality:
    "",

  pickup_municipality_code:
    "",

  pickup_barangay:
    "",

  pickup_barangay_code:
    "",

  pickup_note: "",

  shopee_url: "",
  lazada_url: "",
  facebook_url: "",
  tiktok_url: "",
  website_url: "",

  is_active: true,
};

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function normalizeApiList(json) {
  if (
    Array.isArray(
      json
    )
  ) {
    return json;
  }

  if (
    Array.isArray(
      json?.data
    )
  ) {
    return json.data;
  }

  if (
    Array.isArray(
      json?.items
    )
  ) {
    return json.items;
  }

  if (
    Array.isArray(
      json?.results
    )
  ) {
    return json.results;
  }

  return [];
}

function buildUsernameFromEmail(
  email
) {
  const value =
    clean(email);

  if (
    !value.includes("@")
  ) {
    return "";
  }

  return (
    value.split("@")[0] ||
    ""
  );
}

function getDisplayName(
  profile,
  user
) {
  return (
    profile?.username ||
    profile?.full_name ||
    user?.user_metadata
      ?.username ||
    user?.user_metadata
      ?.full_name ||
    buildUsernameFromEmail(
      user?.email
    ) ||
    "CrayThrive Seller"
  );
}

function mobileOnly(value) {
  return String(
    value ?? ""
  )
    .replace(
      /[^0-9+]/g,
      ""
    )
    .slice(
      0,
      14
    );
}

function normalizeOptionalUrl(value) {
  return normalizeExternalUrl(value);
}

function isValidOptionalUrl(value) {
  return !clean(value) || Boolean(normalizeExternalUrl(value));
}

/* =========================================================
   PAGE
========================================================= */

export default function SellerProfilePage() {
  const [
    form,
    setForm,
  ] =
    useState(
      EMPTY_FORM
    );

  const [
    userId,
    setUserId,
  ] =
    useState("");

  const [
    email,
    setEmail,
  ] =
    useState("");

  const [
    displayName,
    setDisplayName,
  ] =
    useState(
      "CrayThrive Seller"
    );

  const [
    localities,
    setLocalities,
  ] =
    useState([]);

  const [
    barangays,
    setBarangays,
  ] =
    useState([]);

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  const [
    isSaving,
    setIsSaving,
  ] =
    useState(false);

  const [
    isRefreshing,
    setIsRefreshing,
  ] =
    useState(false);

  const [
    loadingLocalities,
    setLoadingLocalities,
  ] =
    useState(false);

  const [
    loadingBarangays,
    setLoadingBarangays,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    messageType,
    setMessageType,
  ] =
    useState(
      "success"
    );

  const [
    lastUpdated,
    setLastUpdated,
  ] =
    useState(null);

  /* =======================================================
     SELECTED LOCATION
  ======================================================= */

  const selectedLocality =
    useMemo(
      () => {
        return (
          localities.find(
            (
              item
            ) =>
              item.code ===
                form.pickup_municipality_code ||
              item.name ===
                form.pickup_municipality
          ) ||
          null
        );
      },
      [
        localities,
        form.pickup_municipality,
        form.pickup_municipality_code,
      ]
    );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    loadPage();
  }, []);

  async function loadPage(
    refresh = false
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
        refresh
      ) {
        setIsRefreshing(
          true
        );
      } else {
        setIsLoading(
          true
        );
      }

      setMessage("");

      await Promise.all([
        loadSellerProfile(),

        loadBulacanLocalities(),
      ]);

      setLastUpdated(
        new Date()
      );
    } catch (
      error
    ) {
      console.error(
        "Seller profile load error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        error?.message ||
          "Unable to load seller profile."
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
     LOAD SELLER PROFILE
  ======================================================= */

  async function loadSellerProfile() {
    const {
      data:
        userData,

      error:
        userError,
    } =
      await supabase
        .auth
        .getUser();

    if (
      userError
    ) {
      throw new Error(
        userError.message ||
          "Unable to load account."
      );
    }

    const user =
      userData?.user;

    if (
      !user?.id
    ) {
      throw new Error(
        "No logged in user found."
      );
    }

    setUserId(
      user.id
    );

    setEmail(
      user.email ||
        ""
    );

    /* PROFILE IDENTITY */

    const {
      data:
        profileData,

      error:
        profileError,
    } =
      await supabase
        .from(
          "profiles"
        )
        .select(
          "username, full_name"
        )
        .eq(
          "id",
          user.id
        )
        .maybeSingle();

    if (
      profileError
    ) {
      console.warn(
        "Profile identity load error:",
        profileError
      );
    }

    setDisplayName(
      getDisplayName(
        profileData,
        user
      )
    );

    /* SELLER */

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
          user.id
        )
        .maybeSingle();

    if (
      sellerError
    ) {
      throw sellerError;
    }

    if (
      !sellerData
    ) {
      return;
    }

    const nextForm = {
      store_name:
        sellerData
          .store_name ||
        "",

      store_description:
        sellerData
          .store_description ||
        "",

      seller_mobile:
        sellerData
          .seller_mobile ||
        "",

      pickup_municipality:
        sellerData
          .pickup_municipality ||
        "",

      pickup_municipality_code:
        sellerData
          .pickup_municipality_code ||
        "",

      pickup_barangay:
        sellerData
          .pickup_barangay ||
        "",

      pickup_barangay_code:
        sellerData
          .pickup_barangay_code ||
        "",

      pickup_note:
        sellerData
          .pickup_note ||
        "",

      shopee_url:
        sellerData
          .shopee_url ||
        "",

      lazada_url:
        sellerData
          .lazada_url ||
        "",

      facebook_url:
        sellerData
          .facebook_url ||
        "",

      tiktok_url:
        sellerData
          .tiktok_url ||
        "",

      website_url:
        sellerData
          .website_url ||
        "",

      is_active:
        typeof sellerData
          .is_active ===
        "boolean"
          ? sellerData
              .is_active
          : true,
    };

    setForm(
      nextForm
    );

    if (
      nextForm
        .pickup_municipality_code ||
      nextForm
        .pickup_municipality
    ) {
      await loadBarangaysForLocality(
        {
          name:
            nextForm
              .pickup_municipality,

          code:
            nextForm
              .pickup_municipality_code ||
            nextForm
              .pickup_municipality,
        },

        {
          preserveBarangay:
            true,
        }
      );
    }
  }

  /* =======================================================
     BULACAN LOCATIONS
  ======================================================= */

  async function loadBulacanLocalities() {
    setLoadingLocalities(
      true
    );

    try {
      const province =
        encodeURIComponent(
          BULACAN_PROVINCE_NAME
        );

      const response =
        await fetch(
          `${PSGC_BASE_URL}/provinces/${province}/cities-municipalities`
        );

      if (
        !response.ok
      ) {
        throw new Error(
          "Unable to load Bulacan locations."
        );
      }

      const json =
        await response.json();

      const rows =
        normalizeApiList(
          json
        );

      const mapped =
        rows
          .map(
            (
              item
            ) => ({
              name:
                item.name ||
                item.area_name ||
                "Unknown",

              code:
                item.code ||
                item.psgc_code ||
                item.id ||
                item.name,
            })
          )
          .filter(
            (
              item
            ) =>
              item.name &&
              item.code
          )
          .sort(
            (
              a,
              b
            ) =>
              a.name.localeCompare(
                b.name
              )
          );

      setLocalities(
        mapped.length >
          0
          ? mapped
          : BULACAN_FALLBACK_LOCALITIES
      );
    } catch (
      error
    ) {
      console.warn(
        "Bulacan locality load error:",
        error
      );

      setLocalities(
        BULACAN_FALLBACK_LOCALITIES
      );
    } finally {
      setLoadingLocalities(
        false
      );
    }
  }

  async function loadBarangaysForLocality(
    locality,
    options = {}
  ) {
    if (
      !locality?.code &&
      !locality?.name
    ) {
      setBarangays([]);

      return;
    }

    const preserveBarangay =
      Boolean(
        options.preserveBarangay
      );

    setLoadingBarangays(
      true
    );

    setBarangays([]);

    if (
      !preserveBarangay
    ) {
      setForm(
        (
          previous
        ) => ({
          ...previous,

          pickup_barangay:
            "",

          pickup_barangay_code:
            "",
        })
      );
    }

    try {
      const localityKey =
        encodeURIComponent(
          locality.code ||
            locality.name
        );

      const response =
        await fetch(
          `${PSGC_BASE_URL}/cities-municipalities/${localityKey}/barangays`
        );

      if (
        !response.ok
      ) {
        throw new Error(
          "Unable to load barangays."
        );
      }

      const json =
        await response.json();

      const rows =
        normalizeApiList(
          json
        );

      const mapped =
        rows
          .map(
            (
              item
            ) => ({
              name:
                item.name ||
                item.area_name ||
                "Unknown",

              code:
                item.code ||
                item.psgc_code ||
                item.id ||
                item.name,
            })
          )
          .filter(
            (
              item
            ) =>
              item.name &&
              item.code
          )
          .sort(
            (
              a,
              b
            ) =>
              a.name.localeCompare(
                b.name
              )
          );

      setBarangays(
        mapped
      );
    } catch (
      error
    ) {
      console.warn(
        "Barangay loading error:",
        error
      );

      setBarangays([]);
    } finally {
      setLoadingBarangays(
        false
      );
    }
  }

  /* =======================================================
     FORM
  ======================================================= */

  function updateForm(
    key,
    value
  ) {
    setMessage("");

    setForm(
      (
        previous
      ) => ({
        ...previous,

        [key]:
          value,
      })
    );
  }

  async function handleMunicipalityChange(
    event
  ) {
    const code =
      event.target.value;

    const locality =
      localities.find(
        (
          item
        ) =>
          String(
            item.code
          ) ===
          String(
            code
          )
      );

    if (
      !locality
    ) {
      setForm(
        (
          previous
        ) => ({
          ...previous,

          pickup_municipality:
            "",

          pickup_municipality_code:
            "",

          pickup_barangay:
            "",

          pickup_barangay_code:
            "",
        })
      );

      setBarangays([]);

      return;
    }

    setForm(
      (
        previous
      ) => ({
        ...previous,

        pickup_municipality:
          locality.name,

        pickup_municipality_code:
          locality.code,

        pickup_barangay:
          "",

        pickup_barangay_code:
          "",
      })
    );

    await loadBarangaysForLocality(
      locality
    );
  }

  function handleBarangayChange(
    event
  ) {
    const code =
      event.target.value;

    const barangay =
      barangays.find(
        (
          item
        ) =>
          String(
            item.code
          ) ===
          String(
            code
          )
      );

    setForm(
      (
        previous
      ) => ({
        ...previous,

        pickup_barangay:
          barangay?.name ||
          "",

        pickup_barangay_code:
          barangay?.code ||
          "",
      })
    );
  }

  /* =======================================================
     VALIDATION
  ======================================================= */

  function validateForm() {
    if (
      !clean(
        form.store_name
      )
    ) {
      return "Please enter your store name.";
    }

    const mobile =
      clean(
        form.seller_mobile
      );

    if (!mobile) {
      return "Please enter your seller mobile number.";
    }

    if (
      mobile.replace(
        /\D/g,
        ""
      ).length <
      10
    ) {
      return "Please enter a valid mobile number.";
    }

    if (
      !clean(
        form.pickup_municipality
      )
    ) {
      return "Please select your pickup city or municipality.";
    }

    if (
      !clean(
        form.pickup_barangay
      )
    ) {
      return "Please select your pickup barangay.";
    }

    const urlFields = [
      [
        "Shopee",
        form.shopee_url,
      ],

      [
        "Lazada",
        form.lazada_url,
      ],

      [
        "Facebook",
        form.facebook_url,
      ],

      [
        "TikTok Shop",
        form.tiktok_url,
      ],

      [
        "Website",
        form.website_url,
      ],
    ];

    for (
      const [
        label,
        value,
      ]
      of urlFields
    ) {
      if (
        !isValidOptionalUrl(
          value
        )
      ) {
        return `${label} link is not a valid URL.`;
      }
    }

    return "";
  }

  /* =======================================================
     SAVE
  ======================================================= */

  async function handleSave() {
    setMessage("");

    const validation =
      validateForm();

    if (
      validation
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        validation
      );

      return;
    }

    if (
      !userId
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "User session is missing."
      );

      return;
    }

    setIsSaving(
      true
    );

    try {
      const payload = {
        user_id:
          userId,

        store_name:
          clean(
            form.store_name
          ),

        store_description:
          clean(
            form.store_description
          ) ||
          null,

        seller_mobile:
          clean(
            form.seller_mobile
          ),

        pickup_municipality:
          clean(
            form.pickup_municipality
          ),

        pickup_municipality_code:
          clean(
            form.pickup_municipality_code
          ) ||
          null,

        pickup_barangay:
          clean(
            form.pickup_barangay
          ),

        pickup_barangay_code:
          clean(
            form.pickup_barangay_code
          ) ||
          null,

        pickup_note:
          clean(
            form.pickup_note
          ) ||
          null,

        shopee_url:
          normalizeOptionalUrl(
            form.shopee_url
          ),

        lazada_url:
          normalizeOptionalUrl(
            form.lazada_url
          ),

        facebook_url:
          normalizeOptionalUrl(
            form.facebook_url
          ),

        tiktok_url:
          normalizeOptionalUrl(
            form.tiktok_url
          ),

        website_url:
          normalizeOptionalUrl(
            form.website_url
          ),

        is_active:
          Boolean(
            form.is_active
          ),
      };

      const {
        error,
      } =
        await supabase
          .from(
            "seller_profiles"
          )
          .upsert(
            payload,
            {
              onConflict:
                "user_id",
            }
          );

      if (
        error
      ) {
        throw error;
      }

      setMessageType(
        "success"
      );

      setMessage(
        "Seller profile saved successfully. These details are now shared with the mobile marketplace."
      );

      setLastUpdated(
        new Date()
      );
    } catch (
      error
    ) {
      console.error(
        "Seller profile save error:",
        error
      );

      setMessageType(
        "error"
      );

      const text =
        String(
          error?.message ||
            ""
        ).toLowerCase();

      if (
        text.includes(
          "row-level security"
        ) ||
        text.includes(
          "policy"
        )
      ) {
        setMessage(
          "Seller profile could not be saved because of a Supabase RLS policy."
        );
      } else {
        setMessage(
          error?.message ||
            "Unable to save seller profile."
        );
      }
    } finally {
      setIsSaving(
        false
      );
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    isLoading
  ) {
    return (
      <section className="seller-profile-loading">

        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading seller profile...
        </h3>

        <p>
          Getting your marketplace
          seller information.
        </p>

      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="seller-profile-page">

      {/* ===============================================
          HERO
      ================================================ */}

      <section className="seller-profile-hero">

        <div>

          <p className="dashboard-eyebrow">
            Marketplace
          </p>

          <h2>
            Seller Profile
          </h2>

          <p>
            Manage your seller
            identity, pickup
            information, contact
            details, and external
            online stores.
          </p>

          <div className="seller-profile-hero-actions">

            <button
              type="button"
              className="dashboard-primary-button"
              onClick={() =>
                loadPage(
                  true
                )
              }
              disabled={
                isRefreshing
              }
            >
              <RefreshCw
                size={18}
                className={
                  isRefreshing
                    ? "spin-icon"
                    : ""
                }
              />

              {isRefreshing
                ? "Refreshing..."
                : "Refresh"}
            </button>

            <span>
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString(
                    [],
                    {
                      hour:
                        "numeric",

                      minute:
                        "2-digit",
                    }
                  )}`
                : "Seller profile ready"}
            </span>

          </div>

        </div>

        <div className="seller-profile-hero-card">

          <Store
            size={34}
          />

          <strong>
            {form.store_name ||
              "Your Store"}
          </strong>

          <span>
            {form.is_active
              ? "Active Seller"
              : "Inactive Seller"}
          </span>

        </div>

      </section>

      {/* ===============================================
          MESSAGE
      ================================================ */}

      {message ? (
        <div
          className={`seller-profile-message ${messageType}`}
        >
          {messageType ===
          "success" ? (
            <CheckCircle2
              size={20}
            />
          ) : (
            <AlertCircle
              size={20}
            />
          )}

          <span>
            {message}
          </span>
        </div>
      ) : null}

      {/* ===============================================
          SELLER STATUS
      ================================================ */}

      <section className="seller-profile-panel">

        <div className="seller-profile-panel-heading">

          <div>

            <p className="dashboard-eyebrow">
              Seller Status
            </p>

            <h3>
              Marketplace visibility
            </h3>

            <p>
              Turn your seller
              profile on or off
              without deleting your
              saved information.
            </p>

          </div>

          <Power
            size={22}
          />

        </div>

        <div className="seller-profile-status-row">

          <div>

            <strong>
              Seller profile
            </strong>

            <span>
              {form.is_active
                ? "Your seller information can be used by Marketplace."
                : "Your seller profile is currently inactive."}
            </span>

          </div>

          <button
            type="button"
            aria-label="Toggle seller profile"
            className={`seller-profile-toggle ${
              form.is_active
                ? "active"
                : ""
            }`}
            onClick={() =>
              updateForm(
                "is_active",
                !form.is_active
              )
            }
          >
            <span />
          </button>

        </div>

      </section>

      {/* ===============================================
          GRID
      ================================================ */}

      <div className="seller-profile-grid">

        {/* STORE */}

        <section className="seller-profile-panel">

          <div className="seller-profile-panel-heading">

            <div>

              <p className="dashboard-eyebrow">
                Store
              </p>

              <h3>
                Store information
              </h3>

            </div>

            <Store
              size={22}
            />

          </div>

          <div className="seller-profile-form">

            <FormField
              label="Store Name"
              icon={
                ShoppingBag
              }
              required
            >
              <input
                type="text"
                value={
                  form.store_name
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "store_name",
                    event.target.value
                  )
                }
                placeholder="Example: Juan's Crayfish Farm"
              />
            </FormField>

            <FormField
              label="Store Description"
              icon={
                Store
              }
            >
              <textarea
                rows={5}
                value={
                  form.store_description
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "store_description",
                    event.target.value
                  )
                }
                placeholder="Tell buyers about your farm, products, or store."
              />
            </FormField>

          </div>

        </section>

        {/* ACCOUNT */}

        <section className="seller-profile-panel">

          <div className="seller-profile-panel-heading">

            <div>

              <p className="dashboard-eyebrow">
                Account
              </p>

              <h3>
                Seller identity
              </h3>

            </div>

            <UserRound
              size={22}
            />

          </div>

          <div className="seller-profile-readonly-list">

            <div>

              <UserRound
                size={18}
              />

              <span>

                <small>
                  Display Name
                </small>

                <strong>
                  {displayName}
                </strong>

              </span>

            </div>

            <div>

              <Mail
                size={18}
              />

              <span>

                <small>
                  Login Email
                </small>

                <strong>
                  {email ||
                    "No email"}
                </strong>

              </span>

            </div>

          </div>

          <div className="seller-profile-form seller-profile-form-spaced">

            <FormField
              label="Seller Mobile Number"
              icon={
                Phone
              }
              required
            >
              <input
                type="tel"
                value={
                  form.seller_mobile
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "seller_mobile",
                    mobileOnly(
                      event.target.value
                    )
                  )
                }
                placeholder="09XXXXXXXXX"
              />
            </FormField>

          </div>

        </section>

        {/* PICKUP */}

        <section className="seller-profile-panel">

          <div className="seller-profile-panel-heading">

            <div>

              <p className="dashboard-eyebrow">
                Pickup
              </p>

              <h3>
                Default pickup location
              </h3>

              <p>
                These details will
                automatically be
                available when
                creating marketplace
                listings.
              </p>

            </div>

            <MapPin
              size={22}
            />

          </div>

          <div className="seller-profile-form">

            <FormField
              label="City / Municipality"
              icon={
                MapPin
              }
              required
            >
              <select
                value={
                  selectedLocality
                    ?.code ||
                  form.pickup_municipality_code ||
                  ""
                }
                onChange={
                  handleMunicipalityChange
                }
                disabled={
                  loadingLocalities
                }
              >
                <option value="">
                  {loadingLocalities
                    ? "Loading locations..."
                    : "Select city or municipality"}
                </option>

                {localities.map(
                  (
                    locality
                  ) => (
                    <option
                      key={
                        locality.code
                      }
                      value={
                        locality.code
                      }
                    >
                      {
                        locality.name
                      }
                    </option>
                  )
                )}
              </select>
            </FormField>

            <FormField
              label="Barangay"
              icon={
                MapPin
              }
              required
            >
              <select
                value={
                  form.pickup_barangay_code ||
                  ""
                }
                onChange={
                  handleBarangayChange
                }
                disabled={
                  loadingBarangays ||
                  !form.pickup_municipality
                }
              >
                <option value="">
                  {loadingBarangays
                    ? "Loading barangays..."
                    : !form.pickup_municipality
                      ? "Select municipality first"
                      : "Select barangay"}
                </option>

                {barangays.map(
                  (
                    barangay
                  ) => (
                    <option
                      key={
                        barangay.code
                      }
                      value={
                        barangay.code
                      }
                    >
                      {
                        barangay.name
                      }
                    </option>
                  )
                )}
              </select>
            </FormField>

            <FormField
              label="Pickup Note"
              icon={
                MapPin
              }
            >
              <textarea
                rows={4}
                value={
                  form.pickup_note
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "pickup_note",
                    event.target.value
                  )
                }
                placeholder="Example: Pickup near barangay hall."
              />
            </FormField>

          </div>

        </section>

        {/* ===============================================
            ONLINE STORES
        ================================================ */}

        <section className="seller-profile-panel">

          <div className="seller-profile-panel-heading">

            <div>

              <p className="dashboard-eyebrow">
                External Shops
              </p>

              <h3>
                Online store links
              </h3>

              <p>
                Optional links buyers
                can use to visit your
                existing online
                stores.
              </p>

            </div>

            <Globe2
              size={22}
            />

          </div>

          <div className="seller-profile-form">

            {/* SHOPEE */}

            <FormField
              label="Shopee"
              icon={
                ShoppingBag
              }
            >
              <input
                type="url"
                value={
                  form.shopee_url
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "shopee_url",
                    event.target.value
                  )
                }
                placeholder="https://shopee.ph/your-store"
              />
            </FormField>

            {/* LAZADA */}

            <FormField
              label="Lazada"
              icon={
                ShoppingBag
              }
            >
              <input
                type="url"
                value={
                  form.lazada_url
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "lazada_url",
                    event.target.value
                  )
                }
                placeholder="https://www.lazada.com.ph/shop/your-store"
              />
            </FormField>

            {/* FACEBOOK */}

            <FormField
              label="Facebook"
              icon={
                Link2
              }
            >
              <input
                type="url"
                value={
                  form.facebook_url
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "facebook_url",
                    event.target.value
                  )
                }
                placeholder="https://facebook.com/your-page"
              />
            </FormField>

            {/* TIKTOK */}

            <FormField
              label="TikTok Shop"
              icon={
                Link2
              }
            >
              <input
                type="url"
                value={
                  form.tiktok_url
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "tiktok_url",
                    event.target.value
                  )
                }
                placeholder="https://www.tiktok.com/@your-store"
              />
            </FormField>

            {/* WEBSITE */}

            <FormField
              label="Website / Other Store"
              icon={
                Globe2
              }
            >
              <input
                type="url"
                value={
                  form.website_url
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "website_url",
                    event.target.value
                  )
                }
                placeholder="https://yourstore.com"
              />
            </FormField>

          </div>

        </section>

      </div>

      {/* ===============================================
          SAVE
      ================================================ */}

      <section className="seller-profile-save-bar">

        <div>

          <strong>
            Shared seller profile
          </strong>

          <span>
            Changes saved here use
            the same seller profile
            as your CrayThrive
            mobile app.
          </span>

        </div>

        <button
          type="button"
          className="dashboard-primary-button"
          disabled={
            isSaving
          }
          onClick={
            handleSave
          }
        >
          {isSaving ? (
            <Loader2
              size={18}
              className="spin-icon"
            />
          ) : (
            <Save
              size={18}
            />
          )}

          {isSaving
            ? "Saving..."
            : "Save Seller Profile"}
        </button>

      </section>

    </div>
  );
}

/* =========================================================
   FIELD
========================================================= */

function FormField({
  label,
  icon: Icon,
  required = false,
  children,
}) {
  return (
    <label className="seller-profile-field">

      <span className="seller-profile-field-label">

        <span>

          <Icon
            size={15}
          />

          {label}

        </span>

        {required ? (
          <small>
            Required
          </small>
        ) : (
          <small>
            Optional
          </small>
        )}

      </span>

      {children}

    </label>
  );
}
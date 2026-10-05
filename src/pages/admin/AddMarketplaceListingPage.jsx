import { logDiagnostic, getSafeErrorMessage } from "../../utils/securityDiagnostics";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ImagePlus,
  Loader2,
  MapPin,
  Package,
  Save,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
} from "lucide-react";

import {
  Link,
  useNavigate,
} from "react-router-dom";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import "../../styles/addMarketplaceListing.css";

/* =========================================================
   CONFIG
========================================================= */

const BUCKET_NAME =
  "marketplace-images";

const CATEGORY_OPTIONS = [
  {
    value: "crayfish",
    label: "Crayfish",
    description:
      "Juveniles, adults, breeders, and crayfish stock.",
  },
  {
    value: "feeds",
    label: "Feeds",
    description:
      "Pellets, custom feed, supplements, and feeding products.",
  },
  {
    value: "tanks_enclosures",
    label: "Tanks & Enclosures",
    description:
      "Tanks, shelters, hides, and enclosure accessories.",
  },
  {
    value: "water_care",
    label: "Water Care",
    description:
      "Conditioners, filter media, and water-maintenance products.",
  },
  {
    value: "test_kits",
    label: "Test Kits",
    description:
      "pH, ammonia, nitrite, nitrate, and other test kits.",
  },
  {
    value: "equipment",
    label: "Equipment",
    description:
      "Pumps, aerators, filters, sensors, and farming equipment.",
  },
  {
    value: "accessories",
    label: "Accessories",
    description:
      "Tubing, nets, containers, fittings, and other accessories.",
  },
  {
    value: "others",
    label: "Others",
    description:
      "Other products related to crayfish farming and aquaculture.",
  },
];

const SUBCATEGORY_OPTIONS = {
  crayfish: [
    "Juvenile",
    "Adult",
    "Breeder",
    "Mixed Stock",
    "Other Crayfish",
  ],

  feeds: [
    "Pellets",
    "Custom Feed",
    "Supplements",
    "Natural Feed",
    "Other Feed",
  ],

  tanks_enclosures: [
    "Tank",
    "PVC Hide",
    "Shelter",
    "Enclosure",
    "Tank Divider",
    "Other",
  ],

  water_care: [
    "Water Conditioner",
    "Filter Media",
    "Beneficial Bacteria",
    "Dechlorinator",
    "Cleaning Supply",
    "Other",
  ],

  test_kits: [
    "pH Test Kit",
    "Ammonia Test Kit",
    "Nitrite Test Kit",
    "Nitrate Test Kit",
    "Water Quality Kit",
    "Other",
  ],

  equipment: [
    "Water Pump",
    "Air Pump",
    "Aerator",
    "Filter",
    "Sensor",
    "Feeder",
    "Other",
  ],

  accessories: [
    "Tubing",
    "Net",
    "Container",
    "Fitting",
    "Hose",
    "Other",
  ],

  others: [
    "Custom Product",
    "Farm Supply",
    "Aquaculture Supply",
    "Other",
  ],
};

const CRAYFISH_TYPES = [
  "Redclaw Crayfish",
  "Redclaw Breeder Line",
  "Mixed Redclaw Sizes",
];

const STAGE_OPTIONS = [
  {
    value: "juvenile",
    label: "Juvenile",
  },
  {
    value: "adult",
    label: "Adult",
  },
  {
    value: "breeder",
    label: "Breeder",
  },
];

const SEX_OPTIONS = [
  {
    value: "unknown",
    label: "Unknown",
  },
  {
    value: "male",
    label: "Male",
  },
  {
    value: "female",
    label: "Female",
  },
  {
    value: "mixed",
    label: "Mixed",
  },
];

const UNIT_OPTIONS = [
  {
    value: "piece",
    label: "Piece",
  },
  {
    value: "set",
    label: "Set",
  },
  {
    value: "pack",
    label: "Pack",
  },
  {
    value: "bag",
    label: "Bag",
  },
  {
    value: "box",
    label: "Box",
  },
  {
    value: "kg",
    label: "Kilogram",
  },
  {
    value: "gram",
    label: "Gram",
  },
  {
    value: "liter",
    label: "Liter",
  },
];

const CONDITION_OPTIONS = [
  {
    value: "new",
    label: "New",
  },
  {
    value: "used",
    label: "Used",
  },
  {
    value: "refurbished",
    label: "Refurbished",
  },
  {
    value: "not_applicable",
    label: "Not Applicable",
  },
];

const EMPTY_FORM = {
  title: "",

  category:
    "crayfish",

  subcategory:
    "Juvenile",

  description:
    "",

  price:
    "",

  quantity:
    "1",

  unit:
    "piece",

  product_condition:
    "new",

  brand:
    "",

  sku:
    "",

  is_custom_product:
    false,

  crayfish_type:
    "Redclaw Crayfish",

  stage:
    "juvenile",

  sex:
    "unknown",

  size_label:
    "",

  seller_mobile:
    "",

  pickup_municipality:
    "",

  pickup_municipality_code:
    "",

  pickup_barangay:
    "",

  pickup_barangay_code:
    "",

  pickup_note:
    "",
};

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function numberOnly(value) {
  return String(
    value ?? ""
  )
    .replace(
      /[^0-9]/g,
      ""
    )
    .slice(
      0,
      8
    );
}

function moneyOnly(value) {
  const text =
    String(
      value ?? ""
    ).replace(
      /[^0-9.]/g,
      ""
    );

  const parts =
    text.split(".");

  if (
    parts.length <= 1
  ) {
    return text;
  }

  return `${
    parts[0]
  }.${parts
    .slice(1)
    .join("")
    .slice(0, 2)}`;
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

function buildLocation(form) {
  const barangay =
    clean(
      form.pickup_barangay
    );

  const municipality =
    clean(
      form.pickup_municipality
    );

  if (
    barangay &&
    municipality
  ) {
    return `${barangay}, ${municipality}, Bulacan`;
  }

  if (municipality) {
    return `${municipality}, Bulacan`;
  }

  return "Bulacan";
}

function getExtension(file) {
  const name =
    String(
      file?.name ||
        ""
    ).toLowerCase();

  const fromName =
    name.includes(".")
      ? name
          .split(".")
          .pop()
      : "";

  if (
    [
      "jpg",
      "jpeg",
      "png",
      "webp",
    ].includes(
      fromName
    )
  ) {
    return fromName ===
      "jpeg"
      ? "jpg"
      : fromName;
  }

  const type =
    String(
      file?.type ||
        ""
    ).toLowerCase();

  if (
    type.includes("png")
  ) {
    return "png";
  }

  if (
    type.includes("webp")
  ) {
    return "webp";
  }

  return "jpg";
}

function randomString() {
  return Math.random()
    .toString(36)
    .slice(2, 10);
}

function getCategoryLabel(
  value
) {
  return (
    CATEGORY_OPTIONS.find(
      (item) =>
        item.value === value
    )?.label ||
    "Marketplace Product"
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function AddMarketplaceListingPage() {
  const navigate =
    useNavigate();

  const [form, setForm] =
    useState(
      EMPTY_FORM
    );

  const [
    currentUser,
    setCurrentUser,
  ] = useState(null);

  const [
    sellerProfile,
    setSellerProfile,
  ] = useState(null);

  const [
    imageFile,
    setImageFile,
  ] = useState(null);

  const [
    imagePreview,
    setImagePreview,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    statusText,
    setStatusText,
  ] = useState("");

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    messageType,
    setMessageType,
  ] = useState(
    "error"
  );

  const isCrayfish =
    form.category ===
    "crayfish";

  const isBreeder =
    isCrayfish &&
    form.stage ===
      "breeder";

  const categoryInfo =
    useMemo(() => {
      return (
        CATEGORY_OPTIONS.find(
          (item) =>
            item.value ===
            form.category
        ) ||
        CATEGORY_OPTIONS[0]
      );
    }, [
      form.category,
    ]);

  const subcategories =
    SUBCATEGORY_OPTIONS[
      form.category
    ] || [];

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  async function loadInitialData() {
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
      setLoading(true);

      const {
        data: userData,
        error: userError,
      } =
        await supabase
          .auth
          .getUser();

      if (userError) {
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

      setSellerProfile(
        sellerData ||
          null
      );

      if (
        sellerData
      ) {
        setForm(
          (
            previous
          ) => ({
            ...previous,

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
          })
        );
      }
    } catch (
      error
    ) {
      logDiagnostic(
        "Add marketplace listing load error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        getSafeErrorMessage(error, "Unable to prepare the listing form.")
      );
    } finally {
      setLoading(false);
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

  function handleCategoryChange(
    event
  ) {
    const value =
      event.target.value;

    const nextSubcategories =
      SUBCATEGORY_OPTIONS[
        value
      ] || [];

    setForm(
      (
        previous
      ) => ({
        ...previous,

        category:
          value,

        subcategory:
          nextSubcategories[
            0
          ] || "",

        product_condition:
          value ===
          "crayfish"
            ? "not_applicable"
            : previous
                .product_condition ===
              "not_applicable"
              ? "new"
              : previous
                  .product_condition,

        unit:
          value ===
          "crayfish"
            ? "piece"
            : previous.unit,
      })
    );

    setMessage("");
  }

  function handleStageChange(
    value
  ) {
    setForm(
      (
        previous
      ) => {
        if (
          value ===
          "breeder"
        ) {
          return {
            ...previous,

            stage:
              "breeder",

            sex:
              "mixed",

            quantity:
              "3",

            unit:
              "set",

            subcategory:
              "Breeder",

            title:
              clean(
                previous.title
              )
                ? previous.title
                : "Redclaw Breeder Trio",

            crayfish_type:
              previous.crayfish_type ===
              "Redclaw Crayfish"
                ? "Redclaw Breeder Line"
                : previous.crayfish_type,
          };
        }

        return {
          ...previous,

          stage:
            value,

          subcategory:
            value ===
            "juvenile"
              ? "Juvenile"
              : "Adult",

          quantity:
            previous.stage ===
              "breeder" &&
            previous.quantity ===
              "3"
              ? "1"
              : previous.quantity,

          unit:
            previous.stage ===
              "breeder" &&
            previous.unit ===
              "set"
              ? "piece"
              : previous.unit,
        };
      }
    );
  }

  /* =======================================================
     IMAGE
  ======================================================= */

  function handleImageChange(
    event
  ) {
    const file =
      event.target.files?.[
        0
      ];

    if (!file) {
      return;
    }

    const allowed =
      [
        "image/jpeg",
        "image/png",
        "image/webp",
      ].includes(
        file.type
      );

    if (!allowed) {
      setMessageType(
        "error"
      );

      setMessage(
        "Please select a JPG, PNG, or WEBP image."
      );

      event.target.value =
        "";

      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "Listing image must be 5 MB or smaller."
      );

      event.target.value =
        "";

      return;
    }

    if (
      imagePreview
    ) {
      URL.revokeObjectURL(
        imagePreview
      );
    }

    setImageFile(
      file
    );

    setImagePreview(
      URL.createObjectURL(
        file
      )
    );

    setMessage("");
  }

  function removeImage() {
    if (
      imagePreview
    ) {
      URL.revokeObjectURL(
        imagePreview
      );
    }

    setImageFile(null);
    setImagePreview("");
  }

  async function uploadImage(
    userId
  ) {
    if (!imageFile) {
      return null;
    }

    setStatusText(
      "Uploading product image..."
    );

    const ext =
      getExtension(
        imageFile
      );

    const path =
      `${userId}/${Date.now()}-${randomString()}.${ext}`;

    const {
      error:
        uploadError,
    } =
      await supabase
        .storage
        .from(
          BUCKET_NAME
        )
        .upload(
          path,
          imageFile,
          {
            contentType:
              imageFile.type ||
              "image/jpeg",

            upsert:
              false,
          }
        );

    if (
      uploadError
    ) {
      throw new Error(
        uploadError.message ||
          "Unable to upload product image."
      );
    }

    const {
      data,
    } =
      supabase
        .storage
        .from(
          BUCKET_NAME
        )
        .getPublicUrl(
          path
        );

    return (
      data?.publicUrl ||
      null
    );
  }

  /* =======================================================
     VALIDATION
  ======================================================= */

  function validateForm() {
    if (
      !sellerProfile
    ) {
      return "Please create your Seller Profile before publishing a product.";
    }

    if (
      sellerProfile
        .is_active ===
      false
    ) {
      return "Your Seller Profile is inactive. Activate it first before publishing products.";
    }

    if (
      !clean(
        form.title
      )
    ) {
      return "Please enter a product title.";
    }

    if (
      !clean(
        form.category
      )
    ) {
      return "Please select a product category.";
    }

    if (
      !clean(
        form.subcategory
      )
    ) {
      return "Please select a subcategory.";
    }

    const quantity =
      Number(
        form.quantity
      );

    if (
      !Number.isFinite(
        quantity
      ) ||
      quantity < 1
    ) {
      return "Please enter a valid quantity.";
    }

    if (
      isBreeder &&
      quantity !== 3
    ) {
      return "Breeder listing must contain exactly 3 crayfish: 2 females and 1 male.";
    }

    const price =
      Number(
        form.price
      );

    if (
      !Number.isFinite(
        price
      ) ||
      price <= 0
    ) {
      return "Please enter a valid price.";
    }

    if (
      !clean(
        form.seller_mobile
      )
    ) {
      return "Seller mobile number is missing. Update your Seller Profile first.";
    }

    if (
      !clean(
        form.pickup_municipality
      ) ||
      !clean(
        form.pickup_barangay
      )
    ) {
      return "Pickup location is incomplete. Update your Seller Profile first.";
    }

    if (
      isCrayfish &&
      !clean(
        form.size_label
      )
    ) {
      return "Please enter the crayfish size.";
    }

    return "";
  }

  /* =======================================================
     PUBLISH
  ======================================================= */

  async function handlePublish(
    event
  ) {
    event.preventDefault();

    setMessage("");
    setStatusText("");

    const validation =
      validateForm();

    if (validation) {
      setMessageType(
        "error"
      );

      setMessage(
        validation
      );

      return;
    }

    if (
      !currentUser?.id
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "User session is missing."
      );

      return;
    }

    setSaving(true);

    try {
      const imageUrl =
        await uploadImage(
          currentUser.id
        );

      setStatusText(
        "Publishing product..."
      );

      const categoryLabel =
        getCategoryLabel(
          form.category
        );

      /*
        Legacy compatibility:
        Current mobile marketplace still expects
        crayfish_type, stage, sex and size_label.

        For non-crayfish products we temporarily
        store neutral compatibility values.
        Mobile will later be updated to ignore
        these fields outside the crayfish category.
      */

      const legacyCrayfishType =
        isCrayfish
          ? clean(
              form.crayfish_type
            )
          : categoryLabel;

      const legacyStage =
        isCrayfish
          ? form.stage
          : "adult";

      const legacySex =
        isCrayfish
          ? isBreeder
            ? "mixed"
            : form.sex
          : "unknown";

      const legacySize =
        isCrayfish
          ? clean(
              form.size_label
            )
          : clean(
              form.subcategory
            ) ||
            "Standard";

      const quantity =
        isBreeder
          ? 3
          : Math.floor(
              Number(
                form.quantity
              )
            );

      const payload = {
        seller_id:
          currentUser.id,

        title:
          clean(
            form.title
          ),

        category:
          form.category,

        subcategory:
          clean(
            form.subcategory
          ) ||
          null,

        description:
          clean(
            form.description
          ) ||
          null,

        price:
          Number(
            form.price
          ),

        quantity,

        unit:
          form.unit,

        product_condition:
          form.product_condition,

        brand:
          clean(
            form.brand
          ) ||
          null,

        sku:
          clean(
            form.sku
          ) ||
          null,

        is_custom_product:
          Boolean(
            form.is_custom_product
          ),

        crayfish_type:
          legacyCrayfishType,

        stage:
          legacyStage,

        sex:
          legacySex,

        size_label:
          legacySize,

        location:
          buildLocation(
            form
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

        seller_mobile:
          clean(
            form.seller_mobile
          ),

        image_url:
          imageUrl,

        status:
          "active",
      };

      const {
        error:
          insertError,
      } =
        await supabase
          .from(
            "marketplace_listings"
          )
          .insert(
            payload
          );

      if (
        insertError
      ) {
        throw insertError;
      }

      setMessageType(
        "success"
      );

      setMessage(
        "Product published successfully."
      );

      setStatusText("");

      setTimeout(() => {
        navigate(
          "/admin/marketplace"
        );
      }, 700);
    } catch (
      error
    ) {
      logDiagnostic(
        "Publish marketplace product error:",
        error
      );

      setMessageType(
        "error"
      );

      const text =
        String(
          getSafeErrorMessage(error, "")
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
          "Product could not be published because of a Supabase permission policy."
        );
      } else if (
        text.includes(
          "bucket"
        )
      ) {
        setMessage(
          "Product image could not be uploaded. Check the marketplace-images storage bucket."
        );
      } else {
        setMessage(
          getSafeErrorMessage(error, "Unable to publish this product.")
        );
      }
    } finally {
      setSaving(false);
      setStatusText("");
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <section className="add-market-loading">
        <Loader2
          size={34}
          className="spin-icon"
        />

        <h3>
          Preparing product form...
        </h3>

        <p>
          Loading your seller
          details.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="add-market-page">

      {/* HEADER */}

      <section className="add-market-header">
        <div>
          <Link
            to="/admin/marketplace"
            className="add-market-back"
          >
            <ArrowLeft
              size={16}
            />

            Marketplace
          </Link>

          <p className="dashboard-eyebrow">
            Seller Center
          </p>

          <h2>
            Sell a Product
          </h2>

          <p>
            Create a new
            CrayThrive marketplace
            listing for crayfish,
            feeds, equipment,
            accessories, and other
            aquaculture products.
          </p>
        </div>

        <div className="add-market-header-card">
          <ShoppingBag
            size={32}
          />

          <strong>
            {
              categoryInfo.label
            }
          </strong>

          <span>
            New marketplace
            listing
          </span>
        </div>
      </section>

      {/* SELLER WARNING */}

      {!sellerProfile ? (
        <div className="add-market-profile-warning">
          <AlertCircle
            size={20}
          />

          <div>
            <strong>
              Seller Profile
              required
            </strong>

            <span>
              Create your seller
              information first so
              buyers know how and
              where to contact you.
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
        </div>
      ) : sellerProfile
          .is_active ===
        false ? (
        <div className="add-market-profile-warning">
          <AlertCircle
            size={20}
          />

          <div>
            <strong>
              Seller Profile is
              inactive
            </strong>

            <span>
              Activate your seller
              profile before
              publishing products.
            </span>
          </div>

          <Link
            to="/admin/marketplace/seller-profile"
          >
            Manage Profile

            <ChevronRight
              size={16}
            />
          </Link>
        </div>
      ) : (
        <div className="add-market-profile-ready">
          <CheckCircle2
            size={20}
          />

          <div>
            <strong>
              Seller details loaded
            </strong>

            <span>
              {sellerProfile
                .store_name ||
                "CrayThrive Seller"}
              {" · "}
              {form.pickup_barangay},
              {" "}
              {form.pickup_municipality}
            </span>
          </div>

          <Link
            to="/admin/marketplace/seller-profile"
          >
            Edit Profile
          </Link>
        </div>
      )}

      {/* MESSAGE */}

      {message ? (
        <div
          className={`add-market-message ${messageType}`}
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

      <form
        onSubmit={
          handlePublish
        }
        className="add-market-form"
      >

        {/* PHOTO */}

        <section className="add-market-panel">
          <PanelHeading
            eyebrow="Photo"
            title="Product image"
            description="Add a clear image so buyers can identify the product."
            icon={
              ImagePlus
            }
          />

          <div className="add-market-image-area">
            {imagePreview ? (
              <div className="add-market-image-preview">
                <img
                  src={
                    imagePreview
                  }
                  alt="Product preview"
                />

                <button
                  type="button"
                  onClick={
                    removeImage
                  }
                >
                  <Trash2
                    size={16}
                  />

                  Remove
                </button>
              </div>
            ) : (
              <label className="add-market-image-empty">
                <ImagePlus
                  size={36}
                />

                <strong>
                  Add product
                  photo
                </strong>

                <span>
                  JPG, PNG or WEBP
                  up to 5 MB
                </span>

                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={
                    handleImageChange
                  }
                />
              </label>
            )}
          </div>

          {imagePreview ? (
            <label className="add-market-change-image">
              <ImagePlus
                size={16}
              />

              Change Image

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={
                  handleImageChange
                }
              />
            </label>
          ) : null}
        </section>

        {/* CATEGORY */}

        <section className="add-market-panel">
          <PanelHeading
            eyebrow="Category"
            title="What are you selling?"
            description="Choose the category that best describes your product."
            icon={Boxes}
          />

          <div className="add-market-category-grid">
            {CATEGORY_OPTIONS.map(
              (
                category
              ) => {
                const active =
                  form.category ===
                  category.value;

                return (
                  <button
                    key={
                      category.value
                    }
                    type="button"
                    className={`add-market-category-card ${
                      active
                        ? "active"
                        : ""
                    }`}
                    onClick={() =>
                      handleCategoryChange(
                        {
                          target:
                            {
                              value:
                                category.value,
                            },
                        }
                      )
                    }
                  >
                    <ShoppingBag
                      size={20}
                    />

                    <strong>
                      {
                        category.label
                      }
                    </strong>

                    <span>
                      {
                        category.description
                      }
                    </span>
                  </button>
                );
              }
            )}
          </div>

          <div className="add-market-fields two-columns">
            <Field
              label="Category"
              icon={
                Boxes
              }
              required
            >
              <select
                value={
                  form.category
                }
                onChange={
                  handleCategoryChange
                }
              >
                {CATEGORY_OPTIONS.map(
                  (
                    item
                  ) => (
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
            </Field>

            <Field
              label="Subcategory"
              icon={
                Tag
              }
              required
            >
              <select
                value={
                  form.subcategory
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "subcategory",
                    event.target.value
                  )
                }
              >
                {subcategories.map(
                  (
                    item
                  ) => (
                    <option
                      key={
                        item
                      }
                      value={
                        item
                      }
                    >
                      {item}
                    </option>
                  )
                )}
              </select>
            </Field>
          </div>
        </section>

        {/* PRODUCT */}

        <section className="add-market-panel">
          <PanelHeading
            eyebrow="Product"
            title="Product information"
            description="Provide the main details buyers will see in Marketplace."
            icon={Package}
          />

          <div className="add-market-fields">

            <Field
              label="Product Title"
              icon={
                Tag
              }
              required
            >
              <input
                type="text"
                value={
                  form.title
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "title",
                    event.target.value
                  )
                }
                placeholder={
                  isCrayfish
                    ? "Example: Redclaw Juveniles"
                    : "Example: Premium Crayfish Pellet Feed"
                }
              />
            </Field>

            <div className="add-market-fields three-columns">
              <Field
                label="Price"
                icon={
                  CircleDollarSign
                }
                required
              >
                <div className="add-market-money">
                  <span>
                    ₱
                  </span>

                  <input
                    type="text"
                    inputMode="decimal"
                    value={
                      form.price
                    }
                    onChange={(
                      event
                    ) =>
                      updateForm(
                        "price",
                        moneyOnly(
                          event
                            .target
                            .value
                        )
                      )
                    }
                    placeholder="0.00"
                  />
                </div>
              </Field>

              <Field
                label="Quantity"
                icon={
                  Package
                }
                required
              >
                <input
                  type="text"
                  inputMode="numeric"
                  value={
                    form.quantity
                  }
                  disabled={
                    isBreeder
                  }
                  onChange={(
                    event
                  ) =>
                    updateForm(
                      "quantity",
                      numberOnly(
                        event
                          .target
                          .value
                      )
                    )
                  }
                  placeholder="1"
                />
              </Field>

              <Field
                label="Unit"
                icon={
                  Package
                }
                required
              >
                <select
                  value={
                    form.unit
                  }
                  onChange={(
                    event
                  ) =>
                    updateForm(
                      "unit",
                      event.target.value
                    )
                  }
                >
                  {UNIT_OPTIONS.map(
                    (
                      item
                    ) => (
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
              </Field>
            </div>

            {!isCrayfish ? (
              <div className="add-market-fields two-columns">
                <Field
                  label="Condition"
                  icon={
                    Package
                  }
                >
                  <select
                    value={
                      form.product_condition
                    }
                    onChange={(
                      event
                    ) =>
                      updateForm(
                        "product_condition",
                        event.target.value
                      )
                    }
                  >
                    {CONDITION_OPTIONS.map(
                      (
                        item
                      ) => (
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
                </Field>

                <Field
                  label="Brand"
                  icon={
                    Store
                  }
                >
                  <input
                    type="text"
                    value={
                      form.brand
                    }
                    onChange={(
                      event
                    ) =>
                      updateForm(
                        "brand",
                        event.target.value
                      )
                    }
                    placeholder="Optional brand name"
                  />
                </Field>
              </div>
            ) : null}

            {!isCrayfish ? (
              <div className="add-market-fields two-columns">
                <Field
                  label="SKU / Product Code"
                  icon={
                    Tag
                  }
                >
                  <input
                    type="text"
                    value={
                      form.sku
                    }
                    onChange={(
                      event
                    ) =>
                      updateForm(
                        "sku",
                        event.target.value
                      )
                    }
                    placeholder="Optional product code"
                  />
                </Field>

                <label className="add-market-checkbox">
                  <input
                    type="checkbox"
                    checked={
                      form.is_custom_product
                    }
                    onChange={(
                      event
                    ) =>
                      updateForm(
                        "is_custom_product",
                        event.target.checked
                      )
                    }
                  />

                  <span>
                    <strong>
                      Custom product
                    </strong>

                    <small>
                      Enable if the
                      seller makes
                      this product to
                      order.
                    </small>
                  </span>
                </label>
              </div>
            ) : null}

            <Field
              label="Description"
              icon={
                ShoppingBag
              }
            >
              <textarea
                rows={5}
                value={
                  form.description
                }
                onChange={(
                  event
                ) =>
                  updateForm(
                    "description",
                    event.target.value
                  )
                }
                placeholder="Describe the product, important details, inclusions, and other information buyers should know."
              />
            </Field>

          </div>
        </section>

        {/* CRAYFISH FIELDS */}

        {isCrayfish ? (
          <section className="add-market-panel">
            <PanelHeading
              eyebrow="Crayfish"
              title="Crayfish details"
              description="These fields apply only to live crayfish listings."
              icon={
                ShoppingBag
              }
            />

            <div className="add-market-fields">

              <Field
                label="Crayfish Type"
                icon={
                  ShoppingBag
                }
                required
              >
                <select
                  value={
                    form.crayfish_type
                  }
                  onChange={(
                    event
                  ) =>
                    updateForm(
                      "crayfish_type",
                      event.target.value
                    )
                  }
                >
                  {CRAYFISH_TYPES.map(
                    (
                      item
                    ) => (
                      <option
                        key={
                          item
                        }
                        value={
                          item
                        }
                      >
                        {item}
                      </option>
                    )
                  )}
                </select>
              </Field>

              <div className="add-market-fields three-columns">

                <Field
                  label="Stage"
                  icon={
                    Tag
                  }
                  required
                >
                  <select
                    value={
                      form.stage
                    }
                    onChange={(
                      event
                    ) =>
                      handleStageChange(
                        event.target.value
                      )
                    }
                  >
                    {STAGE_OPTIONS.map(
                      (
                        item
                      ) => (
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
                </Field>

                <Field
                  label="Sex"
                  icon={
                    Tag
                  }
                  required
                >
                  <select
                    value={
                      form.sex
                    }
                    disabled={
                      isBreeder
                    }
                    onChange={(
                      event
                    ) =>
                      updateForm(
                        "sex",
                        event.target.value
                      )
                    }
                  >
                    {SEX_OPTIONS.map(
                      (
                        item
                      ) => (
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
                </Field>

                <Field
                  label="Size"
                  icon={
                    Package
                  }
                  required
                >
                  <input
                    type="text"
                    value={
                      form.size_label
                    }
                    onChange={(
                      event
                    ) =>
                      updateForm(
                        "size_label",
                        event.target.value
                      )
                    }
                    placeholder="Example: 1 inch"
                  />
                </Field>

              </div>

              {isBreeder ? (
                <div className="add-market-breeder-note">
                  <CheckCircle2
                    size={18}
                  />

                  <div>
                    <strong>
                      Breeder Trio
                    </strong>

                    <span>
                      Quantity is
                      automatically
                      fixed to 3:
                      2 females and
                      1 male.
                    </span>
                  </div>
                </div>
              ) : null}

            </div>
          </section>
        ) : null}

        {/* SELLER */}

        <section className="add-market-panel">
          <PanelHeading
            eyebrow="Seller"
            title="Pickup & contact"
            description="Loaded automatically from your shared Seller Profile."
            icon={MapPin}
          />

          <div className="add-market-readonly-grid">

            <ReadOnlyField
              label="Store"
              value={
                sellerProfile
                  ?.store_name ||
                "Not set"
              }
            />

            <ReadOnlyField
              label="Mobile"
              value={
                form.seller_mobile ||
                "Not set"
              }
            />

            <ReadOnlyField
              label="Municipality"
              value={
                form.pickup_municipality ||
                "Not set"
              }
            />

            <ReadOnlyField
              label="Barangay"
              value={
                form.pickup_barangay ||
                "Not set"
              }
            />

          </div>

          {form.pickup_note ? (
            <div className="add-market-pickup-note">
              <MapPin
                size={17}
              />

              <div>
                <strong>
                  Pickup note
                </strong>

                <span>
                  {
                    form.pickup_note
                  }
                </span>
              </div>
            </div>
          ) : null}

          <Link
            to="/admin/marketplace/seller-profile"
            className="add-market-edit-profile"
          >
            Edit Seller Profile

            <ChevronRight
              size={16}
            />
          </Link>
        </section>

        {/* ACTIONS */}

        <section className="add-market-actions">

          <div>
            <strong>
              Ready to publish?
            </strong>

            <span>
              The product will
              immediately appear as
              an active Marketplace
              listing.
            </span>
          </div>

          <div className="add-market-action-buttons">
            <button
              type="button"
              className="add-market-secondary"
              disabled={
                saving
              }
              onClick={() =>
                navigate(
                  "/admin/marketplace"
                )
              }
            >
              Cancel
            </button>

            <button
              type="submit"
              className="dashboard-primary-button"
              disabled={
                saving ||
                !sellerProfile ||
                sellerProfile
                  ?.is_active ===
                  false
              }
            >
              {saving ? (
                <Loader2
                  size={18}
                  className="spin-icon"
                />
              ) : (
                <Save
                  size={18}
                />
              )}

              {saving
                ? statusText ||
                  "Publishing..."
                : "Publish Product"}
            </button>
          </div>

        </section>

      </form>
    </div>
  );
}

/* =========================================================
   SMALL COMPONENTS
========================================================= */

function PanelHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
}) {
  return (
    <div className="add-market-panel-heading">
      <div>
        <p className="dashboard-eyebrow">
          {eyebrow}
        </p>

        <h3>
          {title}
        </h3>

        <p>
          {description}
        </p>
      </div>

      <Icon
        size={22}
      />
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  required = false,
  children,
}) {
  return (
    <label className="add-market-field">
      <span className="add-market-field-label">
        <span>
          <Icon
            size={15}
          />

          {label}
        </span>

        <small>
          {required
            ? "Required"
            : "Optional"}
        </small>
      </span>

      {children}
    </label>
  );
}

function ReadOnlyField({
  label,
  value,
}) {
  return (
    <div className="add-market-readonly">
      <small>
        {label}
      </small>

      <strong>
        {value}
      </strong>
    </div>
  );
}

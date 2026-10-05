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
  ImagePlus,
  Loader2,
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
  useParams,
} from "react-router-dom";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import "../../styles/editMarketplaceListing.css";

const BUCKET_NAME =
  "marketplace-images";

/* =========================================================
   OPTIONS
========================================================= */

const CATEGORY_OPTIONS = [
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
  "piece",
  "set",
  "pack",
  "bag",
  "box",
  "kg",
  "gram",
  "liter",
];

const CONDITION_OPTIONS = [
  "new",
  "used",
  "refurbished",
  "not_applicable",
];

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function formatFriendlyText(value) {
  return clean(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase()
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

function getExtension(file) {
  const name =
    clean(
      file?.name
    ).toLowerCase();

  const ext =
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
    ].includes(ext)
  ) {
    return ext ===
      "jpeg"
      ? "jpg"
      : ext;
  }

  return "jpg";
}

function randomString() {
  return Math.random()
    .toString(36)
    .slice(2, 10);
}

/* =========================================================
   PAGE
========================================================= */

export default function EditMarketplaceListingPage() {
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
    form,
    setForm,
  ] = useState({
    title: "",
    category:
      "crayfish",
    subcategory:
      "Juvenile",

    price: "",
    quantity: "1",
    unit: "piece",

    description: "",

    brand: "",
    sku: "",

    product_condition:
      "new",

    is_custom_product:
      false,

    crayfish_type:
      "Redclaw Crayfish",

    stage:
      "juvenile",

    sex:
      "unknown",

    size_label: "",
  });

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
    message,
    setMessage,
  ] = useState("");

  const [
    messageType,
    setMessageType,
  ] = useState("error");

  const isCrayfish =
    form.category ===
    "crayfish";

  const isBreeder =
    isCrayfish &&
    form.stage ===
      "breeder";

  const subcategories =
    useMemo(() => {
      return (
        SUBCATEGORY_OPTIONS[
          form.category
        ] || []
      );
    }, [
      form.category,
    ]);

  useEffect(() => {
    loadListing();
  }, [
    listingId,
  ]);

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  async function loadListing() {
    if (
      !isSupabaseConfigured ||
      !supabase
    ) {
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
          "Product was not found."
        );
      }

      if (
        listingData.seller_id !==
        user.id
      ) {
        throw new Error(
          "You cannot edit another seller's product."
        );
      }

      if (
        [
          "reserved",
          "sold",
          "deleted",
        ].includes(
          String(
            listingData.status ||
              ""
          ).toLowerCase()
        )
      ) {
        throw new Error(
          "Reserved or sold products cannot be edited."
        );
      }

      setListing(
        listingData
      );

      const category =
        clean(
          listingData.category
        ) ||
        "crayfish";

      setForm({
        title:
          listingData.title ||
          "",

        category,

        subcategory:
          listingData.subcategory ||
          formatFriendlyText(
            listingData.stage ||
              "Juvenile"
          ),

        price:
          String(
            listingData.price ??
              ""
          ),

        quantity:
          String(
            listingData.quantity ??
              1
          ),

        unit:
          listingData.unit ||
          (category ===
          "crayfish"
            ? "piece"
            : "piece"),

        description:
          listingData.description ||
          "",

        brand:
          listingData.brand ||
          "",

        sku:
          listingData.sku ||
          "",

        product_condition:
          listingData.product_condition ||
          (category ===
          "crayfish"
            ? "not_applicable"
            : "new"),

        is_custom_product:
          Boolean(
            listingData.is_custom_product
          ),

        crayfish_type:
          listingData.crayfish_type ||
          "Redclaw Crayfish",

        stage:
          listingData.stage ||
          "juvenile",

        sex:
          listingData.sex ||
          "unknown",

        size_label:
          listingData.size_label ||
          "",
      });

      const {
        data:
          sellerData,
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

      setSeller(
        sellerData ||
          null
      );
    } catch (
      error
    ) {
      logDiagnostic(
        "Edit marketplace load error:",
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
    }
  }

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
    const category =
      event.target.value;

    const nextOptions =
      SUBCATEGORY_OPTIONS[
        category
      ] || [];

    setForm(
      (
        previous
      ) => ({
        ...previous,

        category,

        subcategory:
          nextOptions[0] ||
          "",

        product_condition:
          category ===
          "crayfish"
            ? "not_applicable"
            : previous.product_condition ===
                "not_applicable"
              ? "new"
              : previous.product_condition,
      })
    );
  }

  function handleStageChange(
    stage
  ) {
    setForm(
      (
        previous
      ) => {
        if (
          stage ===
          "breeder"
        ) {
          return {
            ...previous,

            stage:
              "breeder",

            subcategory:
              "Breeder",

            quantity:
              "3",

            unit:
              "set",

            sex:
              "mixed",
          };
        }

        return {
          ...previous,

          stage,

          subcategory:
            stage ===
            "juvenile"
              ? "Juvenile"
              : "Adult",

          sex:
            previous.sex ===
            "mixed"
              ? "unknown"
              : previous.sex,

          quantity:
            previous.stage ===
              "breeder"
              ? "1"
              : previous.quantity,

          unit:
            previous.stage ===
              "breeder"
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

    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
      ].includes(
        file.type
      )
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "Please choose JPG, PNG, or WEBP."
      );

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
        "Image must be 5 MB or smaller."
      );

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
  }

  function removeNewImage() {
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

  async function uploadNewImage() {
    if (
      !imageFile ||
      !currentUser?.id
    ) {
      return (
        listing?.image_url ||
        null
      );
    }

    const ext =
      getExtension(
        imageFile
      );

    const path =
      `${currentUser.id}/${Date.now()}-${randomString()}.${ext}`;

    const {
      error,
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

    if (error) {
      throw error;
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
      listing?.image_url ||
      null
    );
  }

  /* =======================================================
     SAVE
  ======================================================= */

  function validate() {
    if (
      !clean(
        form.title
      )
    ) {
      return "Product title is required.";
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
      return "Enter a valid product price.";
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
      return "Enter a valid quantity.";
    }

    if (
      isBreeder &&
      quantity !== 3
    ) {
      return "Breeder listing must contain exactly 3 crayfish.";
    }

    if (
      isCrayfish &&
      !clean(
        form.size_label
      )
    ) {
      return "Crayfish size is required.";
    }

    return "";
  }

  async function handleSave(
    event
  ) {
    event.preventDefault();

    setMessage("");

    const validation =
      validate();

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

    setSaving(true);

    try {
      const imageUrl =
        await uploadNewImage();

      const categoryLabel =
        CATEGORY_OPTIONS.find(
          (item) =>
            item.value ===
            form.category
        )?.label ||
        "Marketplace Product";

      /*
        Maintain compatibility with the
        existing mobile marketplace while
        mobile is still crayfish-focused.
      */

      const payload = {
        title:
          clean(
            form.title
          ),

        category:
          form.category,

        subcategory:
          clean(
            form.subcategory
          ),

        price:
          Number(
            form.price
          ),

        quantity:
          isBreeder
            ? 3
            : Math.floor(
                Number(
                  form.quantity
                )
              ),

        unit:
          form.unit,

        description:
          clean(
            form.description
          ) ||
          null,

        brand:
          !isCrayfish
            ? clean(
                form.brand
              ) ||
              null
            : null,

        sku:
          !isCrayfish
            ? clean(
                form.sku
              ) ||
              null
            : null,

        product_condition:
          isCrayfish
            ? "not_applicable"
            : form.product_condition,

        is_custom_product:
          !isCrayfish &&
          Boolean(
            form.is_custom_product
          ),

        crayfish_type:
          isCrayfish
            ? clean(
                form.crayfish_type
              )
            : categoryLabel,

        stage:
          isCrayfish
            ? form.stage
            : "adult",

        sex:
          isCrayfish
            ? isBreeder
              ? "mixed"
              : form.sex
            : "unknown",

        size_label:
          isCrayfish
            ? clean(
                form.size_label
              )
            : clean(
                form.subcategory
              ) ||
              "Standard",

        image_url:
          imageUrl,

        /*
          Refresh listing contact/location
          using latest Seller Profile values
          whenever the seller edits a product.
        */

        seller_mobile:
          seller?.seller_mobile ||
          listing.seller_mobile,

        pickup_municipality:
          seller
            ?.pickup_municipality ||
          listing
            .pickup_municipality,

        pickup_municipality_code:
          seller
            ?.pickup_municipality_code ||
          listing
            .pickup_municipality_code ||
          null,

        pickup_barangay:
          seller
            ?.pickup_barangay ||
          listing
            .pickup_barangay,

        pickup_barangay_code:
          seller
            ?.pickup_barangay_code ||
          listing
            .pickup_barangay_code ||
          null,

        location:
          [
            seller
              ?.pickup_barangay ||
              listing
                .pickup_barangay,

            seller
              ?.pickup_municipality ||
              listing
                .pickup_municipality,
          ]
            .filter(Boolean)
            .join(", ")
            ? `${[
                seller
                  ?.pickup_barangay ||
                  listing
                    .pickup_barangay,

                seller
                  ?.pickup_municipality ||
                  listing
                    .pickup_municipality,
              ]
                .filter(
                  Boolean
                )
                .join(
                  ", "
                )}, Bulacan`
            : listing.location,
      };

      const {
        error,
      } =
        await supabase
          .from(
            "marketplace_listings"
          )
          .update(
            payload
          )
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
        "Product updated successfully."
      );

      setTimeout(() => {
        navigate(
          `/admin/marketplace/${listing.id}`
        );
      }, 500);
    } catch (
      error
    ) {
      logDiagnostic(
        "Marketplace update error:",
        error
      );

      setMessageType(
        "error"
      );

      setMessage(
        getSafeErrorMessage(error, "Unable to update this product.")
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="edit-market-loading">
        <Loader2
          size={34}
          className="spin-icon"
        />

        <h3>
          Loading product...
        </h3>
      </section>
    );
  }

  if (
    !listing
  ) {
    return (
      <section className="edit-market-error">
        <AlertCircle
          size={34}
        />

        <h3>
          Product cannot be edited
        </h3>

        <p>
          {message}
        </p>

        <Link
          to="/admin/marketplace"
          className="dashboard-primary-button"
        >
          Back to Marketplace
        </Link>
      </section>
    );
  }

  return (
    <div className="edit-market-page">

      {/* HERO */}

      <section className="edit-market-hero">

        <div>
          <Link
            to={`/admin/marketplace/${listing.id}`}
            className="edit-market-back"
          >
            <ArrowLeft
              size={16}
            />

            Product Details
          </Link>

          <p className="dashboard-eyebrow">
            Seller Center
          </p>

          <h2>
            Edit Product
          </h2>

          <p>
            Update product
            information, stock,
            pricing, image, and
            marketplace details.
          </p>
        </div>

        <div className="edit-market-hero-card">
          <ShoppingBag
            size={32}
          />

          <strong>
            {form.title ||
              "Product"}
          </strong>

          <span>
            Editing listing
          </span>
        </div>

      </section>

      {message ? (
        <div
          className={`edit-market-message ${messageType}`}
        >
          {messageType ===
          "success" ? (
            <CheckCircle2
              size={18}
            />
          ) : (
            <AlertCircle
              size={18}
            />
          )}

          {message}
        </div>
      ) : null}

      <form
        onSubmit={
          handleSave
        }
        className="edit-market-form"
      >

        {/* IMAGE */}

        <section className="edit-market-panel">

          <SectionHeading
            icon={
              ImagePlus
            }
            eyebrow="Photo"
            title="Product Image"
          />

          <div className="edit-market-image">

            {imagePreview ||
            listing.image_url ? (
              <img
                src={
                  imagePreview ||
                  listing.image_url
                }
                alt="Product"
              />
            ) : (
              <div className="edit-market-image-empty">
                <ShoppingBag
                  size={40}
                />

                No image
              </div>
            )}

          </div>

          <div className="edit-market-image-actions">

            <label>
              <ImagePlus
                size={16}
              />

              Choose New Image

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={
                  handleImageChange
                }
              />
            </label>

            {imagePreview ? (
              <button
                type="button"
                onClick={
                  removeNewImage
                }
              >
                <Trash2
                  size={16}
                />

                Cancel New Image
              </button>
            ) : null}

          </div>

        </section>

        {/* CATEGORY */}

        <section className="edit-market-panel">

          <SectionHeading
            icon={Boxes}
            eyebrow="Category"
            title="Product Category"
          />

          <div className="edit-market-fields two">

            <Field
              label="Category"
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

        <section className="edit-market-panel">

          <SectionHeading
            icon={Package}
            eyebrow="Product"
            title="Product Information"
          />

          <div className="edit-market-fields">

            <Field
              label="Product Title"
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
              />
            </Field>

            <div className="edit-market-fields three">

              <Field
                label="Price"
                required
              >
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
                        event.target.value
                      )
                    )
                  }
                />
              </Field>

              <Field
                label="Quantity"
                required
              >
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={
                    isBreeder
                  }
                  value={
                    form.quantity
                  }
                  onChange={(
                    event
                  ) =>
                    updateForm(
                      "quantity",
                      numberOnly(
                        event.target.value
                      )
                    )
                  }
                />
              </Field>

              <Field
                label="Unit"
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
                          item
                        }
                        value={
                          item
                        }
                      >
                        {formatFriendlyText(
                          item
                        )}
                      </option>
                    )
                  )}
                </select>
              </Field>

            </div>

            {!isCrayfish ? (
              <div className="edit-market-fields two">

                <Field
                  label="Brand"
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
                  />
                </Field>

                <Field
                  label="Condition"
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
                            item
                          }
                          value={
                            item
                          }
                        >
                          {formatFriendlyText(
                            item
                          )}
                        </option>
                      )
                    )}
                  </select>
                </Field>

                <Field
                  label="SKU"
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
                  />
                </Field>

                <label className="edit-market-checkbox">
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
                      Custom Product
                    </strong>

                    <small>
                      Product may be
                      made to order.
                    </small>
                  </span>
                </label>

              </div>
            ) : null}

            <Field
              label="Description"
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
              />
            </Field>

          </div>

        </section>

        {/* CRAYFISH */}

        {isCrayfish ? (
          <section className="edit-market-panel">

            <SectionHeading
              icon={
                ShoppingBag
              }
              eyebrow="Crayfish"
              title="Crayfish Information"
            />

            <div className="edit-market-fields">

              <Field
                label="Crayfish Type"
                required
              >
                <input
                  type="text"
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
                />
              </Field>

              <div className="edit-market-fields three">

                <Field
                  label="Stage"
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
                  required
                >
                  <select
                    disabled={
                      isBreeder
                    }
                    value={
                      form.sex
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
                  />
                </Field>

              </div>

            </div>

          </section>
        ) : null}

        {/* SELLER */}

        <section className="edit-market-panel">

          <SectionHeading
            icon={Store}
            eyebrow="Seller"
            title="Seller Information"
          />

          <div className="edit-market-seller">

            <div>
              <small>
                Store
              </small>

              <strong>
                {seller?.store_name ||
                  "Marketplace Seller"}
              </strong>
            </div>

            <div>
              <small>
                Mobile
              </small>

              <strong>
                {seller?.seller_mobile ||
                  listing.seller_mobile ||
                  "Not set"}
              </strong>
            </div>

            <div>
              <small>
                Pickup
              </small>

              <strong>
                {[
                  seller
                    ?.pickup_barangay ||
                    listing
                      .pickup_barangay,

                  seller
                    ?.pickup_municipality ||
                    listing
                      .pickup_municipality,
                ]
                  .filter(Boolean)
                  .join(", ") ||
                  "Not set"}
              </strong>
            </div>

          </div>

          <p className="edit-market-seller-note">
            Seller contact and
            pickup information are
            synced from Seller
            Profile when this
            product is saved.
          </p>

        </section>

        {/* SAVE */}

        <section className="edit-market-actions">

          <Link
            to={`/admin/marketplace/${listing.id}`}
          >
            Cancel
          </Link>

          <button
            type="submit"
            className="dashboard-primary-button"
            disabled={
              saving
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
              ? "Saving..."
              : "Save Changes"}
          </button>

        </section>

      </form>

    </div>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
}) {
  return (
    <div className="edit-market-panel-heading">

      <div>
        <p className="dashboard-eyebrow">
          {eyebrow}
        </p>

        <h3>
          {title}
        </h3>
      </div>

      <Icon
        size={21}
      />

    </div>
  );
}

function Field({
  label,
  required = false,
  children,
}) {
  return (
    <label className="edit-market-field">

      <span>
        <strong>
          {label}
        </strong>

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

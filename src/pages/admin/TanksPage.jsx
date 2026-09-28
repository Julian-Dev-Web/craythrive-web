import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  Droplets,
  Filter,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  Thermometer,
  UserRound,
  Waves,
} from "lucide-react";

import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  evaluateReadingSafety,
  loadActiveThresholds,
} from "../../utils/thresholdEvaluation";
import {
  formatReadingTime,
  normalizeSensorReading,
} from "../../utils/sensorReadingUtils";

/* =========================================================
   TABLES / DATABASE CONFIG
========================================================= */

const tankTables = ["tanks", "user_tanks", "tank_profiles"];
const readingTables = ["sensor_readings", "tank_readings", "readings"];
const ammoniaTables = ["ammonia_readings"];

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
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

function normalizeStatusText(value) {
  return lower(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}

function formatFriendlyText(value) {
  const text = clean(value);

  if (!text) {
    return "No Reading";
  }

  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function toNumberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue)
    ? numberValue
    : null;
}

function getPhNumericLabel(reading) {
  const raw =
    reading?.ph_value ??
    reading?.ph;

  const numberValue =
    Number(raw);

  return Number.isFinite(numberValue)
    ? numberValue.toFixed(1)
    : null;
}

/* =========================================================
   STATUS HELPERS
========================================================= */

function getStatusSeverity(statuses) {
  const joined =
    statuses
      .map(normalizeStatusText)
      .join(" ");

  if (
    joined.includes("critical") ||
    joined.includes("danger") ||
    joined.includes("unsafe") ||
    joined.includes("high ph") ||
    joined.includes("low ph") ||
    joined.includes("warm") ||
    joined.includes("cold")
  ) {
    return "critical";
  }

  if (
    joined.includes("warning") ||
    joined.includes("dirty") ||
    joined.includes("slightly") ||
    joined.includes("needs") ||
    joined.includes("moderate")
  ) {
    return "warning";
  }

  return "normal";
}

function getOverallReadingStatus(
  normalizedReading
) {
  return getStatusSeverity([
    normalizedReading.temperatureStatus,
    normalizedReading.phStatus,
    normalizedReading.turbidityStatus,
    normalizedReading.waterStatus,
  ]);
}

function getFriendlyTankStatus(status) {
  switch (status) {
    case "critical":
      return "Urgent";

    case "warning":
      return "Check";

    case "no-data":
      return "No Data";

    default:
      return "Good";
  }
}

/* =========================================================
   TANK / READING HELPERS
========================================================= */

function getTankId(tank, index) {
  return (
    tank?.id ||
    tank?.tank_id ||
    tank?.uuid ||
    `tank-${index}`
  );
}

function getTankName(tank, index) {
  return (
    tank?.name ||
    tank?.tank_name ||
    tank?.title ||
    tank?.label ||
    `Tank ${index + 1}`
  );
}

function getTankType(tank) {
  return (
    tank?.type ||
    tank?.tank_type ||
    tank?.category ||
    "Crayfish Tank"
  );
}

function getTankOwnerId(tank) {
  return (
    tank?.user_id ||
    tank?.owner_id ||
    tank?.profile_id ||
    tank?.created_by ||
    tank?.farmer_id ||
    ""
  );
}

function getProfileName(profile) {
  return (
    profile?.username ||
    profile?.full_name ||
    [
      profile?.first_name,
      profile?.last_name,
    ]
      .filter(Boolean)
      .join(" ") ||
    profile?.email ||
    "Unknown owner"
  );
}

function getTankMatchKeys(tank) {
  return [
    tank?.id,
    tank?.tank_id,
    tank?.uuid,
    tank?.iot_device_id,
    tank?.device_id,
    tank?.device_uid,
    tank?.tank_code,
  ]
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== ""
    )
    .map(String);
}

function getReadingMatchKeys(reading) {
  return [
    reading?.tank_id,
    reading?.tankId,
    reading?.tank_uuid,
    reading?.tank_profile_id,
    reading?.iot_device_id,
    reading?.device_id,
    reading?.device_uid,
  ]
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== ""
    )
    .map(String);
}

function getReadingDate(reading) {
  return (
    reading?.created_at ||
    reading?.timestamp ||
    reading?.date ||
    reading?.updated_at ||
    ""
  );
}

/* =========================================================
   pH SPIKE PROTECTION
========================================================= */

function getReadingPhValue(reading) {
  return toNumberOrNull(
    reading?.ph_value ??
      reading?.ph
  );
}

function isSafePhStatus(status) {
  const value =
    normalizeStatusText(status);

  return (
    value.includes("ideal") ||
    value.includes("safe") ||
    value.includes("normal")
  );
}

function isUnsafePhStatus(status) {
  const value =
    normalizeStatusText(status);

  return (
    value.includes("unsafe") ||
    value.includes("critical") ||
    value.includes("danger") ||
    value.includes("high ph") ||
    value.includes("low ph") ||
    value.includes("high alkaline") ||
    value.includes("low alkaline") ||
    value.includes("acidic")
  );
}

function isUnsafePhReading(reading) {
  if (!reading) {
    return false;
  }

  const phValue =
    getReadingPhValue(reading);

  const phStatus =
    reading?.ph_status || "";

  if (
    isSafePhStatus(phStatus)
  ) {
    return false;
  }

  if (
    phValue !== null &&
    (
      phValue < 6.5 ||
      phValue > 8.5
    )
  ) {
    return true;
  }

  return isUnsafePhStatus(
    phStatus
  );
}

function sortReadingsNewestFirst(
  readings = []
) {
  return [...readings].sort(
    (a, b) =>
      new Date(
        getReadingDate(b)
      ) -
      new Date(
        getReadingDate(a)
      )
  );
}

function pickStableLatestReading(
  readings = []
) {
  const sorted =
    sortReadingsNewestFirst(
      readings
    );

  if (
    sorted.length === 0
  ) {
    return null;
  }

  const latest =
    sorted[0];

  if (
    !isUnsafePhReading(
      latest
    )
  ) {
    return latest;
  }

  /*
   * Require three consecutive
   * unsafe pH readings before
   * confirming a possible spike.
   */

  const latestThree =
    sorted.slice(0, 3);

  const confirmedUnsafePh =
    latestThree.length >= 3 &&
    latestThree.every(
      isUnsafePhReading
    );

  if (
    confirmedUnsafePh
  ) {
    return latest;
  }

  const newestSafeReading =
    sorted.find(
      (reading) =>
        !isUnsafePhReading(
          reading
        )
    );

  return (
    newestSafeReading ||
    latest
  );
}

function getLatestReadingForTank(
  tank,
  readings
) {
  const tankKeys =
    getTankMatchKeys(tank);

  const matched =
    readings.filter(
      (reading) => {
        const readingKeys =
          getReadingMatchKeys(
            reading
          );

        return readingKeys.some(
          (key) =>
            tankKeys.includes(
              key
            )
        );
      }
    );

  return pickStableLatestReading(
    matched
  );
}

function getLatestAmmoniaForTank(
  tank,
  ammoniaRows
) {
  const tankKeys =
    getTankMatchKeys(tank);

  const matched =
    ammoniaRows.filter(
      (row) => {
        const rowKeys =
          getReadingMatchKeys(
            row
          );

        return rowKeys.some(
          (key) =>
            tankKeys.includes(
              key
            )
        );
      }
    );

  if (
    matched.length === 0
  ) {
    return null;
  }

  return sortReadingsNewestFirst(
    matched
  )[0];
}

function getAmmoniaNumericValue(
  row
) {
  const raw =
    row?.ammonia_mg_l ??
    row?.ammonia_level ??
    row?.ammonia_ppm ??
    row?.ammonia_value ??
    row?.value ??
    row?.ppm;

  const numberValue =
    Number(raw);

  return Number.isFinite(
    numberValue
  )
    ? numberValue
    : null;
}

function uniqueRows(rows) {
  const map =
    new Map();

  rows.forEach(
    (row, index) => {
      const id =
        row?.id ||
        row?.uuid ||
        row?.tank_id ||
        row?.reading_id ||
        row?.user_id ||
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
   CURRENT USER / DATABASE FETCH
========================================================= */

async function getCurrentUserWithRole() {
  const { data } =
    await supabase.auth.getSession();

  const user =
    data?.session?.user;

  if (!user) {
    return {
      id: "",
      email: "",
      role: "",
      isAdmin: false,
    };
  }

  let profile =
    null;

  const byId =
    await supabase
      .from("profiles")
      .select(
        "id,email,role"
      )
      .eq(
        "id",
        user.id
      )
      .maybeSingle();

  if (
    !byId.error &&
    byId.data
  ) {
    profile =
      byId.data;
  }

  if (
    !profile &&
    user.email
  ) {
    const byEmail =
      await supabase
        .from("profiles")
        .select(
          "id,email,role"
        )
        .ilike(
          "email",
          user.email
        )
        .maybeSingle();

    if (
      !byEmail.error &&
      byEmail.data
    ) {
      profile =
        byEmail.data;
    }
  }

  const role =
    lower(
      profile?.role
    );

  return {
    id:
      user.id || "",

    email:
      user.email || "",

    role,

    isAdmin:
      role === "admin",
  };
}

async function fetchAdminRows(
  tableNames,
  limit = 300
) {
  for (
    const tableName
    of tableNames
  ) {
    const ordered =
      await supabase
        .from(
          tableName
        )
        .select("*")
        .order(
          "created_at",
          {
            ascending:
              false,
          }
        )
        .limit(limit);

    if (
      !ordered.error &&
      Array.isArray(
        ordered.data
      )
    ) {
      return {
        rows:
          uniqueRows(
            ordered.data
          ),

        tableUsed:
          tableName,
      };
    }

    const plain =
      await supabase
        .from(
          tableName
        )
        .select("*")
        .limit(limit);

    if (
      !plain.error &&
      Array.isArray(
        plain.data
      )
    ) {
      return {
        rows:
          uniqueRows(
            plain.data
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

async function fetchUserRows(
  tableNames,
  userId,
  limit = 220
) {
  for (
    const tableName
    of tableNames
  ) {
    const mergedRows =
      [];

    let successful =
      false;

    for (
      const column
      of userFilterColumns
    ) {
      const ordered =
        await supabase
          .from(
            tableName
          )
          .select("*")
          .eq(
            column,
            userId
          )
          .order(
            "created_at",
            {
              ascending:
                false,
            }
          )
          .limit(limit);

      if (
        !ordered.error &&
        Array.isArray(
          ordered.data
        )
      ) {
        successful =
          true;

        mergedRows.push(
          ...ordered.data
        );

        continue;
      }

      const plain =
        await supabase
          .from(
            tableName
          )
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
        successful =
          true;

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

async function fetchProfiles(
  currentUser
) {
  if (
    currentUser.isAdmin
  ) {
    return fetchAdminRows(
      ["profiles"],
      400
    );
  }

  const byId =
    await supabase
      .from("profiles")
      .select("*")
      .eq(
        "id",
        currentUser.id
      )
      .maybeSingle();

  if (
    !byId.error &&
    byId.data
  ) {
    return {
      rows: [
        byId.data,
      ],

      tableUsed:
        "profiles",
    };
  }

  if (
    currentUser.email
  ) {
    const byEmail =
      await supabase
        .from("profiles")
        .select("*")
        .ilike(
          "email",
          currentUser.email
        )
        .maybeSingle();

    if (
      !byEmail.error &&
      byEmail.data
    ) {
      return {
        rows: [
          byEmail.data,
        ],

        tableUsed:
          "profiles",
      };
    }
  }

  return {
    rows: [],
    tableUsed:
      "profiles",
  };
}

async function fetchRowsByScope(
  tableNames,
  currentUser,
  limit = 250
) {
  if (
    currentUser.isAdmin
  ) {
    return fetchAdminRows(
      tableNames,
      limit
    );
  }

  return fetchUserRows(
    tableNames,
    currentUser.id,
    limit
  );
}

/* =========================================================
   SMALL UI COMPONENTS
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
      className={`modern-tank-summary-card ${tone}`}
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

function SensorMiniCard({
  icon: Icon,
  label,
  value,
  status,
}) {
  const hasStatus =
    clean(status) &&
    lower(status) !==
      "no reading";

  const severity =
    hasStatus
      ? getStatusSeverity(
          [status]
        )
      : "no-data";

  return (
    <div className="modern-tank-sensor-card">
      <Icon size={19} />

      <span>
        {label}
      </span>

      <strong>
        {formatFriendlyText(
          value
        )}
      </strong>

      <b
        className={`modern-tank-status ${severity}`}
      >
        {hasStatus
          ? formatFriendlyText(
              status
            )
          : "No Reading"}
      </b>
    </div>
  );
}

/* =========================================================
   POLISHED FILTER DROPDOWN
========================================================= */

function FilterDropdown({
  icon: Icon,
  label,
  helper,
  value,
  options,
  onChange,
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
        option.value ===
        value
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
        setIsOpen(
          false
        );
      }
    }

    function handleEscape(
      event
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        setIsOpen(
          false
        );
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

  function handleSelect(
    option
  ) {
    onChange(
      option.value
    );

    setIsOpen(
      false
    );
  }

  return (
    <div
      ref={dropdownRef}
      style={
        filterDropdownWrapperStyle
      }
    >
      <button
        type="button"
        onClick={() =>
          setIsOpen(
            (current) =>
              !current
          )
        }
        aria-expanded={
          isOpen
        }
        style={{
          ...filterDropdownButtonStyle,

          ...(isOpen
            ? filterDropdownButtonOpenStyle
            : {}),
        }}
      >
        <div
          style={
            filterDropdownButtonLeftStyle
          }
        >
          <div
            style={
              filterDropdownIconStyle
            }
          >
            <Icon
              size={
                18
              }
            />
          </div>

          <div
            style={
              filterDropdownTextStyle
            }
          >
            <span
              style={
                filterDropdownLabelStyle
              }
            >
              {label}
            </span>

            <strong
              style={
                filterDropdownSelectedStyle
              }
            >
              {
                selectedOption
                  ?.label
              }
            </strong>
          </div>
        </div>

        <ChevronDown
          size={18}
          style={{
            ...filterChevronStyle,

            transform:
              isOpen
                ? "rotate(180deg)"
                : "rotate(0deg)",
          }}
        />
      </button>

      <span
        style={
          filterDropdownHelperStyle
        }
      >
        {helper}
      </span>

      {isOpen && (
        <div
          style={
            filterDropdownMenuStyle
          }
        >
          <div
            style={
              filterDropdownMenuHeaderStyle
            }
          >
            <span>
              {label}
            </span>

            <small>
              Select one option
            </small>
          </div>

          <div
            style={
              filterDropdownOptionsStyle
            }
          >
            {options.map(
              (option) => {
                const isSelected =
                  option.value ===
                  value;

                const OptionIcon =
                  option.icon;

                return (
                  <button
                    key={
                      option.value
                    }
                    type="button"
                    onClick={() =>
                      handleSelect(
                        option
                      )
                    }
                    style={{
                      ...filterDropdownOptionStyle,

                      ...(isSelected
                        ? filterDropdownOptionSelectedStyle
                        : {}),
                    }}
                  >
                    <div
                      style={
                        filterOptionMainStyle
                      }
                    >
                      <div
                        style={{
                          ...filterOptionIconStyle,

                          ...(option.tone
                            ? getFilterToneStyle(
                                option.tone
                              )
                            : {}),
                        }}
                      >
                        {OptionIcon ? (
                          <OptionIcon
                            size={
                              16
                            }
                          />
                        ) : (
                          <Filter
                            size={
                              16
                            }
                          />
                        )}
                      </div>

                      <div
                        style={
                          filterOptionTextStyle
                        }
                      >
                        <strong>
                          {
                            option.label
                          }
                        </strong>

                        {option.description && (
                          <small>
                            {
                              option.description
                            }
                          </small>
                        )}
                      </div>
                    </div>

                    <div
                      style={
                        filterOptionCheckAreaStyle
                      }
                    >
                      {option.count !==
                        undefined &&
                        option.count !==
                          null && (
                          <span
                            style={
                              filterCountStyle
                            }
                          >
                            {
                              option.count
                            }
                          </span>
                        )}

                      {isSelected && (
                        <span
                          style={
                            filterCheckStyle
                          }
                        >
                          <Check
                            size={
                              14
                            }
                          />
                        </span>
                      )}
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getFilterToneStyle(
  tone
) {
  switch (tone) {
    case "success":
      return {
        background:
          "rgba(34, 197, 94, 0.12)",
      };

    case "warning":
      return {
        background:
          "rgba(245, 158, 11, 0.12)",
      };

    case "danger":
      return {
        background:
          "rgba(239, 68, 68, 0.12)",
      };

    case "muted":
      return {
        background:
          "rgba(148, 163, 184, 0.12)",
      };

    case "blue":
      return {
        background:
          "rgba(59, 130, 246, 0.12)",
      };

    default:
      return {
        background:
          "rgba(20, 184, 166, 0.10)",
      };
  }
}

/* =========================================================
   PAGE
========================================================= */

export default function TanksPage() {
  const [
    tanks,
    setTanks,
  ] =
    useState([]);

  const [
    readings,
    setReadings,
  ] =
    useState([]);

  const [
    ammoniaReadings,
    setAmmoniaReadings,
  ] =
    useState([]);

  const [
    profiles,
    setProfiles,
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
    typeFilter,
    setTypeFilter,
  ] =
    useState("all");

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  const [
    thresholds,
    setThresholds,
  ] =
    useState(null);

  useEffect(() => {
    let isMounted =
      true;

    loadActiveThresholds()
      .then(
        (loaded) => {
          if (
            isMounted
          ) {
            setThresholds(
              loaded
            );
          }
        }
      );

    return () => {
      isMounted =
        false;
    };
  }, []);

  /* =======================================================
     LOAD
  ======================================================= */

  const loadTanks =
    async () => {
      if (
        !isSupabaseConfigured ||
        !supabase
      ) {
        setIsLoading(
          false
        );

        return;
      }

      try {
        setIsLoading(
          true
        );

        const currentUser =
          await getCurrentUserWithRole();

        if (
          !currentUser.id
        ) {
          setTanks([]);
          setReadings([]);
          setAmmoniaReadings([]);
          setProfiles([]);

          return;
        }

        const [
          tankResult,
          readingResult,
          ammoniaResult,
          profileResult,
        ] =
          await Promise.all([
            fetchRowsByScope(
              tankTables,
              currentUser,
              300
            ),

            fetchRowsByScope(
              readingTables,
              currentUser,
              300
            ),

            fetchRowsByScope(
              ammoniaTables,
              currentUser,
              300
            ),

            fetchProfiles(
              currentUser
            ),
          ]);

        setTanks(
          tankResult.rows
        );

        setReadings(
          readingResult.rows
        );

        setAmmoniaReadings(
          ammoniaResult.rows
        );

        setProfiles(
          profileResult.rows
        );
      } catch (
        error
      ) {
        console.error(
          "Tanks loading error:",
          error
        );
      } finally {
        setIsLoading(
          false
        );
      }
    };

  useEffect(() => {
    loadTanks();
  }, []);

  /* =======================================================
     PROFILE LOOKUP
  ======================================================= */

  const profileMap =
    useMemo(() => {
      const map =
        new Map();

      profiles.forEach(
        (profile) => {
          if (
            profile?.id
          ) {
            map.set(
              String(
                profile.id
              ),
              profile
            );
          }

          if (
            profile?.user_id
          ) {
            map.set(
              String(
                profile.user_id
              ),
              profile
            );
          }

          if (
            profile?.email
          ) {
            map.set(
              String(
                profile.email
              ).toLowerCase(),
              profile
            );
          }
        }
      );

      return map;
    }, [profiles]);

  /* =======================================================
     ENRICH TANKS
  ======================================================= */

  const enrichedTanks =
    useMemo(() => {
      return tanks.map(
        (
          tank,
          index
        ) => {
          const latestReading =
            getLatestReadingForTank(
              tank,
              readings
            );

          const normalized =
            normalizeSensorReading(
              latestReading
            );

          const readingStatus =
            latestReading
              ? getOverallReadingStatus(
                  normalized
                )
              : "no-data";

          const latestAmmoniaRow =
            getLatestAmmoniaForTank(
              tank,
              ammoniaReadings
            );

          const latestAmmoniaValue =
            latestAmmoniaRow
              ? getAmmoniaNumericValue(
                  latestAmmoniaRow
                )
              : null;

          const safety =
            thresholds
              ? evaluateReadingSafety(
                  {
                    temperature:
                      latestReading
                        ?.temperature_c ??
                      latestReading
                        ?.temperature,

                    ph:
                      latestReading
                        ?.ph ??
                      latestReading
                        ?.ph_value,

                    turbidityStatus:
                      normalized
                        .turbidityStatus,

                    waterDepth:
                      latestReading
                        ?.water_depth_cm ??
                      latestReading
                        ?.water_level,

                    ammonia:
                      latestAmmoniaValue,
                  },

                  thresholds
                )
              : null;

          const ownerId =
            getTankOwnerId(
              tank
            );

          const owner =
            profileMap.get(
              String(
                ownerId
              )
            ) ||
            profileMap.get(
              String(
                tank?.email ||
                  ""
              ).toLowerCase()
            ) ||
            null;

          return {
            tank,

            index,

            latestReading,

            normalized,

            id:
              getTankId(
                tank,
                index
              ),

            name:
              getTankName(
                tank,
                index
              ),

            type:
              getTankType(
                tank
              ),

            ownerName:
              owner
                ? getProfileName(
                    owner
                  )
                : "Unknown owner",

            ownerEmail:
              owner?.email ||
              tank?.email ||
              "",

            status:
              readingStatus,

            safety,

            lastSync:
              normalized
                .createdAt ||
              latestReading
                ?.created_at ||
              tank?.updated_at ||
              tank?.created_at ||
              null,
          };
        }
      );
    }, [
      tanks,
      readings,
      ammoniaReadings,
      thresholds,
      profileMap,
    ]);

  /* =======================================================
     TANK TYPES
  ======================================================= */

  const tankTypes =
    useMemo(() => {
      return Array.from(
        new Set(
          enrichedTanks.map(
            (item) =>
              item.type
          )
        )
      ).filter(Boolean);
    }, [enrichedTanks]);

  /* =======================================================
     FILTERING
  ======================================================= */

  const filteredTanks =
    useMemo(() => {
      return enrichedTanks.filter(
        (item) => {
          const search =
            searchTerm
              .trim()
              .toLowerCase();

          const searchableText =
            [
              item.name,
              item.type,
              item.ownerName,
              item.ownerEmail,
              item.status,

              item.normalized
                .temperatureLabel,

              item.normalized
                .temperatureStatus,

              item.normalized
                .phStatus,

              item.normalized
                .turbidityStatus,

              item.normalized
                .waterStatus,

              item.normalized
                .deviceUid,
            ]
              .join(" ")
              .toLowerCase();

          const matchesSearch =
            !search ||
            searchableText.includes(
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
      enrichedTanks,
      searchTerm,
      statusFilter,
      typeFilter,
    ]);

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary =
    useMemo(() => {
      const normal =
        enrichedTanks.filter(
          (item) =>
            item.status ===
            "normal"
        ).length;

      const warning =
        enrichedTanks.filter(
          (item) =>
            item.status ===
            "warning"
        ).length;

      const critical =
        enrichedTanks.filter(
          (item) =>
            item.status ===
            "critical"
        ).length;

      const noData =
        enrichedTanks.filter(
          (item) =>
            item.status ===
            "no-data"
        ).length;

      return {
        total:
          enrichedTanks.length,

        normal,

        warning,

        critical,

        noData,
      };
    }, [enrichedTanks]);

  /* =======================================================
     POLISHED FILTER OPTIONS
  ======================================================= */

  const statusFilterOptions =
    useMemo(
      () => [
        {
          value:
            "all",

          label:
            "All Conditions",

          description:
            "Show every registered tank.",

          icon:
            Filter,

          tone:
            "blue",

          count:
            summary.total,
        },

        {
          value:
            "normal",

          label:
            "Doing Well",

          description:
            "Current readings show no detected issues.",

          icon:
            CheckCircle2,

          tone:
            "success",

          count:
            summary.normal,
        },

        {
          value:
            "warning",

          label:
            "Needs Checking",

          description:
            "One or more readings may need attention.",

          icon:
            AlertTriangle,

          tone:
            "warning",

          count:
            summary.warning,
        },

        {
          value:
            "critical",

          label:
            "Urgent",

          description:
            "Critical conditions that should be reviewed soon.",

          icon:
            AlertTriangle,

          tone:
            "danger",

          count:
            summary.critical,
        },

        {
          value:
            "no-data",

          label:
            "No Recent Data",

          description:
            "No recent sensor reading is available.",

          icon:
            Database,

          tone:
            "muted",

          count:
            summary.noData,
        },
      ],
      [summary]
    );

  const tankTypeFilterOptions =
    useMemo(
      () => [
        {
          value:
            "all",

          label:
            "All Tank Types",

          description:
            "Display tanks regardless of their registered type.",

          icon:
            Droplets,

          tone:
            "blue",

          count:
            enrichedTanks.length,
        },

        ...tankTypes.map(
          (type) => ({
            value:
              type,

            label:
              formatFriendlyText(
                type
              ),

            description:
              `Show only ${formatFriendlyText(
                type
              )} tanks.`,

            icon:
              Droplets,

            tone:
              "default",

            count:
              enrichedTanks.filter(
                (item) =>
                  item.type ===
                  type
              ).length,
          })
        ),
      ],
      [
        tankTypes,
        enrichedTanks,
      ]
    );

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <section className="modern-tank-loading">
        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading your tanks...
        </h3>

        <p>
          Getting the latest tank information.
        </p>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="modern-tanks-page">
      {/* ===================================================
          HEADER
      =================================================== */}

      <section className="modern-tanks-hero">
        <div>
          <p className="dashboard-eyebrow">
            My Tanks
          </p>

          <h2>
            Check your tanks at a glance.
          </h2>

          <p>
            Quickly see which tanks are doing well and which ones may need your attention.
          </p>

          <div className="modern-tanks-actions">
            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                loadTanks
              }
            >
              <RefreshCw
                size={
                  18
                }
              />

              Refresh
            </button>

            <span>
              {summary.total === 1
                ? "1 tank registered"
                : `${summary.total} tanks registered`}
            </span>
          </div>
        </div>

        <div className="modern-tanks-hero-card">
          <Droplets
            size={
              34
            }
          />

          <strong>
            {summary.total}
          </strong>

          <span>
            Total Tanks
          </span>
        </div>
      </section>

      {/* ===================================================
          SUMMARY
      =================================================== */}

      <section className="modern-tank-summary-grid">
        <SummaryCard
          icon={
            CheckCircle2
          }
          label="Doing Well"
          value={
            summary.normal
          }
          helper="No current issues"
          tone="success"
        />

        <SummaryCard
          icon={
            AlertTriangle
          }
          label="Needs Checking"
          value={
            summary.warning
          }
          helper="Keep an eye on these tanks"
          tone="warning"
        />

        <SummaryCard
          icon={
            AlertTriangle
          }
          label="Urgent"
          value={
            summary.critical
          }
          helper="Check these tanks soon"
          tone="danger"
        />

        <SummaryCard
          icon={
            Database
          }
          label="No Recent Data"
          value={
            summary.noData
          }
          helper="Waiting for sensor readings"
        />
      </section>

      {/* ===================================================
          SEARCH / FILTER
      =================================================== */}

      <section
        className="modern-tank-toolbar"
        style={
          improvedToolbarStyle
        }
      >
        {/* SEARCH */}

        <div
          className="modern-tank-search"
          style={
            improvedSearchStyle
          }
        >
          <Search
            size={
              18
            }
          />

          <div
            style={
              searchInputWrapStyle
            }
          >
            <span
              style={
                searchLabelStyle
              }
            >
              Search tanks
            </span>

            <input
              type="search"
              placeholder="Tank name, type, owner..."
              value={
                searchTerm
              }
              onChange={(
                event
              ) =>
                setSearchTerm(
                  event.target
                    .value
                )
              }
              style={
                improvedSearchInputStyle
              }
            />
          </div>
        </div>

        {/* FILTER GROUP */}

        <div
          style={
            filterGroupStyle
          }
        >
          <div
            style={
              filterGroupHeadingStyle
            }
          >
            <Filter
              size={
                16
              }
            />

            <span>
              Filter tanks
            </span>
          </div>

          <div
            style={
              filterDropdownGridStyle
            }
          >
            <FilterDropdown
              icon={
                Filter
              }
              label="Condition"
              helper="Filter by current tank condition"
              value={
                statusFilter
              }
              options={
                statusFilterOptions
              }
              onChange={
                setStatusFilter
              }
            />

            <FilterDropdown
              icon={
                Droplets
              }
              label="Tank Type"
              helper="Filter by registered tank category"
              value={
                typeFilter
              }
              options={
                tankTypeFilterOptions
              }
              onChange={
                setTypeFilter
              }
            />
          </div>
        </div>
      </section>

      {/* ===================================================
          EMPTY / TANK LIST
      =================================================== */}

      {filteredTanks.length ===
      0 ? (
        <section className="modern-tank-empty">
          <Droplets
            size={
              34
            }
          />

          <h3>
            No tanks found
          </h3>

          <p>
            Try changing your search or filter to find another tank.
          </p>
        </section>
      ) : (
        <section className="modern-tank-grid">
          {filteredTanks.map(
            (item) => (
              <article
                className="modern-tank-card"
                key={
                  item.id
                }
              >
                {/* CARD HEADER */}

                <div className="modern-tank-card-top">
                  <div>
                    <span className="modern-tank-type">
                      {formatFriendlyText(
                        item.type
                      )}
                    </span>

                    <h3>
                      {
                        item.name
                      }
                    </h3>
                  </div>

                  <b
                    className={`modern-tank-status ${item.status}`}
                  >
                    {getFriendlyTankStatus(
                      item.status
                    )}
                  </b>
                </div>

                {/* LAST UPDATE */}

                <div className="modern-tank-friendly-sync">
                  {item.latestReading ? (
                    <>
                      Latest update:{" "}

                      <strong>
                        {formatReadingTime(
                          item.lastSync
                        )}
                      </strong>
                    </>
                  ) : (
                    "Waiting for sensor data"
                  )}
                </div>

                {/* SENSOR CARDS */}

                <div className="modern-tank-reading-grid">
                  <SensorMiniCard
                    icon={
                      Thermometer
                    }
                    label="Temperature"
                    value={
                      item.normalized
                        .temperatureLabel
                    }
                    status={
                      item.normalized
                        .temperatureStatus
                    }
                  />

                  <SensorMiniCard
                    icon={
                      Droplets
                    }
                    label="pH Level"
                    value={
                      getPhNumericLabel(
                        item.latestReading
                      ) ||
                      item.normalized
                        .phStatus
                    }
                    status={
                      item.normalized
                        .phStatus
                    }
                  />

                  <SensorMiniCard
                    icon={
                      Waves
                    }
                    label="Water Clarity"
                    value={
                      item.normalized
                        .turbidityStatus
                    }
                    status={
                      item.normalized
                        .turbidityStatus
                    }
                  />

                  <SensorMiniCard
                    icon={
                      Gauge
                    }
                    label="Water Level"
                    value={
                      item.normalized
                        .waterLabel
                    }
                    status={
                      item.normalized
                        .waterStatus
                    }
                  />
                </div>

                {/* SAFE RANGE */}

                {item.safety && (
                  <div
                    className={`modern-tank-safety-chip ${
                      item.safety
                        .isSafe
                        ? "is-safe"
                        : "is-unsafe"
                    }`}
                  >
                    {item.safety
                      .isSafe ? (
                      <CheckCircle2
                        size={
                          15
                        }
                      />
                    ) : (
                      <AlertTriangle
                        size={
                          15
                        }
                      />
                    )}

                    <span>
                      {item.safety
                        .isSafe
                        ? "Within safe range"
                        : `${item.safety.issues.length} ${
                            item.safety.issues.length ===
                            1
                              ? "parameter"
                              : "parameters"
                          } outside safe range`}
                    </span>
                  </div>
                )}

                {/* NO DATA */}

                {!item.latestReading && (
                  <div className="modern-tank-no-reading">
                    <AlertTriangle
                      size={
                        17
                      }
                    />

                    <span>
                      No recent sensor reading is available for this tank.
                    </span>
                  </div>
                )}

                {/* MORE INFO */}

                <details className="modern-tank-more-info">
                  <summary>
                    More information
                  </summary>

                  <div className="modern-tank-more-content">
                    <div>
                      <UserRound
                        size={
                          16
                        }
                      />

                      <span>
                        <small>
                          Owner
                        </small>

                        <strong>
                          {
                            item.ownerName
                          }
                        </strong>
                      </span>
                    </div>

                    <div>
                      <Database
                        size={
                          16
                        }
                      />

                      <span>
                        <small>
                          Connected Device
                        </small>

                        <strong>
                          {item.normalized
                            .deviceUid ||
                            item.tank
                              ?.device_uid ||
                            "Not connected"}
                        </strong>
                      </span>
                    </div>
                  </div>
                </details>

                {/* DETAILS */}

                <Link
                  to={`/admin/tanks/${item.id}`}
                  className="modern-tank-link"
                >
                  View Tank

                  <ArrowRight
                    size={
                      18
                    }
                  />
                </Link>
              </article>
            )
          )}
        </section>
      )}
    </div>
  );
}

/* =========================================================
   POLISHED FILTER STYLES
========================================================= */

const improvedToolbarStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "repeat(auto-fit, minmax(280px, 1fr))",

  alignItems:
    "stretch",

  gap:
    "16px",

  overflow:
    "visible",
};

const improvedSearchStyle = {
  minHeight:
    "88px",

  alignItems:
    "center",

  gap:
    "12px",

  padding:
    "14px 16px",
};

const searchInputWrapStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  flex:
    1,

  gap:
    "3px",

  minWidth:
    0,
};

const searchLabelStyle = {
  fontSize:
    "0.69rem",

  fontWeight:
    700,

  textTransform:
    "uppercase",

  letterSpacing:
    "0.045em",

  opacity:
    0.55,
};

const improvedSearchInputStyle = {
  width:
    "100%",

  border:
    "none",

  outline:
    "none",

  background:
    "transparent",

  padding:
    0,

  color:
    "inherit",

  font:
    "inherit",

  fontSize:
    "0.9rem",
};

const filterGroupStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "9px",

  padding:
    "12px",

  borderRadius:
    "16px",

  border:
    "1px solid rgba(148, 163, 184, 0.14)",

  background:
    "rgba(148, 163, 184, 0.035)",

  overflow:
    "visible",
};

const filterGroupHeadingStyle = {
  display:
    "flex",

  alignItems:
    "center",

  gap:
    "6px",

  padding:
    "0 3px",

  fontSize:
    "0.74rem",

  fontWeight:
    700,

  opacity:
    0.68,
};

const filterDropdownGridStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "repeat(auto-fit, minmax(220px, 1fr))",

  gap:
    "10px",
};

const filterDropdownWrapperStyle = {
  position:
    "relative",

  minWidth:
    0,
};

const filterDropdownButtonStyle = {
  width:
    "100%",

  minHeight:
    "58px",

  display:
    "flex",

  alignItems:
    "center",

  justifyContent:
    "space-between",

  gap:
    "10px",

  padding:
    "9px 11px",

  borderRadius:
    "13px",

  border:
    "1px solid rgba(148, 163, 184, 0.18)",

  background:
    "rgba(255, 255, 255, 0.035)",

  color:
    "inherit",

  cursor:
    "pointer",

  textAlign:
    "left",

  transition:
    "border-color 160ms ease, transform 160ms ease, background 160ms ease",
};

const filterDropdownButtonOpenStyle = {
  border:
    "1px solid rgba(59, 130, 246, 0.40)",

  background:
    "rgba(59, 130, 246, 0.07)",
};

const filterDropdownButtonLeftStyle = {
  display:
    "flex",

  alignItems:
    "center",

  gap:
    "9px",

  minWidth:
    0,
};

const filterDropdownIconStyle = {
  width:
    "34px",

  height:
    "34px",

  flexShrink:
    0,

  display:
    "grid",

  placeItems:
    "center",

  borderRadius:
    "10px",

  background:
    "rgba(59, 130, 246, 0.09)",
};

const filterDropdownTextStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  minWidth:
    0,

  gap:
    "2px",
};

const filterDropdownLabelStyle = {
  fontSize:
    "0.66rem",

  fontWeight:
    700,

  textTransform:
    "uppercase",

  letterSpacing:
    "0.04em",

  opacity:
    0.5,
};

const filterDropdownSelectedStyle = {
  overflow:
    "hidden",

  textOverflow:
    "ellipsis",

  whiteSpace:
    "nowrap",

  fontSize:
    "0.83rem",
};

const filterDropdownHelperStyle = {
  display:
    "block",

  padding:
    "5px 3px 0",

  fontSize:
    "0.68rem",

  lineHeight:
    1.35,

  opacity:
    0.5,
};

const filterChevronStyle = {
  flexShrink:
    0,

  opacity:
    0.6,

  transition:
    "transform 180ms ease",
};

const filterDropdownMenuStyle = {
  position:
    "absolute",

  zIndex:
    50,

  top:
    "calc(100% + 8px)",

  left:
    0,

  width:
    "min(360px, calc(100vw - 32px))",

  padding:
    "8px",

  borderRadius:
    "15px",

  border:
    "1px solid rgba(148, 163, 184, 0.20)",

  background:
    "var(--dashboard-card, #ffffff)",

  color:
    "inherit",

  boxShadow:
    "0 18px 45px rgba(15, 23, 42, 0.18)",
};

const filterDropdownMenuHeaderStyle = {
  display:
    "flex",

  justifyContent:
    "space-between",

  alignItems:
    "center",

  gap:
    "10px",

  padding:
    "5px 7px 9px",

  borderBottom:
    "1px solid rgba(148, 163, 184, 0.12)",

  fontSize:
    "0.75rem",
};

const filterDropdownOptionsStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  gap:
    "4px",

  paddingTop:
    "6px",

  maxHeight:
    "320px",

  overflowY:
    "auto",
};

const filterDropdownOptionStyle = {
  width:
    "100%",

  display:
    "flex",

  justifyContent:
    "space-between",

  alignItems:
    "center",

  gap:
    "10px",

  padding:
    "10px",

  border:
    "none",

  borderRadius:
    "11px",

  background:
    "transparent",

  color:
    "inherit",

  textAlign:
    "left",

  cursor:
    "pointer",
};

const filterDropdownOptionSelectedStyle = {
  background:
    "rgba(59, 130, 246, 0.09)",
};

const filterOptionMainStyle = {
  display:
    "flex",

  alignItems:
    "center",

  gap:
    "9px",

  minWidth:
    0,
};

const filterOptionIconStyle = {
  width:
    "32px",

  height:
    "32px",

  display:
    "grid",

  placeItems:
    "center",

  flexShrink:
    0,

  borderRadius:
    "9px",
};

const filterOptionTextStyle = {
  display:
    "flex",

  flexDirection:
    "column",

  minWidth:
    0,

  gap:
    "2px",
};

const filterOptionCheckAreaStyle = {
  display:
    "flex",

  alignItems:
    "center",

  gap:
    "6px",

  flexShrink:
    0,
};

const filterCountStyle = {
  minWidth:
    "25px",

  height:
    "25px",

  padding:
    "0 7px",

  display:
    "inline-grid",

  placeItems:
    "center",

  borderRadius:
    "999px",

  background:
    "rgba(148, 163, 184, 0.10)",

  fontSize:
    "0.7rem",

  fontWeight:
    700,
};

const filterCheckStyle = {
  width:
    "24px",

  height:
    "24px",

  display:
    "grid",

  placeItems:
    "center",

  borderRadius:
    "50%",

  background:
    "rgba(59, 130, 246, 0.14)",
};
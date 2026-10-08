import { logDiagnostic } from "../../utils/securityDiagnostics";
import { getAmmoniaLabel, getAmmoniaNumericValue, getAmmoniaScanDate, getLatestAmmoniaForTank, recordMatchesMonitoringTank } from "../../utils/monitoringRecords";
import { loadCurrentTankRows } from "../../services/tankSnapshotService";
import SafetyBadge, { SafetyIcon } from "../../components/SafetyBadge";
import { getTankPairingState } from "../../utils/tankPairing";
import { getTankPopulationLabel } from "../../utils/tankCreationRules";
import { getSafetySeverity, getParameterExplanation, getSafetyStatusLabel } from "../../utils/statusHelpers";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  Droplets,
  FlaskConical,
  Filter,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Thermometer,
  UserRound,
  Waves,
} from "lucide-react";

import {
  isSupabaseConfigured,
  supabase,
} from "../../lib/supabase";

import {
  evaluateReadingSafety,
  loadActiveThresholds,
} from "../../utils/thresholdEvaluation";

import {
  formatReadingTime,
  normalizeSensorReading,
} from "../../utils/sensorReadingUtils";

/* =========================================================
   TABLES
========================================================= */

const tankTables = [
  "tanks",
];

const readingTables = [
  "sensor_readings",
  "tank_readings",
  "readings",
];

const ammoniaTables = [
  "ammonia_readings",
];

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

/* =========================================================
   pH NUMERIC VALUE
========================================================= */

function getPhNumericLabel(reading) {
  const numberValue = normalizeSensorReading(reading).phValue;

  return numberValue !== null
    ? numberValue.toFixed(1)
    : null;
}

/* =========================================================
   STATUS
========================================================= */


function getOverallReadingStatus(normalizedReading) {
  return getSafetySeverity(normalizedReading.safety);
}


/* =========================================================
   TANK HELPERS
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

/* =========================================================
   MATCH TANK TO SENSOR READINGS
========================================================= */


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
   LATEST READING ORDER
========================================================= */


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


function getLatestReadingForTank(tank, readings) {
  const matched = readings.filter(reading => recordMatchesMonitoringTank(reading, tank));
  return sortReadingsNewestFirst(matched)[0] || null;
}


/* =========================================================
   UNIQUE RECORDS
========================================================= */

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
   CURRENT USER
========================================================= */

async function getCurrentUserWithRole() {
  const {
    data,
  } =
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
      .select("id,email,role")
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
        .select("id,email,role")
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

/* =========================================================
   DATABASE FETCH
========================================================= */

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
  const safetyLevel = { success: "normal", warning: "warning", danger: "critical" }[tone];
  return (
    <article
      className={`modern-tank-summary-card ${tone} ${safetyLevel ? `safety-summary safety-surface ${safetyLevel}` : ""}`}
    >
      <span>
        {safetyLevel ? <SafetyIcon severity={safetyLevel} size={21} /> : <Icon size={21} />}
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

function SensorMiniCard({ icon: Icon, label, value, parameter, scanDate, manualScan = false }) {
  const explanation = getParameterExplanation(parameter, label);
  return (
    <div className="modern-tank-sensor-card">
      <Icon size={19} />
      <span>{label}</span>
      <strong>{value ?? "No Data"}</strong>
      <SafetyBadge className="modern-tank-status" severity={parameter?.severity} emptyLabel={manualScan ? "No Scan" : "No Data"} />
      {explanation && <small className="safety-explanation">{explanation}</small>}
      {manualScan && <small>Latest available ammonia scan</small>}
      {manualScan && value !== "No Scan" && <small>Scanned: {scanDate ? formatReadingTime(scanDate) : "Scan time unavailable"}</small>}
    </div>
  );
}

/* =========================================================
   MINIMAL THEME-AWARE DROPDOWN
========================================================= */

function FilterDropdown({
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

  const selected =
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

  function selectOption(
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
      ref={
        dropdownRef
      }
      style={
        dropdownWrapStyle
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
          ...dropdownTriggerStyle,

          ...(isOpen
            ? dropdownTriggerOpenStyle
            : {}),
        }}
      >
        <Icon
          size={17}
          style={
            dropdownIconStyle
          }
        />

        <span
          style={
            dropdownSelectedTextStyle
          }
        >
          {
            selected?.label
          }
        </span>

        <ChevronDown
          size={16}
          style={{
            ...dropdownChevronStyle,

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
            dropdownMenuStyle
          }
        >
          {options.map(
            (option) => {
              const active =
                option.value ===
                value;

              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={
                    active
                  }
                  key={
                    option.value
                  }
                  onClick={() =>
                    selectOption(
                      option
                    )
                  }
                  style={{
                    ...dropdownItemStyle,

                    ...(active
                      ? dropdownItemActiveStyle
                      : {}),
                  }}
                >
                  <span>
                    {
                      option.label
                    }
                  </span>

                  {active && (
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

export default function TanksPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const createdTank = location.state?.tankCreated;
  const [currentRows, setCurrentRows] = useState({ sensor: [], ammonia: [] });
  const [
    tanks,
    setTanks,
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
      setThresholds(await loadActiveThresholds());
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
          setTanks(
            []
          );

          setProfiles(
            []
          );

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

        setCurrentRows(await loadCurrentTankRows(tankResult.rows, currentUser, { sensor: readingResult.rows, ammonia: ammoniaResult.rows }));
        setTanks(
          tankResult.rows
        );

        setProfiles(
          profileResult.rows
        );
      } catch (
        error
      ) {
        logDiagnostic(
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
              currentRows.sensor
            );

          const normalized =
            normalizeSensorReading(latestReading, thresholds);

          const readingStatus =
            latestReading
              ? getOverallReadingStatus(
                  normalized
                )
              : "no-data";

          const latestAmmoniaRow =
            getLatestAmmoniaForTank(
              tank,
              currentRows.ammonia
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
                    temperature: normalized.temperatureValue,
                    ph: normalized.phValue,

                    turbidityVoltage:
                      normalized.turbidityValue,

                    waterDepth: normalized.waterValue,

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
            latestAmmoniaRow,
            latestAmmoniaValue,

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
              safety ? getSafetySeverity(safety) : readingStatus,

            safety,

            lastSync:
              normalized.createdAt ||
              latestReading?.created_at ||
              tank?.updated_at ||
              tank?.created_at ||
              null,
          };
        }
      );
    }, [
      tanks,
      currentRows,
      thresholds,
      profileMap,
    ]);

  /* =======================================================
     TYPES
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
     FILTER OPTIONS
  ======================================================= */

  const statusFilterOptions =
    useMemo(
      () => [
        {
          value: "all",
          label:
            "All Conditions",
        },

        {
          value: "normal",
          label:
            "Normal",
        },

        {
          value: "warning",
          label:
            "Warning",
        },

        {
          value: "critical",
          label:
            "Critical",
        },

        {
          value: "no-data",
          label:
            "No Data",
        },
      ],
      []
    );

  const tankTypeFilterOptions =
    useMemo(
      () => [
        {
          value: "all",
          label:
            "All Tank Types",
        },

        ...tankTypes.map(
          (type) => ({
            value:
              type,

            label:
              formatFriendlyText(
                type
              ),
          })
        ),
      ],
      [
        tankTypes,
      ]
    );

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    isLoading
  ) {
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
      {/* ===============================================
          HEADER
      ================================================ */}

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
            <Link to="/admin/tanks/add" className="dashboard-primary-button">
              <Plus size={18} aria-hidden="true" /> Add Tank
            </Link>
            <button
              type="button"
              className="dashboard-primary-button"
              onClick={
                loadTanks
              }
            >
              <RefreshCw
                size={18}
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
            size={34}
          />

          <strong>
            {summary.total}
          </strong>

          <span>
            Total Tanks
          </span>
        </div>
      </section>

      {createdTank && <div className="tank-created-notice" role="status">
        <CheckCircle2 size={18} aria-hidden="true" />
        <span>{createdTank.name} was created. You can connect a device later.</span>
        <button type="button" onClick={() => navigate(location.pathname, { replace: true, state: null })}>Dismiss</button>
      </div>}

      {/* ===============================================
          SUMMARY
      ================================================ */}

      <section className="modern-tank-summary-grid">
        <SummaryCard
          icon={
            CheckCircle2
          }
          label="Normal"
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
          label="Warning"
          value={
            summary.warning
          }
          helper="Keep an eye on these tanks"
          tone="warning"
        />

        <SummaryCard
          icon={AlertCircle}
          label="Critical"
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
          label="No Data"
          value={
            summary.noData
          }
          helper="Waiting for sensor readings"
        />
      </section>

      {/* ===============================================
          SEARCH / FILTER
      ================================================ */}

      <section
        className="modern-tank-toolbar"
        style={
          compactToolbarStyle
        }
      >
        {/* SEARCH */}

        <div
          className="modern-tank-search"
          style={
            compactSearchStyle
          }
        >
          <Search
            size={18}
          />

          <input
            type="search"
            placeholder="Search tanks..."
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
            style={
              compactSearchInputStyle
            }
          />
        </div>

        {/* CONDITION */}

        <FilterDropdown
          ariaLabel="Filter tanks by condition"
          icon={Filter}
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

        {/* TYPE */}

        <FilterDropdown
          ariaLabel="Filter tanks by type"
          icon={Droplets}
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
      </section>

      {/* ===============================================
          EMPTY / TANKS
      ================================================ */}

      {filteredTanks.length ===
      0 ? (
        <section className="modern-tank-empty">
          <Droplets
            size={34}
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
                {/* HEADER */}

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

                  <SafetyBadge className="modern-tank-status" severity={item.status} />
                </div>

                {/* LAST UPDATE */}

                {getTankPopulationLabel(item.tank) && <p className="tank-population-summary">
                  Population: {getTankPopulationLabel(item.tank)}
                </p>}

                <div className="modern-tank-friendly-sync">
                  {getTankPairingState(item.tank) === 'Unpaired' && (
                    <span className="tank-pairing-state">Unpaired</span>
                  )}
                  {" "}
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
                    parameter={item.normalized.safety?.parameters.temperature}
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
                        .phNumberLabel
                    }
                    parameter={item.normalized.safety?.parameters.ph}
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
                    parameter={item.normalized.safety?.parameters.turbidity}
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
                    parameter={item.normalized.safety?.parameters.waterLevel}
                  />
                  <SensorMiniCard icon={FlaskConical} label="Ammonia"
                    value={getAmmoniaLabel(item.latestAmmoniaValue)}
                    parameter={item.safety?.parameters.ammonia} manualScan
                    scanDate={getAmmoniaScanDate(item.latestAmmoniaRow)} />
                </div>

                {/* SAFE RANGE */}

                {item.safety && (
                  <div className={`modern-tank-safety-chip safety-surface ${item.status}`}>
                    <SafetyIcon severity={item.status} size={15} />
                    <span>
                      {getSafetyStatusLabel(item.status)}
                      {item.safety.issues.length > 0 && ` ? ${item.safety.issues.length} parameter(s) outside the configured range`}
                    </span>
                  </div>
                )}

                {/* NO DATA WARNING */}

                {!item.latestReading && (
                  <div className="modern-tank-no-reading">
                    <AlertTriangle
                      size={17}
                    />

                    <span>
                      No recent sensor reading is available for this tank.
                    </span>
                  </div>
                )}

                {/* MORE INFORMATION */}

                <details className="modern-tank-more-info">
                  <summary>
                    More information
                  </summary>

                  <div className="modern-tank-more-content">
                    <div>
                      <UserRound
                        size={16}
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
                        size={16}
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
                    size={18}
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
   MINIMAL THEME-AWARE FILTER UI
========================================================= */

const compactToolbarStyle = {
  display:
    "grid",

  gap:
    "10px",

  alignItems:
    "center",

  overflow:
    "visible",

  position:
    "relative",

  zIndex:
    10,
};

const compactSearchStyle = {
  minHeight:
    "48px",

  height:
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

  borderColor:
    "var(--ct-border, var(--border, #e5e4e7))",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",
};

const compactSearchInputStyle = {
  width:
    "100%",

  minWidth:
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
    "0.86rem",
};

/* =========================================================
   DROPDOWN
========================================================= */

const dropdownWrapStyle = {
  position:
    "relative",

  minWidth:
    0,
};

const dropdownTriggerStyle = {
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

  borderRadius:
    "12px",

  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--ct-border, var(--border, #e5e4e7))",

  background:
    "var(--ct-surface, var(--bg, #ffffff))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  boxShadow:
    "var(--ct-shadow-soft, 0 4px 14px rgba(15, 23, 42, 0.04))",

  font:
    "inherit",

  fontSize:
    "0.82rem",

  fontWeight:
    600,

  cursor:
    "pointer",

  textAlign:
    "left",

  transition:
    "background 150ms ease, border-color 150ms ease, box-shadow 150ms ease",
};

const dropdownTriggerOpenStyle = {
  borderColor:
    "var(--ct-brand, #00b8a9)",

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  boxShadow:
    "0 0 0 3px rgba(0, 217, 199, 0.08)",
};

const dropdownIconStyle = {
  flexShrink:
    0,

  color:
    "var(--ct-brand, #00b8a9)",
};

const dropdownSelectedTextStyle = {
  minWidth:
    0,

  overflow:
    "hidden",

  textOverflow:
    "ellipsis",

  whiteSpace:
    "nowrap",
};

const dropdownChevronStyle = {
  marginLeft:
    "auto",

  flexShrink:
    0,

  color:
    "var(--ct-muted, var(--text, #64748b))",

  transition:
    "transform 160ms ease",
};

const dropdownMenuStyle = {
  position:
    "absolute",

  top:
    "calc(100% + 6px)",

  left:
    0,

  right:
    0,

  zIndex:
    100,

  padding:
    "5px",

  borderRadius:
    "12px",

  border:
    "1px solid var(--ct-border, var(--border, #e5e4e7))",

  /*
   * IMPORTANT:
   *
   * LIGHT MODE:
   * --ct-surface-strong / --bg => white/light
   *
   * DARK MODE:
   * --ct-surface-strong => dark dashboard surface
   */

  background:
    "var(--ct-surface-strong, var(--bg, #ffffff))",

  color:
    "var(--ct-text, var(--text-h, #0f172a))",

  boxShadow:
    "0 14px 32px rgba(15, 23, 42, 0.14)",

  overflow:
    "hidden",

  backdropFilter:
    "blur(18px)",
};

const dropdownItemStyle = {
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
    "0.8rem",

  fontWeight:
    500,

  cursor:
    "pointer",

  textAlign:
    "left",
};

const dropdownItemActiveStyle = {
  background:
    "var(--ct-brand-soft, var(--accent-bg, rgba(0, 217, 199, 0.10)))",

  color:
    "var(--ct-brand, var(--accent, #008f83))",

  fontWeight:
    700,
};

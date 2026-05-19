import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Camera,
  CheckCircle2,
  Database,
  Droplets,
  Gauge,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Settings,
  Thermometer,
  TimerReset,
  UserRound,
  Waves,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  formatReadingTime,
  normalizeSensorReading,
} from "../../utils/sensorReadingUtils";

const tankTables = ["tanks", "user_tanks", "tank_profiles"];
const readingTables = ["sensor_readings", "tank_readings", "readings"];
const ammoniaTables = ["ammonia_readings", "ammonia_results"];
const alertTables = ["alerts", "notifications", "tank_alerts"];
const controlLogTables = ["control_logs"];

const READINGS_PER_PAGE = 5;

const userFilterColumns = [
  "user_id",
  "owner_id",
  "profile_id",
  "created_by",
  "farmer_id",
];

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function normalizeStatusText(value) {
  return lower(value).replaceAll("_", " ").replaceAll("-", " ");
}

function getStatusSeverity(statuses) {
  const joined = statuses.map(normalizeStatusText).join(" ");

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

  if (
    joined.includes("ideal") ||
    joined.includes("safe") ||
    joined.includes("normal") ||
    joined.includes("clear") ||
    joined.includes("measured")
  ) {
    return "normal";
  }

  return "normal";
}

function getOverallReadingStatus(normalizedReading) {
  return getStatusSeverity([
    normalizedReading.temperatureStatus,
    normalizedReading.phStatus,
    normalizedReading.turbidityStatus,
    normalizedReading.waterStatus,
  ]);
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

function getValue(row, keys, fallback = "N/A") {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "") {
      return row[key];
    }
  }

  return fallback;
}

function getTankId(tank, index = 0) {
  return tank?.id || tank?.tank_id || tank?.uuid || `tank-${index}`;
}

function getTankName(tank, index = 0) {
  return (
    tank?.name ||
    tank?.tank_name ||
    tank?.title ||
    tank?.label ||
    `Tank ${index + 1}`
  );
}

function getTankType(tank) {
  return tank?.type || tank?.tank_type || tank?.category || "Crayfish Tank";
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
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
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
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));
}

function getRecordMatchKeys(row) {
  return [
    row?.tank_id,
    row?.tankId,
    row?.tank_uuid,
    row?.tank_profile_id,
    row?.iot_device_id,
    row?.device_id,
    row?.device_uid,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));
}

function getRecordDate(row) {
  return row?.created_at || row?.timestamp || row?.date || row?.updated_at || "";
}

function recordMatchesTank(row, tank) {
  const tankKeys = getTankMatchKeys(tank);
  const rowKeys = getRecordMatchKeys(row);

  return rowKeys.some((key) => tankKeys.includes(key));
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach((row, index) => {
    const id =
      row?.id ||
      row?.uuid ||
      row?.tank_id ||
      row?.reading_id ||
      row?.alert_id ||
      row?.created_at ||
      `row-${index}`;

    map.set(String(id), row);
  });

  return Array.from(map.values());
}

async function getCurrentUserWithRole() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  if (!user) {
    return {
      id: "",
      email: "",
      role: "",
      isAdmin: false,
    };
  }

  let profile = null;

  const byId = await supabase
    .from("profiles")
    .select("id,email,role")
    .eq("id", user.id)
    .maybeSingle();

  if (!byId.error && byId.data) {
    profile = byId.data;
  }

  if (!profile && user.email) {
    const byEmail = await supabase
      .from("profiles")
      .select("id,email,role")
      .ilike("email", user.email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      profile = byEmail.data;
    }
  }

  const role = lower(profile?.role);

  return {
    id: user.id || "",
    email: user.email || "",
    role,
    isAdmin: role === "admin",
  };
}

async function fetchAdminRows(tableNames, limit = 400) {
  for (const tableName of tableNames) {
    const ordered = await supabase
      .from(tableName)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!ordered.error && Array.isArray(ordered.data)) {
      return {
        rows: uniqueRows(ordered.data),
        tableUsed: tableName,
      };
    }

    const plain = await supabase.from(tableName).select("*").limit(limit);

    if (!plain.error && Array.isArray(plain.data)) {
      return {
        rows: uniqueRows(plain.data),
        tableUsed: tableName,
      };
    }
  }

  return {
    rows: [],
    tableUsed: tableNames[0],
  };
}

async function fetchUserRows(tableNames, userId, limit = 300) {
  for (const tableName of tableNames) {
    const mergedRows = [];
    let successful = false;

    for (const column of userFilterColumns) {
      const ordered = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!ordered.error && Array.isArray(ordered.data)) {
        successful = true;
        mergedRows.push(...ordered.data);
        continue;
      }

      const plain = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .limit(limit);

      if (!plain.error && Array.isArray(plain.data)) {
        successful = true;
        mergedRows.push(...plain.data);
      }
    }

    if (successful) {
      return {
        rows: uniqueRows(mergedRows),
        tableUsed: tableName,
      };
    }
  }

  return {
    rows: [],
    tableUsed: tableNames[0],
  };
}

async function fetchRowsByScope(tableNames, currentUser, limit = 300) {
  if (currentUser.isAdmin) {
    return fetchAdminRows(tableNames, limit);
  }

  return fetchUserRows(tableNames, currentUser.id, limit);
}

async function fetchProfiles(currentUser) {
  if (currentUser.isAdmin) {
    return fetchAdminRows(["profiles"], 400);
  }

  const byId = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return {
      rows: [byId.data],
      tableUsed: "profiles",
    };
  }

  return {
    rows: [],
    tableUsed: "profiles",
  };
}

function DetailMetricCard({ icon: Icon, label, value, status }) {
  const severity = getStatusSeverity([status]);

  return (
    <article className="modern-tank-detail-metric">
      <span>
        <Icon size={22} />
      </span>

      <div>
        <strong>{value}</strong>
        <p>{label}</p>
        <b className={`modern-tank-status ${severity}`}>{status}</b>
      </div>
    </article>
  );
}

function EmptyBlock({ icon: Icon, title, text }) {
  return (
    <div className="modern-tank-detail-empty">
      <Icon size={28} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export default function TankDetailsPage() {
  const { tankId } = useParams();

  const [tank, setTank] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [readings, setReadings] = useState([]);
  const [ammoniaReadings, setAmmoniaReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [controlLogs, setControlLogs] = useState([]);
  const [sources, setSources] = useState({});
  const [scopeLabel, setScopeLabel] = useState("User view");
  const [isLoading, setIsLoading] = useState(true);
  const [readingsPage, setReadingsPage] = useState(1);
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const [commandMessage, setCommandMessage] = useState("");

  const loadTankDetails = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const currentUser = await getCurrentUserWithRole();

      if (!currentUser.id) {
        setTank(null);
        setScopeLabel("No session");
        return;
      }

      const [
        tankResult,
        readingResult,
        ammoniaResult,
        alertResult,
        logResult,
        profileResult,
      ] = await Promise.all([
        fetchRowsByScope(tankTables, currentUser, 400),
        fetchRowsByScope(readingTables, currentUser, 400),
        fetchRowsByScope(ammoniaTables, currentUser, 300),
        fetchRowsByScope(alertTables, currentUser, 300),
        fetchRowsByScope(controlLogTables, currentUser, 300),
        fetchProfiles(currentUser),
      ]);

      const selectedTank =
        tankResult.rows.find((item, index) => {
          const keys = [
            getTankId(item, index),
            item?.id,
            item?.tank_id,
            item?.uuid,
            item?.device_uid,
            item?.iot_device_id,
            item?.actuator_device_uid,
          ]
            .filter(Boolean)
            .map((value) => String(value));

          return keys.includes(String(tankId));
        }) || null;

      setTank(selectedTank);
      setProfiles(profileResult.rows);

      if (selectedTank) {
        setReadings(
          readingResult.rows
            .filter((row) => recordMatchesTank(row, selectedTank))
            .sort((a, b) => new Date(getRecordDate(b)) - new Date(getRecordDate(a)))
        );

        setAmmoniaReadings(
          ammoniaResult.rows
            .filter((row) => recordMatchesTank(row, selectedTank))
            .sort((a, b) => new Date(getRecordDate(b)) - new Date(getRecordDate(a)))
        );

        setAlerts(
          alertResult.rows
            .filter((row) => recordMatchesTank(row, selectedTank))
            .sort((a, b) => new Date(getRecordDate(b)) - new Date(getRecordDate(a)))
        );

        setControlLogs(
          logResult.rows
            .filter((row) => recordMatchesTank(row, selectedTank))
            .sort((a, b) => new Date(getRecordDate(b)) - new Date(getRecordDate(a)))
        );
      } else {
        setReadings([]);
        setAmmoniaReadings([]);
        setAlerts([]);
        setControlLogs([]);
      }

      setSources({
        tanks: tankResult.tableUsed,
        readings: readingResult.tableUsed,
        ammonia: ammoniaResult.tableUsed,
        alerts: alertResult.tableUsed,
        logs: logResult.tableUsed,
        profiles: profileResult.tableUsed,
      });

      setScopeLabel(
        currentUser.isAdmin ? "Admin all-records view" : "User account view"
      );
    } catch (error) {
      console.error("Tank details loading error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTankDetails();
  }, [tankId]);

  useEffect(() => {
    setReadingsPage(1);
  }, [tankId]);

  const profileMap = useMemo(() => {
    const map = new Map();

    profiles.forEach((profile) => {
      if (profile?.id) map.set(String(profile.id), profile);
      if (profile?.user_id) map.set(String(profile.user_id), profile);
      if (profile?.email) {
        map.set(String(profile.email).toLowerCase(), profile);
      }
    });

    return map;
  }, [profiles]);

  const owner = useMemo(() => {
    if (!tank) return null;

    const ownerId = getTankOwnerId(tank);

    return (
      profileMap.get(String(ownerId)) ||
      profileMap.get(String(tank?.email || "").toLowerCase()) ||
      null
    );
  }, [tank, profileMap]);

  const enrichedReadings = useMemo(() => {
    return readings.map((reading, index) => {
      const normalized = normalizeSensorReading(reading);
      const status = getOverallReadingStatus(normalized);

      return {
        reading,
        normalized,
        status,
        index,
        date:
          normalized.createdAt ||
          reading?.timestamp ||
          reading?.date ||
          reading?.updated_at,
      };
    });
  }, [readings]);

  const latestReading = enrichedReadings[0] || null;

  const totalReadingPages = Math.max(
    1,
    Math.ceil(enrichedReadings.length / READINGS_PER_PAGE)
  );

  const currentReadingPage = Math.min(readingsPage, totalReadingPages);

  const paginatedReadings = enrichedReadings.slice(
    (currentReadingPage - 1) * READINGS_PER_PAGE,
    currentReadingPage * READINGS_PER_PAGE
  );

  const tankStatus = latestReading ? latestReading.status : "normal";

  function getTankCommandDeviceUid() {
    return (
      tank?.actuator_device_uid ||
      tank?.device_uid ||
      tank?.iot_device_id ||
      "CRAYTHRIVE-001"
    );
  }

  async function sendDeviceCommand(commandType, durationMs = null) {
    setCommandMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setCommandMessage("Supabase is not configured.");
      return;
    }

    if (!tank) {
      setCommandMessage("No selected tank.");
      return;
    }

    const commandDeviceUid = getTankCommandDeviceUid();
    const commandTankId = String(tank?.id || tank?.tank_id || tankId || "");

    if (!commandTankId || !commandDeviceUid) {
      setCommandMessage("Missing tank ID or device UID.");
      return;
    }

    try {
      setIsSendingCommand(true);

      const payload = {
        tank_id: commandTankId,
        device_uid: commandDeviceUid,
        command_type: commandType,
        status: "pending",
        result_message: "Command sent from web dashboard.",
      };

      if (durationMs) {
        payload.duration_ms = durationMs;
      }

      const { error } = await supabase.from("device_commands").insert(payload);

      if (error) {
        throw new Error(error.message);
      }

      const label =
        commandType === "feed_now"
          ? "Feed Now"
          : commandType === "fill_pump"
            ? "Fill Pump"
            : commandType === "drain_pump"
              ? "Drain Pump"
              : "Stop All";

      setCommandMessage(`${label} command sent to actuator node.`);
    } catch (error) {
      setCommandMessage(error.message || "Failed to send device command.");
    } finally {
      setIsSendingCommand(false);
    }
  }

  if (isLoading) {
    return (
      <section className="modern-tank-loading">
        <Loader2 className="spin-icon" size={34} />
        <h3>Loading tank details...</h3>
        <p>CrayThrive is preparing this tank&apos;s readings and reports.</p>
      </section>
    );
  }

  if (!tank) {
    return (
      <section className="modern-tank-detail-empty-page">
        <Database size={34} />
        <h3>Tank not found</h3>
        <p>
          This tank could not be found or your account does not have access to it.
        </p>

        <Link to="/admin/tanks" className="modern-tank-link">
          <ArrowLeft size={18} />
          Back to Tanks
        </Link>
      </section>
    );
  }

  return (
    <div className="modern-tank-detail-page">
      <section className="modern-tank-detail-hero">
        <div>
          <Link to="/admin/tanks" className="modern-back-link">
            <ArrowLeft size={18} />
            Back to Tanks
          </Link>

          <p className="dashboard-eyebrow">Tank Details</p>
          <h2>{getTankName(tank)}</h2>
          <p>
            Detailed view for latest sensor condition, reading history, ammonia
            results, device controls, control logs, and tank alerts.
          </p>

          <div className="modern-tank-detail-actions">
            <button className="dashboard-primary-button" onClick={loadTankDetails}>
              <RefreshCw size={18} />
              Refresh Details
            </button>

            <span>
              Source: {sources.tanks || "tanks"} /{" "}
              {sources.readings || "sensor_readings"} • {scopeLabel}
            </span>
          </div>
        </div>

        <div className="modern-tank-detail-hero-card">
          <Droplets size={38} />
          <strong className={tankStatus}>{tankStatus}</strong>
          <span>Current tank status</span>
        </div>
      </section>

      <section className="modern-tank-detail-info-grid">
        <article className="modern-tank-detail-info-card">
          <UserRound size={22} />
          <strong>{owner ? getProfileName(owner) : "Unknown owner"}</strong>
          <span>{owner?.email || tank?.email || "No owner email"}</span>
        </article>

        <article className="modern-tank-detail-info-card">
          <Database size={22} />
          <strong>{getTankType(tank)}</strong>
          <span>Tank type</span>
        </article>

        <article className="modern-tank-detail-info-card">
          <Camera size={22} />
          <strong>
            {tank?.actuator_device_uid ||
              tank?.device_uid ||
              tank?.iot_device_id ||
              "N/A"}
          </strong>
          <span>Device / IoT reference</span>
        </article>

        <article className="modern-tank-detail-info-card">
          <Activity size={22} />
          <strong>{formatReadingTime(latestReading?.date)}</strong>
          <span>Latest sensor sync</span>
        </article>
      </section>

      <section className="modern-tank-detail-panel">
        <div className="modern-panel-heading">
          <div>
            <p className="dashboard-eyebrow">Device Controls</p>
            <h3>Feeder and pump commands</h3>
          </div>
          <Settings size={22} />
        </div>

        <div className="modern-device-command-grid">
          <button
            type="button"
            disabled={isSendingCommand}
            onClick={() => sendDeviceCommand("feed_now")}
          >
            <Play size={20} />
            <strong>Feed Now</strong>
            <span>Send one safe feeding command</span>
          </button>

          <button
            type="button"
            disabled={isSendingCommand}
            onClick={() => sendDeviceCommand("fill_pump", 10000)}
          >
            <Droplets size={20} />
            <strong>Fill Pump</strong>
            <span>Run fill pump max 10 seconds</span>
          </button>

          <button
            type="button"
            disabled={isSendingCommand}
            onClick={() => sendDeviceCommand("drain_pump", 10000)}
          >
            <Waves size={20} />
            <strong>Drain Pump</strong>
            <span>Run drain pump max 10 seconds</span>
          </button>

          <button
            type="button"
            disabled={isSendingCommand}
            onClick={() => sendDeviceCommand("stop_all")}
            className="danger"
          >
            <Power size={20} />
            <strong>Stop All</strong>
            <span>Stop pumps and return feeder to rest</span>
          </button>
        </div>

        <div className="modern-device-command-note">
          <TimerReset size={17} />
          <span>
            Commands are saved as pending in Supabase. The ESP32 actuator node
            will poll and execute them automatically.
          </span>
        </div>

        {commandMessage && (
          <div className="modern-device-command-message">
            <CheckCircle2 size={18} />
            <span>{commandMessage}</span>
          </div>
        )}
      </section>

      <section className="modern-tank-detail-panel">
        <div className="modern-panel-heading">
          <div>
            <p className="dashboard-eyebrow">Latest Sensor Cards</p>
            <h3>Readable water condition</h3>
          </div>
          <Gauge size={22} />
        </div>

        {latestReading ? (
          <div className="modern-tank-detail-metric-grid">
            <DetailMetricCard
              icon={Thermometer}
              label="Temperature"
              value={latestReading.normalized.temperatureLabel}
              status={latestReading.normalized.temperatureStatus}
            />

            <DetailMetricCard
              icon={Droplets}
              label="pH Status"
              value={latestReading.normalized.phStatus}
              status={latestReading.normalized.phStatus}
            />

            <DetailMetricCard
              icon={Waves}
              label="Turbidity Status"
              value={latestReading.normalized.turbidityStatus}
              status={latestReading.normalized.turbidityStatus}
            />

            <DetailMetricCard
              icon={Gauge}
              label="Water Depth"
              value={latestReading.normalized.waterLabel}
              status={latestReading.normalized.waterStatus}
            />
          </div>
        ) : (
          <EmptyBlock
            icon={Database}
            title="No sensor reading yet"
            text="No matching reading was found for this tank."
          />
        )}
      </section>

      <section className="modern-tank-detail-grid">
        <article className="modern-tank-detail-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Sensor History</p>
              <h3>Recent readings</h3>
            </div>
            <Database size={22} />
          </div>

          {enrichedReadings.length === 0 ? (
            <EmptyBlock
              icon={Database}
              title="No reading history"
              text="Sensor readings for this tank will appear here."
            />
          ) : (
            <div className="modern-tank-detail-table">
              <div className="modern-tank-detail-table-head">
                <span>Date</span>
                <span>Temp</span>
                <span>pH</span>
                <span>Turbidity</span>
                <span>Water</span>
                <span>Status</span>
              </div>

              {paginatedReadings.map((item) => (
                <div
                  className="modern-tank-detail-table-row"
                  key={item.reading?.id || item.index}
                >
                  <span>{formatDate(item.date)}</span>
                  <span>{item.normalized.temperatureLabel}</span>
                  <span>{item.normalized.phStatus}</span>
                  <span>{item.normalized.turbidityStatus}</span>
                  <span>{item.normalized.waterLabel}</span>
                  <span>
                    <b className={`modern-tank-status ${item.status}`}>
                      {item.status}
                    </b>
                  </span>
                </div>
              ))}

              {enrichedReadings.length > READINGS_PER_PAGE && (
                <div className="modern-tank-detail-pagination">
                  <button
                    type="button"
                    disabled={currentReadingPage === 1}
                    onClick={() =>
                      setReadingsPage((page) => Math.max(1, page - 1))
                    }
                  >
                    Previous
                  </button>

                  <span>
                    Page {currentReadingPage} of {totalReadingPages}
                  </span>

                  <button
                    type="button"
                    disabled={currentReadingPage === totalReadingPages}
                    onClick={() =>
                      setReadingsPage((page) =>
                        Math.min(totalReadingPages, page + 1)
                      )
                    }
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </article>

        <article className="modern-tank-detail-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Ammonia</p>
              <h3>Ammonia history</h3>
            </div>
            <AlertTriangle size={22} />
          </div>

          {ammoniaReadings.length === 0 ? (
            <EmptyBlock
              icon={AlertTriangle}
              title="No ammonia records"
              text="Ammonia readings will appear here once synced."
            />
          ) : (
            <div className="modern-tank-detail-list">
              {ammoniaReadings.slice(0, 8).map((item, index) => (
                <div className="modern-tank-detail-list-row" key={item?.id || index}>
                  <div>
                    <strong>
                      {getValue(
                        item,
                        ["ammonia_status", "status", "result", "level"],
                        "Ammonia Reading"
                      )}
                    </strong>
                    <span>{formatDate(getRecordDate(item))}</span>
                  </div>

                  <b>
                    {getValue(
                      item,
                      ["ammonia_ppm", "ammonia_value", "value", "ppm"],
                      "N/A"
                    )}
                  </b>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="modern-tank-detail-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Alerts</p>
              <h3>Tank alerts</h3>
            </div>
            <Bell size={22} />
          </div>

          {alerts.length === 0 ? (
            <EmptyBlock
              icon={CheckCircle2}
              title="No alerts"
              text="No alert records found for this tank."
            />
          ) : (
            <div className="modern-tank-detail-list">
              {alerts.slice(0, 8).map((item, index) => {
                const severity = getStatusSeverity([
                  item?.severity,
                  item?.priority,
                  item?.status,
                  item?.type,
                ]);

                return (
                  <div className="modern-tank-detail-list-row" key={item?.id || index}>
                    <div>
                      <strong>
                        {getValue(
                          item,
                          ["title", "alert_title", "type", "alert_type"],
                          `Alert ${index + 1}`
                        )}
                      </strong>
                      <span>
                        {getValue(
                          item,
                          ["message", "description", "body"],
                          "No alert message"
                        )}
                      </span>
                    </div>

                    <b className={`modern-tank-status ${severity}`}>
                      {severity}
                    </b>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="modern-tank-detail-panel">
          <div className="modern-panel-heading">
            <div>
              <p className="dashboard-eyebrow">Control Logs</p>
              <h3>Automation activity</h3>
            </div>
            <Settings size={22} />
          </div>

          {controlLogs.length === 0 ? (
            <EmptyBlock
              icon={Settings}
              title="No control logs"
              text="Feeder, pump, and other control actions will appear here."
            />
          ) : (
            <div className="modern-tank-detail-list">
              {controlLogs.slice(0, 8).map((item, index) => (
                <div className="modern-tank-detail-list-row" key={item?.id || index}>
                  <div>
                    <strong>
                      {getValue(
                        item,
                        ["action", "control_action", "command", "type"],
                        `Control Log ${index + 1}`
                      )}
                    </strong>
                    <span>{formatDate(getRecordDate(item))}</span>
                  </div>

                  <b>
                    {getValue(item, ["status", "result", "state"], "Logged")}
                  </b>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
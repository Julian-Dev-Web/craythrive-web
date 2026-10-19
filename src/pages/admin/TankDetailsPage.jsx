import useTankMonitoring from '../../hooks/useTankMonitoring';
import MonitoringSyncNotice from '../../components/MonitoringSyncNotice';
import { mergeSensorHistoryRows, currentSensorSafety } from '../../../supabase/functions/_shared/sensorReadingContract.js';
import { philippineDayBounds, philippineDateKey, timestampMs, formatPhilippineDateTime, compareTimestamps } from '../../utils/philippineTime';
import useServerTime from '../../hooks/useServerTime';
import { fetchServerTimestamp, getServerNowMs } from '../../services/serverTimeService';
import { formatMonitoringAlert, waterAutomationAlertSeverity } from "../../../supabase/functions/_shared/monitoringAlertPresentation.js";
import { formatRecordedPumpAction, getRecordedActionOutcome } from "../../../supabase/functions/_shared/tankActivity.js";
import { ACTIVE_COMMAND_STATUSES, isCommandActive, isCommandTerminal, STOP_COMMAND, RESUME_COMMAND } from '../../../supabase/functions/_shared/actuatorCommandLifecycle.js';
import { actuatorControlError, loadActuatorControlState, requestEmergencyControl } from '../../services/actuatorControlService';
import { queueFeedLockReset } from '../../services/feedTestService';
import { logDiagnostic, getSafeErrorMessage } from "../../utils/securityDiagnostics";
import { getAmmoniaLabel, getAmmoniaNumericValue, getAmmoniaScanDate, getLatestAmmoniaForTank, recordMatchesAmmoniaTank, recordMatchesMonitoringTank } from "../../utils/monitoringRecords";
import { loadAmmoniaHistory, loadSensorHistory } from "../../services/tankSnapshotService";
import SafetyBadge, { SafetyIcon } from "../../components/SafetyBadge";
import SensorSafeRange, { SensorReadingValue } from "../../components/SensorSafeRange";
import SensorRecommendations from "../../components/SensorRecommendations";
import TankActivityHistory from "../../components/TankActivityHistory";
import ManualFeedOptions from "../../components/ManualFeedOptions";
import AutomaticFeedingSettings from "../../components/AutomaticFeedingSettings";
import { dispenseCycleLabel, formatRecordedFeedingAction, isCompletedFeedCommand, isPairedFeedActuator, normalizeDispenseCycles } from '../../../supabase/functions/_shared/feederControl.js';
import { getTankPairingState } from "../../utils/tankPairing";
import { getTankPopulationLabel } from "../../utils/tankCreationRules";
import { getSafetyLabelSeverity, getSafetySeverity, getParameterExplanation, getSafetyStatusLabel } from "../../utils/statusHelpers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FlaskConical,
  Gauge,
  Info,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Settings,
  ShieldCheck,
  Thermometer,
  TimerReset,
  UserRound,
  Waves,
  Wifi,
  WifiOff,
} from "lucide-react";

import { isSupabaseConfigured, supabase } from "../../lib/supabase";

import {
  formatReadingTime,
  normalizeSensorReading,
  toNumberOrNull,
} from "../../utils/sensorReadingUtils";

import {
  evaluateReadingSafety,
  resolveTankThresholds,
} from "../../utils/thresholdEvaluation";

/* =========================================================
   TABLES
========================================================= */

const tankTables = ["tanks"];
const alertTables = ["alerts"];
const controlLogTables = ["device_commands"];

const READINGS_PER_PAGE = 5;

const ACTION_WAIT_MS = 5 * 60 * 1000;

const ACTION_COMMAND_TYPES = [
  "FEED_ONCE",
  "DRAIN_FOR",
  "REFILL_FOR",
];

const PUMP_COMMAND_TYPES = [
  "DRAIN_FOR",
  "REFILL_FOR",
];

const WATER_STABLE_REQUIRED_COUNT = 3;
const WATER_STABLE_MAX_SPREAD_CM = 0.7;

const SENSOR_FRESHNESS_MS =
  5 * 60 * 1000;

const PUMP_SETTLE_MS =
  90 * 1000;

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
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
}

/* =========================================================
   pH NUMERIC VALUE
========================================================= */

function getPhNumericLabel(reading) {
  const numberValue = normalizeSensorReading(reading).phValue;

  return numberValue !== null
    ? numberValue.toFixed(2)
    : null;
}

/* =========================================================
   AMMONIA NUMERIC VALUE
========================================================= */


/* =========================================================
   STATUS
========================================================= */

function getStatusSeverity(statuses) {
  const evaluatedSeverity = getSafetyLabelSeverity(statuses);
  if (evaluatedSeverity) return evaluatedSeverity;
  const joined = statuses
    .map(normalizeStatusText)
    .join(" ");

  if (
    joined.includes("critical") ||
    joined.includes("danger") ||
    joined.includes("unsafe") ||
    joined.includes("high ph") ||
    joined.includes("low ph") ||
    joined.includes("warm") ||
    joined.includes("cold") ||
    joined.includes("failed") ||
    joined.includes("rejected") ||
    joined.includes("offline")
  ) {
    return "critical";
  }

  if (
    joined.includes("warning") ||
    joined.includes("dirty") ||
    joined.includes("slightly") ||
    joined.includes("needs") ||
    joined.includes("moderate") ||
    joined.includes("pending") ||
    joined.includes("running") ||
    joined.includes("stale") ||
    joined.includes("setup")
  ) {
    return "warning";
  }

  return "normal";
}

function getOverallReadingStatus(normalizedReading) {
  return getSafetySeverity(normalizedReading.safety);
}


/* =========================================================
   FORMATTERS
========================================================= */

function formatDate(value) { return formatPhilippineDateTime(value); }

function getValue(
  row,
  keys,
  fallback = "N/A"
) {
  for (const key of keys) {
    if (
      row?.[key] !== null &&
      row?.[key] !== undefined &&
      row?.[key] !== ""
    ) {
      return row[key];
    }
  }

  return fallback;
}

/* =========================================================
   TANK HELPERS
========================================================= */

function getTankId(
  tank,
  index = 0
) {
  return (
    tank?.id ||
    tank?.tank_id ||
    tank?.uuid ||
    `tank-${index}`
  );
}

function getPrimaryTankId(
  tank,
  routeTankId = ""
) {
  return String(
    tank?.id ||
      tank?.tank_id ||
      tank?.uuid ||
      routeTankId ||
      ""
  );
}

function getTankName(
  tank,
  index = 0
) {
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
   RECORD MATCHING
========================================================= */

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

function getRecordDate(row) {
  return (
    row?.created_at ||
    row?.timestamp ||
    row?.date ||
    row?.updated_at ||
    ""
  );
}

function recordMatchesTank(
  row,
  tank
) {
  return recordMatchesMonitoringTank(row, tank);
}

function rowMatchesUser(
  row,
  userId
) {
  if (!userId) {
    return true;
  }

  const ids = [
    row?.user_id,
    row?.owner_id,
    row?.profile_id,
    row?.created_by,
    row?.farmer_id,
  ]
    .filter(Boolean)
    .map(String);

  if (ids.length === 0) {
    return true;
  }

  return ids.includes(
    String(userId)
  );
}

function uniqueRows(rows) {
  const map = new Map();

  rows.forEach(
    (row, index) => {
      const id =
        row?.id ||
        row?.uuid ||
        row?.tank_id ||
        row?.reading_id ||
        row?.alert_id ||
        row?.command_id ||
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
   TODAY RANGE
========================================================= */

async function getTodayRangeForSupabase() { return philippineDayBounds(philippineDateKey(await fetchServerTimestamp())); }

/* =========================================================
   COMMAND HELPERS
========================================================= */

function getCommandLabel(commandType) {
  const labels = {
    FEED_ONCE: "Feed",
    REFILL_FOR: "Add Water",
    DRAIN_FOR: "Drain Water",
    STOP_ALL: "Emergency Stop",
    RESUME_CONTROLS: "Resume Controls",
    RESET_FEED_LOCK: "Feed Test Reset",
  };

  return (
    labels[commandType] ||
    commandType ||
    "Action"
  );
}

function getShortResultMessage(
  command = {}
) {
  if (command.command_type === 'RESET_FEED_LOCK') {
    if (isCommandActive(command)) return 'Resetting feed test lock...';
    if (command.command_status === 'done') return 'Feed test reset. You may use Feed Now again.';
    return command.result_message || 'The feed test reset could not be confirmed.';
  }
  const feeding = formatRecordedFeedingAction(command, getRecordedActionOutcome(command, 'device_commands'));
  if (feeding) return feeding.message;
  const pump = formatRecordedPumpAction(command, 'device_commands');
  if (pump) return pump.message;
  const outcome = getRecordedActionOutcome(command, 'device_commands');
  if (outcome === "Unknown / Unconfirmed") return "Execution has not been confirmed.";
  if (outcome === "Pending Verification") return "The action is pending verification.";
  if (outcome === "In Progress") return "The actuator action is in progress.";
  if (outcome === "Completed") return "Device reports a completed command cycle; physical water flow or feed delivery is not measured.";
  const text =
    String(command.result_message || command.notes || "").trim();

  if (!text) {
    return "";
  }

  if (
    text
      .toLowerCase()
      .includes("rejected")
  ) {
    return `${text.split(".")[0]}.`;
  }

  if (text.length > 120) {
    return `${text.slice(
      0,
      120
    )}...`;
  }

  return text;
}

function getTimeMs(value) { return timestampMs(value) || 0; }

function formatCountdown(ms) {
  const totalSeconds =
    Math.max(
      0,
      Math.ceil(ms / 1000)
    );

  const minutes =
    Math.floor(
      totalSeconds / 60
    );

  const seconds =
    totalSeconds % 60;

  return `${minutes}:${String(
    seconds
  ).padStart(2, "0")}`;
}

function isActionCommand(
  commandType
) {
  return ACTION_COMMAND_TYPES.includes(
    commandType
  );
}

function isCompletedActionCommand(
  command
) {
  const commandType =
    command?.command_type ||
    command?.action ||
    "";

  const commandStatus =
    command?.command_status ||
    command?.status ||
    command?.result ||
    "";

  return (
    isActionCommand(
      commandType
    ) &&
    lower(commandStatus) ===
      "done"
  );
}

function isPumpCommand(
  commandOrType
) {
  const commandType =
    typeof commandOrType ===
    "string"
      ? commandOrType
      : commandOrType
          ?.command_type ||
        commandOrType?.action ||
        "";

  return PUMP_COMMAND_TYPES.includes(
    commandType
  );
}

function isCompletedPumpCommand(
  command
) {
  const commandStatus =
    command?.command_status ||
    command?.status ||
    command?.result ||
    "";

  return (
    isPumpCommand(command) &&
    lower(commandStatus) ===
      "done"
  );
}

/* =========================================================
   WATER SAFETY
========================================================= */

function getWaterCmFromReading(item) {
  const raw = [item?.reading?.water_depth_cm, item?.reading?.water_level, item?.normalized?.waterValue]
    .find(value => toNumberOrNull(value) !== null);

  const number =
    Number(raw);

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

function isBadWaterStatus(status) {
  const value =
    String(status || "")
      .trim()
      .toUpperCase()
      .replaceAll(" ", "_")
      .replaceAll("-", "_");

  return (
    value.includes("NO_READING") ||
    value.includes("NO_DATA") ||
    value.includes("INVALID") ||
    value.includes("ERROR") ||
    value.includes("SENSOR_STALE") ||
    value.includes("WAITING_FOR_FRESH_READING")
  );
}

function formatWaitSeconds(ms) {
  return `${Math.max(
    0,
    Math.ceil(ms / 1000)
  )}s`;
}

function getWaterStabilityState(
  enrichedReadings,
  latestPumpAction,
  nowMs
) {
  const latestReading =
    enrichedReadings[0] ||
    null;

  const latestReadingMs =
    getTimeMs(
      latestReading?.date
    );

  if (!latestReading) {
    return {
      canPump: false,
      level: "warning",
      title:
        "Waiting for water reading",
      message:
        "Water controls are temporarily unavailable until a fresh water-level reading is received.",
    };
  }

  if (nowMs === null) {
    return { canPump: false, level: 'warning', title: 'Waiting for server time',
      message: 'Server time is unavailable. Reconnect and retry.' };
  }

  if (
    !latestReadingMs ||
    nowMs -
      latestReadingMs >
      SENSOR_FRESHNESS_MS
  ) {
    return {
      canPump: false,
      level: "warning",
      title:
        "Water reading needs updating",
      message:
        "Refresh or wait for the sensor to send a newer reading before using the water controls.",
    };
  }

  const latestWaterStatus =
    latestReading?.normalized
      ?.waterStatus ||
    "";

  if (
    isBadWaterStatus(
      latestWaterStatus
    ) || latestReading?.normalized?.safety?.parameters.waterLevel.measurementFresh === false
  ) {
    return {
      canPump: false,
      level: "warning",
      title:
        "Water sensor is not ready",
      message:
        "Water controls are unavailable until the water-level sensor reports a valid reading.",
    };
  }

  const latestPumpTimeMs =
    getTimeMs(
      latestPumpAction
        ?.executed_at ||
        latestPumpAction
          ?.updated_at ||
        latestPumpAction
          ?.created_at
    );

  if (
    latestPumpTimeMs > 0
  ) {
    const settleRemainingMs =
      Math.max(
        0,
        latestPumpTimeMs +
          PUMP_SETTLE_MS -
          nowMs
      );

    if (
      settleRemainingMs > 0
    ) {
      return {
        canPump: false,
        level: "warning",
        title:
          "Water is settling",
        message: `Please wait ${formatWaitSeconds(
          settleRemainingMs
        )} before using another water control.`,
      };
    }

    if (
      latestReadingMs <=
      latestPumpTimeMs
    ) {
      return {
        canPump: false,
        level: "warning",
        title:
          "Waiting for a new reading",
        message:
          "A fresh sensor reading is needed after the last pump action.",
      };
    }
  }

  const validWaterValues =
    enrichedReadings
      .map((item) => {
        const waterStatus =
          item?.normalized
            ?.waterStatus ||
          "";

        if (
          isBadWaterStatus(
            waterStatus
          ) || item?.normalized?.safety?.parameters.waterLevel.measurementFresh === false
        ) {
          return null;
        }

        return getWaterCmFromReading(
          item
        );
      })
      .filter(
        (value) =>
          value !== null
      )
      .slice(
        0,
        WATER_STABLE_REQUIRED_COUNT
      );

  if (
    validWaterValues.length <
    WATER_STABLE_REQUIRED_COUNT
  ) {
    return {
      canPump: false,
      level: "warning",
      title:
        "Checking water level",
      message:
        "CrayThrive is waiting for enough stable water readings before enabling the pump controls.",
    };
  }

  const minValue =
    Math.min(
      ...validWaterValues
    );

  const maxValue =
    Math.max(
      ...validWaterValues
    );

  const spread =
    maxValue - minValue;

  if (
    spread >
    WATER_STABLE_MAX_SPREAD_CM
  ) {
    return {
      canPump: false,
      level: "warning",
      title:
        "Water reading is still moving",
      message:
        "Please wait until the water level becomes stable before using drain or refill.",
    };
  }

  return {
    canPump: true,
    level: "normal",
    title:
      "Water controls ready",
    message:
      "Water readings are stable.",
  };
}

/* =========================================================
   ALERT HELPERS
========================================================= */

function getSimpleAlertTitle(item) {
  const pump = formatMonitoringAlert(item);
  if (pump.title) return pump.title;
  return getValue(
    item,
    [
      "title",
      "alert_title",
      "type",
      "alert_type",
    ],
    "Tank alert"
  );
}

function getSimpleAlertMessage(item) {
  const message =
    formatMonitoringAlert(item).message ||
    getValue(
      item,
      [
        "message",
        "description",
        "body",
        "result_message",
      ],
      "Open the alert for more information."
    );

  if (
    String(message).length >
    150
  ) {
    return `${String(
      message
    ).slice(0, 150)}...`;
  }

  return message;
}

/* =========================================================
   ACTUATOR STATUS
========================================================= */

function getActuatorConnectionState(device, tank, nowMs) {
  if (!device) {
    const unpaired = getTankPairingState(tank) === 'Unpaired';
    return {
      label:
        unpaired ? "Unpaired" : "Not Connected",
      severity:
        unpaired ? "no-data" : "critical",
      icon:
        WifiOff,
      isConnected:
        false,
      detail:
        "No actuator is connected to this tank.",
    };
  }

  if (device.setup_mode) {
    return {
      label:
        "Setup Mode",
      severity:
        "warning",
      icon:
        WifiOff,
      isConnected:
        false,
      detail:
        "The actuator is currently being set up.",
    };
  }

  const rawStatus =
    lower(
      device.connection_status
    );

  const lastSeenValue =
    device.last_seen ||
    device.updated_at ||
    device.created_at;

  const lastSeenDate =
    lastSeenValue
      ? new Date(
          lastSeenValue
        )
      : null;

  const validLastSeen =
    lastSeenDate &&
    !Number.isNaN(
      lastSeenDate.getTime()
    );

  const minutesSinceSeen =
    validLastSeen && nowMs !== null
      ? (nowMs -
          lastSeenDate.getTime()) /
        60000
      : null;

  if (
    rawStatus.includes(
      "offline"
    )
  ) {
    return {
      label:
        "Offline",
      severity:
        "critical",
      icon:
        WifiOff,
      isConnected:
        false,
      detail: `Last connected: ${formatDate(
        lastSeenValue
      )}`,
    };
  }

  if (
    minutesSinceSeen !==
      null &&
    minutesSinceSeen > 3
  ) {
    return {
      label:
        "Needs Reconnection",
      severity:
        "warning",
      icon:
        Wifi,
      isConnected:
        false,
      detail: `Last connected: ${formatDate(
        lastSeenValue
      )}`,
    };
  }

  return {
    label:
      "Connected",
    severity:
      "normal",
    icon:
      Wifi,
    isConnected:
      true,
    detail:
      "Actuator is ready.",
  };
}

/* =========================================================
   CURRENT USER
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

  let profile = null;

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

/* =========================================================
   FETCH HELPERS
========================================================= */

async function fetchRowsNoColumnErrors(
  tableNames,
  currentUser,
  limit = 300
) {
  for (
    const tableName
    of tableNames
  ) {
    const ordered =
      await supabase
        .from(tableName)
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
      const rows =
        uniqueRows(
          ordered.data
        );

      if (
        currentUser.isAdmin
      ) {
        return {
          rows,
          tableUsed:
            tableName,
        };
      }

      const scopedRows =
        rows.filter(
          (row) =>
            rowMatchesUser(
              row,
              currentUser.id
            )
        );

      return {
        rows:
          scopedRows.length >
          0
            ? scopedRows
            : rows,

        tableUsed:
          tableName,
      };
    }

    const plain =
      await supabase
        .from(tableName)
        .select("*")
        .limit(limit);

    if (
      !plain.error &&
      Array.isArray(
        plain.data
      )
    ) {
      const rows =
        uniqueRows(
          plain.data
        );

      if (
        currentUser.isAdmin
      ) {
        return {
          rows,
          tableUsed:
            tableName,
        };
      }

      const scopedRows =
        rows.filter(
          (row) =>
            rowMatchesUser(
              row,
              currentUser.id
            )
        );

      return {
        rows:
          scopedRows.length >
          0
            ? scopedRows
            : rows,

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

async function fetchRowsByScope(
  tableNames,
  currentUser,
  limit = 300
) {
  return fetchRowsNoColumnErrors(
    tableNames,
    currentUser,
    limit
  );
}

async function fetchProfiles(
  currentUser
) {
  if (
    currentUser.isAdmin
  ) {
    return fetchRowsNoColumnErrors(
      ["profiles"],
      currentUser,
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
      rows: [byId.data],
      tableUsed:
        "profiles",
    };
  }

  return {
    rows: [],
    tableUsed:
      "profiles",
  };
}

/* =========================================================
   ACTUATOR LOOKUP
========================================================= */

async function fetchActuatorDeviceForTank(
  selectedTank,
  routeTankId
) {
  if (!selectedTank) {
    return null;
  }

  const commandTankId =
    getPrimaryTankId(
      selectedTank,
      routeTankId
    );

  const actuatorUidFromTank =
    selectedTank
      ?.actuator_device_uid ||
    selectedTank
      ?.actuator_uid ||
    selectedTank
      ?.actuator_device ||
    "";

  if (
    actuatorUidFromTank
  ) {
    const byUid =
      await supabase
        .from(
          "iot_devices"
        )
        .select("*")
        .eq(
          "device_uid",
          actuatorUidFromTank
        )
        .eq(
          "device_type",
          "actuator_hub"
        )
        .maybeSingle();

    if (
      !byUid.error &&
      byUid.data
    ) {
      return byUid.data;
    }
  }

  if (commandTankId) {
    const byTank =
      await supabase
        .from(
          "iot_devices"
        )
        .select("*")
        .eq(
          "tank_id",
          commandTankId
        )
        .eq(
          "device_type",
          "actuator_hub"
        )
        .eq(
          "is_claimed",
          true
        )
        .order(
          "updated_at",
          {
            ascending:
              false,
          }
        )
        .limit(1);

    if (
      !byTank.error &&
      Array.isArray(
        byTank.data
      ) &&
      byTank.data.length >
        0
    ) {
      return byTank.data[0];
    }
  }

  const ownerId =
    getTankOwnerId(
      selectedTank
    );

  if (ownerId) {
    const byOwner =
      await supabase
        .from(
          "iot_devices"
        )
        .select("*")
        .eq(
          "user_id",
          ownerId
        )
        .eq(
          "device_type",
          "actuator_hub"
        )
        .eq(
          "is_claimed",
          true
        )
        .order(
          "updated_at",
          {
            ascending:
              false,
          }
        )
        .limit(10);

    if (
      !byOwner.error &&
      Array.isArray(
        byOwner.data
      )
    ) {
      const tankKeys =
        getTankMatchKeys(
          selectedTank
        );

      return (
        byOwner.data.find(
          (device) =>
            [
              device?.tank_id,
              device?.device_uid,
              device?.id,
            ]
              .filter(Boolean)
              .map(String)
              .some((key) =>
                tankKeys.includes(
                  key
                )
              )
        ) ||
        byOwner.data[0] ||
        null
      );
    }
  }

  return null;
}

async function fetchActiveCommandsForActuator(
  selectedTank,
  actuatorDevice,
  routeTankId,
  requireVerified = false
) {
  if (
    !selectedTank ||
    !actuatorDevice?.device_uid
  ) {
    return [];
  }

  const commandTankId =
    getPrimaryTankId(
      selectedTank,
      routeTankId
    );

  const {
    data,
    error,
  } = await supabase
    .from("device_commands")
    .select("*")
    .eq(
      "tank_id",
      commandTankId
    )
    .eq(
      "device_uid",
      actuatorDevice.device_uid
    )
    .in(
      "command_status",
      ACTIVE_COMMAND_STATUSES
    )
    .order(
      "created_at",
      {
        ascending: false,
      }
    )
    .limit(10);

  if (
    error ||
    !Array.isArray(data)
  ) {
    if (requireVerified) throw new Error('Active commands could not be verified.');
    return [];
  }

  return data.filter(isCommandActive);
}

async function fetchTodaysFeedCommands(
  selectedTank,
  actuatorDevice,
  routeTankId,
  requireVerified = false
) {
  if (
    !selectedTank ||
    !actuatorDevice?.device_uid
  ) {
    return [];
  }

  const commandTankId =
    getPrimaryTankId(
      selectedTank,
      routeTankId
    );

  let range;
  try { range = await getTodayRangeForSupabase(); }
  catch (error) { if (requireVerified) throw error; return []; } // Sending needs trusted time.
  const { startIso, endIso } = range;

  const {
    data,
    error,
  } = await supabase
    .from("device_commands")
    .select("*")
    .eq(
      "tank_id",
      commandTankId
    )
    .eq(
      "device_uid",
      actuatorDevice.device_uid
    )
    .eq(
      "command_type",
      "FEED_ONCE"
    )
    .eq(
      "command_status",
      "done"
    )
    .gte(
      "created_at",
      startIso
    )
    .lt(
      "created_at",
      endIso
    )
    .order(
      "created_at",
      {
        ascending: false,
      }
    )
    .limit(5);

  if (
    error ||
    !Array.isArray(data)
  ) {
    if (requireVerified) throw new Error('Today’s feeding history could not be verified.');
    return [];
  }

  return data.filter(isCompletedFeedCommand);
}

/* =========================================================
   SMALL COMPONENTS
========================================================= */

function DetailMetricCard({ icon: Icon, label, value, severity, statusLabel, parameter, sensor, thresholds, scanDate, manualScan = false }) {
  const explanation = getParameterExplanation(parameter || { severity, label: statusLabel }, label);
  return (
    <article className="modern-tank-detail-metric">
      <span><Icon size={22} /></span>
      <div>
        <SensorReadingValue value={value} sensor={sensor} />
        <SensorSafeRange sensor={sensor} thresholds={thresholds} />
        <p>{label}</p>
        <SafetyBadge className="modern-tank-status" severity={severity} parameter={parameter} emptyLabel={manualScan ? "No Scan" : "No Data"} />
        {explanation && <small className="safety-explanation">{explanation}</small>}
        {manualScan && <small>Latest available ammonia scan</small>}
        {manualScan && value !== "No Scan" && <small>Scanned: {scanDate ? formatReadingTime(scanDate) : "Scan time unavailable"}</small>}
      </div>
    </article>
  );
}

function EmptyBlock({
  icon: Icon,
  title,
  text,
}) {
  return (
    <div className="modern-tank-detail-empty">
      <Icon size={28} />

      <strong>
        {title}
      </strong>

      <span>
        {text}
      </span>
    </div>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function TankDetailsPage() {
  const [dispenseCycles, setDispenseCycles] = useState(2);
  const [feedConfirmation, setFeedConfirmation] = useState(null);
  const [submittedCommand, setSubmittedCommand] = useState(null);
  const submittedCommandRef = useRef(null);
  const [actuatorControl, setActuatorControl] = useState({ verified: false });
  const [localStopLock, setLocalStopLock] = useState(null);
  const [emergencySending, setEmergencySending] = useState(false);
  const emergencySubmission = useRef(false);
  const emergencyEpoch = useRef(0);
  const [feedError, setFeedError] = useState('');
  const feedSubmission = useRef(false);
  const feedContext = useRef(null);
  const [ammoniaHistoryError, setAmmoniaHistoryError] = useState(false);
  const { tankId } =
    useParams();

  const [
    currentUser,
    setCurrentUser,
  ] = useState(null);

  const [
    tank,
    setTank,
  ] = useState(null);

  const [
    profiles,
    setProfiles,
  ] = useState([]);

  const [
    readings,
    setReadings,
  ] = useState([]);

  const [
    ammoniaReadings,
    setAmmoniaReadings,
  ] = useState([]);

  const [
    alerts,
    setAlerts,
  ] = useState([]);

  const [
    controlLogs,
    setControlLogs,
  ] = useState([]);

  const [
    actuatorDevice,
    setActuatorDevice,
  ] = useState(null);

  const [
    activeCommands,
    setActiveCommands,
  ] = useState([]);

  const [
    todaysFeedCommands,
    setTodaysFeedCommands,
  ] = useState([]);

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    readingsPage,
    setReadingsPage,
  ] = useState(1);


  const [
    isSendingCommand,
    setIsSendingCommand,
  ] = useState(false);

  const [
    commandMessage,
    setCommandMessage,
  ] = useState("");

  const [
    durationSeconds,
    setDurationSeconds,
  ] = useState("10");

  const [
    activeTankTab,
    setActiveTankTab,
  ] = useState("overview");

  const [
    commandWaitSeconds,
    setCommandWaitSeconds,
  ] = useState(0);

  const nowMs = useServerTime();
  useEffect(() => {
    feedContext.current = { tankId, userId: currentUser?.id };
    return () => { feedContext.current = null; };
  }, [tankId, currentUser?.id]);

  const monitoring = useTankMonitoring(tank?.id === tankId ? [tank] : []);
  const { rows: currentRows, thresholds: thresholdBundle, refresh: refreshMonitoring } = monitoring;
  const thresholds = useMemo(() => thresholdBundle ? resolveTankThresholds(thresholdBundle, tankId) : null, [thresholdBundle, tankId]);

  /* =======================================================
     LOAD
  ======================================================= */

  const pageLoadVersion = useRef(0);
  const controlRefreshVersion = useRef(0);
  const controlCommitVersion = useRef(0);
  const pendingControlRefresh = useRef(null);
  const loadTankDetails = useCallback(
    async (
      silent = false
    ) => {
      const version = ++pageLoadVersion.current;
      controlRefreshVersion.current++;
      const controlVersion = controlCommitVersion.current;
      refreshMonitoring();

      if (
        !isSupabaseConfigured ||
        !supabase
      ) {
        setIsLoading(false);
        return;
      }

      try {
        if (!silent) {
          setIsLoading(true);
        }

        const loadedUser =
          await getCurrentUserWithRole();

        if (version !== pageLoadVersion.current) return;
        setCurrentUser(
          loadedUser
        );

        if (
          !loadedUser.id
        ) {
          setTank(null);
          setActuatorDevice(
            null
          );
          setActiveCommands(
            []
          );
          setTodaysFeedCommands(
            []
          );

          return;
        }

        const [
          tankResult,
          readingResult,
          ammoniaResult,
          alertResult,
          logResult,
          profileResult,
        ] =
          await Promise.all([
            fetchRowsByScope(
              tankTables,
              loadedUser,
              400
            ),

            loadSensorHistory(loadedUser, { tankId, limit: 400 }),

            loadAmmoniaHistory(loadedUser, supabase, { tankId }),

            fetchRowsByScope(
              alertTables,
              loadedUser,
              300
            ),

            fetchRowsByScope(
              controlLogTables,
              loadedUser,
              300
            ),

            fetchProfiles(
              loadedUser
            ),
          ]);

        if (version !== pageLoadVersion.current) return;
        const selectedTank =
          tankResult.rows.find(
            (
              item,
              index
            ) => {
              const keys = [
                getTankId(
                  item,
                  index
                ),
                item?.id,
                item?.tank_id,
                item?.uuid,
                item?.device_uid,
                item?.iot_device_id,
                item?.actuator_device_uid,
              ]
                .filter(
                  Boolean
                )
                .map(
                  String
                );

              return keys.includes(
                String(tankId)
              );
            }
          ) || null;

        setAmmoniaHistoryError(ammoniaResult.error);
        setTank(
          selectedTank
        );

        setProfiles(
          profileResult.rows
        );

        let loadedActuator =
          null;

        let loadedActiveCommands =
          [];

        let loadedTodaysFeedCommands =
          [];

        if (selectedTank) {
          loadedActuator =
            await fetchActuatorDeviceForTank(
              selectedTank,
              tankId
            );

          loadedActiveCommands =
            await fetchActiveCommandsForActuator(
              selectedTank,
              loadedActuator,
              tankId
            );

          loadedTodaysFeedCommands =
            await fetchTodaysFeedCommands(
              selectedTank,
              loadedActuator,
              tankId
            );

          if (version !== pageLoadVersion.current || controlVersion !== controlCommitVersion.current) return;
          setReadings(
            readingResult.rows
              .filter((row) =>
                recordMatchesTank(
                  row,
                  selectedTank
                )
              )
              .sort(
                (a, b) =>
                  compareTimestamps(getRecordDate(
                      b
                    ), getRecordDate(
                      a
                    ))
              )
          );

          setAmmoniaReadings(
            ammoniaResult.rows
              .filter((row) =>
                recordMatchesAmmoniaTank(
                  row,
                  selectedTank
                )
              )
              .sort(
                (a, b) =>
                  compareTimestamps(getAmmoniaScanDate(
                      b
                    ), getAmmoniaScanDate(
                      a
                    ))
              )
          );

          setAlerts(
            alertResult.rows
              .filter((row) =>
                recordMatchesTank(
                  row,
                  selectedTank
                )
              )
              .sort(
                (a, b) =>
                  compareTimestamps(getRecordDate(
                      b
                    ), getRecordDate(
                      a
                    ))
              )
          );

          const { data: configurationLogs, error: configurationError } = await supabase.from("control_logs")
            .select("*").eq("user_id", loadedUser.id).eq("tank_id", selectedTank.id).eq("action_type", "threshold_updated")
            .order("created_at", { ascending: false }).limit(300);
          if (version !== pageLoadVersion.current || controlVersion !== controlCommitVersion.current) return;
          if (configurationError) logDiagnostic("Threshold activity loading error", configurationError);
          setControlLogs(
            [...logResult.rows, ...(configurationLogs || [])]
              .filter((row) =>
                recordMatchesTank(
                  row,
                  selectedTank
                )
              )
              .sort(
                (a, b) =>
                  compareTimestamps(getRecordDate(
                      b
                    ), getRecordDate(
                      a
                    ))
              )
          );
        } else {
          setReadings([]);
          setAmmoniaReadings(
            []
          );
          setAlerts([]);
          setControlLogs([]);
        }

        if (version !== pageLoadVersion.current || controlVersion !== controlCommitVersion.current) return;
        controlCommitVersion.current++;
        setActuatorDevice(
          loadedActuator
        );

        setActiveCommands(
          loadedActiveCommands
        );

        setTodaysFeedCommands(
          loadedTodaysFeedCommands
        );
      } catch (error) {
        logDiagnostic(
          "Tank details loading error:",
          error
        );
      } finally {
        if (!silent && version === pageLoadVersion.current) {
          setIsLoading(
            false
          );
        }
      }
    }, [refreshMonitoring, tankId]);

  useEffect(() => {
    loadTankDetails(false);
    const loadState = pageLoadVersion;
    return () => { loadState.current++; };
  }, [loadTankDetails]);

  useEffect(() => {
    setReadingsPage(1);
    setDispenseCycles(2);
    setFeedConfirmation(null);
    setFeedError('');
    setSubmittedCommand(null);
    submittedCommandRef.current = null;

    setCommandWaitSeconds(0);
    setCommandMessage("");
    setActiveTankTab(
      "overview"
    );
  }, [tankId]);

  const controlScope = JSON.stringify([tankId, currentUser?.id, actuatorDevice?.device_uid]);
  const trackedCommand = submittedCommand?.tank_id === tankId && submittedCommand?.user_id === currentUser?.id
    ? controlLogs.find(command => command.id === submittedCommand.id) || submittedCommand : null;
  const trackedFeed = trackedCommand?.command_type === 'FEED_ONCE' ? trackedCommand : null;
  const hasTrackedFeedPending = isCommandActive(trackedFeed);
  const currentActiveCommands = activeCommands.filter(isCommandActive);
  const hasActiveCommand = currentActiveCommands.length > 0 || isCommandActive(trackedCommand);
  const controlState = actuatorControl.scope === controlScope ? actuatorControl : { verified: false };
  const emergencyLatched = controlState.data?.emergency_stop_active === true;
  const normalControlsLocked = !controlState.verified || !!controlState.error || emergencyLatched || localStopLock === controlScope;

  const refreshTankControls = useCallback(async () => {
    if (!tank || tank.id !== tankId || !currentUser?.id) return;
    if (pendingControlRefresh.current?.tankId === tankId) return;
    const pending = { tankId };
    pendingControlRefresh.current = pending;
    const version = ++controlRefreshVersion.current;
    try {
      if (!actuatorDevice?.device_uid) return;
      const data = await loadActuatorControlState(supabase, { tankId, deviceUid: actuatorDevice.device_uid,
        userId: currentUser.id, commandId: submittedCommandRef.current?.id || null });
      if (version !== controlRefreshVersion.current) return;
      controlCommitVersion.current++;
      setActuatorControl({ scope: controlScope, verified: true, data });
      setActiveCommands(data.active_commands);
      const changed = [data.command, data.stop_command, data.resume_command, ...(data.terminal_commands || [])].filter(Boolean);
      if (changed.length) setControlLogs(previous => {
        const rows = new Map(previous.map(row => [row.id, row])); changed.forEach(row => rows.set(row.id, row)); return [...rows.values()];
      });
      if (isCommandTerminal(data.command)) {
        if (data.command.id === submittedCommandRef.current?.id) { submittedCommandRef.current = null; setSubmittedCommand(null); }
        setCommandMessage(getShortResultMessage(data.command) || data.command.result_message);
        if (data.command.command_type === 'FEED_ONCE') {
          const completedToday = isCompletedFeedCommand(data.command)
            && philippineDateKey(data.command.created_at) === philippineDateKey(getServerNowMs());
          setTodaysFeedCommands(previous => [...previous.filter(row => row.id !== data.command.id), ...(completedToday ? [data.command] : [])]);
        }
      }
      if (data.emergency_stop_active || data.resume_command?.command_status === 'done') setLocalStopLock(null);
    } catch (error) {
      if (version === controlRefreshVersion.current) setActuatorControl(previous => ({ ...previous, scope: controlScope, verified: false, error: actuatorControlError(error) }));
    }
    finally { if (pendingControlRefresh.current === pending) pendingControlRefresh.current = null; }
  }, [tank, tankId, currentUser, actuatorDevice, controlScope]);

  useEffect(() => {
    if (!tank || tank.id !== tankId || !isPairedFeedActuator(actuatorDevice, tank, tankId) || !currentUser?.id) return;
    const refreshVersion = controlRefreshVersion;
    let mounted = true;
    Promise.resolve().then(() => { if (mounted) void refreshTankControls(); });
    const visible = () => { if (document.visibilityState === 'visible') void refreshTankControls(); };
    window.addEventListener('focus', visible); window.addEventListener('online', visible); document.addEventListener('visibilitychange', visible);
    return () => { mounted = false; refreshVersion.current++; window.removeEventListener('focus', visible); window.removeEventListener('online', visible); document.removeEventListener('visibilitychange', visible); };
  }, [tank, tankId, actuatorDevice, currentUser, refreshTankControls]);

  useEffect(() => {
    if (!tankId || isLoading || !hasActiveCommand) {
      return;
    }

    const intervalMs = 1500;

    const interval =
      setInterval(() => {
        if (document.visibilityState === 'visible') void refreshTankControls();
      }, intervalMs);

    const controlState = controlRefreshVersion;
    return () => {
      controlState.current++;
      clearInterval(interval);
    };
  }, [
    tankId,
    isLoading,
    hasActiveCommand, refreshTankControls,
  ]);

  useEffect(() => {
    if (
      !hasActiveCommand
    ) {
      setCommandWaitSeconds(
        0
      );
      return;
    }

    const timer =
      setInterval(() => {
        setCommandWaitSeconds(
          (seconds) =>
            seconds + 1
        );
      }, 1000);

    return () =>
      clearInterval(timer);
  }, [hasActiveCommand]);



  /* =======================================================
     OWNER
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

  const owner =
    useMemo(() => {
      if (!tank) {
        return null;
      }

      const ownerId =
        getTankOwnerId(
          tank
        );

      return (
        profileMap.get(
          String(ownerId)
        ) ||
        profileMap.get(
          String(
            tank?.email ||
              ""
          ).toLowerCase()
        ) ||
        null
      );
    }, [
      tank,
      profileMap,
    ]);

  /* =======================================================
     READINGS
  ======================================================= */

  const enrichedReadings =
    useMemo(() => {
      return mergeSensorHistoryRows(readings, currentRows.sensor).map(
        (
          reading,
          index
        ) => {
          const normalized =
            normalizeSensorReading(reading, thresholds);

          const status =
            getOverallReadingStatus(
              normalized
            );

          return {
            reading,
            normalized,
            status,
            index,

            date: normalized.createdAt,
          };
        }
      );
    }, [readings, thresholds, currentRows.sensor]);

  const latestReading = useMemo(() => {
    const reading = currentRows.sensor[0];
    if (!reading) return null;
    const normalized = normalizeSensorReading(reading, thresholds);
    return { reading, normalized, date: normalized.createdAt };
  }, [currentRows.sensor, thresholds]);

  const latestAmmoniaRow = useMemo(() => getLatestAmmoniaForTank(tank, currentRows.ammonia), [tank, currentRows.ammonia]);
  const latestAmmoniaValue = useMemo(() => getAmmoniaNumericValue(latestAmmoniaRow), [latestAmmoniaRow]);

  const latestSafety =
    useMemo(() => {
      if (!thresholds) {
        return null;
      }

      return currentSensorSafety(evaluateReadingSafety(
        {
          temperature: latestReading?.normalized?.temperatureValue,
          ph: latestReading?.normalized?.phValue,
          turbidityVoltage:
            latestReading?.normalized?.turbidityValue,
          waterDepth:
            latestReading?.normalized?.waterValue,
          waterStatus: latestReading?.normalized?.raw?.water_status,
          waterMetadata: latestReading?.normalized?.raw?.raw_payload,
          temperatureStatus: latestReading?.normalized?.raw?.temperature_status,
          phStatus: latestReading?.normalized?.raw?.ph_status,
          turbidityStatus: latestReading?.normalized?.raw?.turbidity_status,
          ammonia: latestAmmoniaValue,
        },
        thresholds
      ), latestReading?.reading, monitoring.nowMs, monitoring.availability.verified);
    }, [latestReading, thresholds, latestAmmoniaValue, monitoring.nowMs, monitoring.availability.verified]);

  const totalReadingPages =
    Math.max(
      1,
      Math.ceil(
        enrichedReadings.length /
          READINGS_PER_PAGE
      )
    );

  const currentReadingPage =
    Math.min(
      readingsPage,
      totalReadingPages
    );

  const paginatedReadings =
    enrichedReadings.slice(
      (currentReadingPage -
        1) *
        READINGS_PER_PAGE,

      currentReadingPage *
        READINGS_PER_PAGE
    );

  /* =======================================================
     LOGS / ALERTS
  ======================================================= */

  const sortedControlLogs =
    useMemo(() => {
      return [
        ...controlLogs,
      ].sort(
        (a, b) =>
          compareTimestamps(getRecordDate(b), getRecordDate(a))
      );
    }, [controlLogs]);

  const sortedAlerts =
    useMemo(() => {
      return [
        ...alerts,
      ].sort(
        (a, b) =>
          compareTimestamps(getRecordDate(b), getRecordDate(a))
      );
    }, [alerts]);

  const latestCommandLog =
    sortedControlLogs.find(item => item.action_type !== "threshold_updated") ||
    null;
  const latestFeedPresentation = latestCommandLog ? formatRecordedFeedingAction(latestCommandLog, getRecordedActionOutcome(latestCommandLog, 'device_commands')) : null;
  const latestActionOutcome = latestFeedPresentation?.outcome || (latestCommandLog ? getRecordedActionOutcome(latestCommandLog, 'device_commands') : null);

  const latestAlert =
    sortedAlerts[0] ||
    null;

  const latestPumpAction =
    sortedControlLogs.find(
      isCompletedPumpCommand
    ) || null;

  /* =======================================================
     SAFETY STATE
  ======================================================= */

  const waterSafetyState =
    getWaterStabilityState(
      enrichedReadings,
      latestPumpAction,
      nowMs
    );

  const shouldBlockPumpCommands =
    !waterSafetyState.canPump;

  const latestCompletedAction =
    sortedControlLogs.find(
      isCompletedActionCommand
    ) || null;

  const latestCompletedActionTimeMs =
    getTimeMs(
      latestCompletedAction
        ?.executed_at ||
        latestCompletedAction
          ?.updated_at ||
        latestCompletedAction
          ?.created_at
    );

  const latestSensorReadingTimeMs =
    getTimeMs(
      latestReading?.date
    );

  const hasNewSensorReadingAfterAction =
    latestCompletedActionTimeMs >
      0 &&
    latestSensorReadingTimeMs >
      latestCompletedActionTimeMs;

  const actionWaitRemainingMs =
    latestCompletedActionTimeMs >
    0 && nowMs !== null
      ? Math.max(
          0,
          latestCompletedActionTimeMs +
            ACTION_WAIT_MS -
            nowMs
        )
      : 0;

  const shouldWaitForSensorRefresh =
    latestCompletedActionTimeMs >
      0 &&
    !hasNewSensorReadingAfterAction &&
    actionWaitRemainingMs >
      0;

  const actionWaitText =
    formatCountdown(
      actionWaitRemainingMs
    );

  const latestCompletedActionLabel =
    getCommandLabel(
      latestCompletedAction
        ?.command_type ||
        latestCompletedAction
          ?.action
    );

  const tankStatus = getSafetySeverity(latestSafety);

  const actuatorState =
    getActuatorConnectionState(actuatorDevice, tank, nowMs);

  const ActuatorIcon =
    actuatorState.icon;

  const hasFedToday =
    todaysFeedCommands.length >
    0;

  const latestFeedToday =
    todaysFeedCommands[0] ||
    null;

  const activeCommand =
    currentActiveCommands[0] ||
    (isCommandActive(trackedCommand) ? trackedCommand : null);
  const selectedCycles = normalizeDispenseCycles(dispenseCycles);
  const feedActuatorReady = isPairedFeedActuator(actuatorDevice, tank, getPrimaryTankId(tank, tankId));
  const activeFeedCommand = currentActiveCommands.find(command => command.command_type === 'FEED_ONCE') || (hasTrackedFeedPending ? trackedFeed : null);
  const latestFeedCommand = activeFeedCommand || trackedFeed || sortedControlLogs.find(command => command.command_type === 'FEED_ONCE');
  const feedingStatus = latestFeedCommand ? formatRecordedFeedingAction(latestFeedCommand, getRecordedActionOutcome(latestFeedCommand, 'device_commands')) : null;

  const isStuckLong =
    hasActiveCommand &&
    commandWaitSeconds >= 30;

  /* =======================================================
     CONTROL HELPERS
  ======================================================= */

  function getCommandDurationMs() {
    const seconds =
      Number(
        durationSeconds
      );

    if (
      !Number.isFinite(
        seconds
      ) ||
      seconds <= 0
    ) {
      return 10000;
    }

    return (
      Math.min(
        seconds,
        15
      ) * 1000
    );
  }

  async function refreshActuatorCommands() {
    await refreshTankControls();
  }

  async function requestFeedLockResetForTesting() {
    if (normalControlsLocked || emergencySubmission.current || hasActiveCommand || isSendingCommand) return;
    if (!window.confirm("Allow another feeding test today?\nThis clears only today's actuator feed lock. Water and feeding safety checks will still be applied.")) return;
    await sendDeviceCommand('RESET_FEED_LOCK');
  }

  /* =======================================================
     SEND COMMAND
  ======================================================= */

  function requestManualFeed() {
    setFeedError('');
    if (nowMs === null) { setCommandMessage('Server time is unavailable. Reconnect and retry.'); return; }
    if (!feedActuatorReady) { setFeedError('Actuator device is not connected to this tank.'); return; }
    if (normalControlsLocked || emergencySubmission.current || isSendingCommand || hasActiveCommand || shouldWaitForSensorRefresh || feedSubmission.current) return;
    setFeedConfirmation({ tankId, cycles: normalizeDispenseCycles(dispenseCycles) });
  }

  async function sendDeviceCommand(
    commandType,
    durationMs = 0,
    requestedCycles = dispenseCycles
  ) {
    if (commandType === STOP_COMMAND || commandType === RESUME_COMMAND) {
      if (emergencySubmission.current || !tank || !actuatorDevice?.device_uid || !currentUser?.id) return;
      emergencySubmission.current = true;
      setEmergencySending(true);
      if (commandType === STOP_COMMAND) {
        emergencyEpoch.current++;
        setLocalStopLock(controlScope);
        setFeedConfirmation(null);
        setCommandMessage('Emergency stop requested. Waiting for actuator...');
      }
      const requestContext = feedContext.current;
      try {
        const data = await requestEmergencyControl(supabase, { tankId: tank.id, deviceUid: actuatorDevice.device_uid,
          userId: currentUser.id, action: commandType });
        if (feedContext.current !== requestContext) return;
        controlRefreshVersion.current++;
        controlCommitVersion.current++;
        setActuatorControl({ scope: controlScope, verified: true, data });
        setActiveCommands(data.active_commands);
        const command = data.command;
        submittedCommandRef.current = isCommandActive(command) ? command : null;
        setSubmittedCommand(submittedCommandRef.current);
        const changed = [data.command, data.stop_command, data.resume_command, ...data.active_commands, ...(data.terminal_commands || [])].filter(Boolean);
        if (changed.length) setControlLogs(previous => {
          const rows = new Map(previous.map(row => [row.id, row])); changed.forEach(row => rows.set(row.id, row)); return [...rows.values()];
        });
        if (data.emergency_stop_active || data.resume_command?.command_status === 'done') setLocalStopLock(null);
        setCommandMessage(command?.result_message || 'Waiting for actuator...');
      } catch (error) {
        if (feedContext.current === requestContext) {
          setActuatorControl(previous => ({ ...previous, scope: controlScope, verified: false, error: actuatorControlError(error) }));
          setCommandMessage(actuatorControlError(error));
        }
      } finally { emergencySubmission.current = false; setEmergencySending(false); }
      return;
    }
    const isFeeding = commandType === 'FEED_ONCE';
    const commandEpoch = emergencyEpoch.current;
    const requestContext = feedContext.current;
    if (feedSubmission.current || emergencySubmission.current || normalControlsLocked) return;
    setCommandMessage("");
    if (isFeeding) setFeedError('');

    if (nowMs === null && commandType !== "STOP_ALL") {
      setCommandMessage("Server time is unavailable. Reconnect and retry.");
      return;
    }

    if (
      !isSupabaseConfigured ||
      !supabase
    ) {
      setCommandMessage(
        "The system is not connected to Supabase."
      );
      return;
    }

    if (!tank) {
      setCommandMessage(
        "No tank is selected."
      );
      return;
    }

    if (
      !actuatorDevice?.device_uid
    ) {
      setCommandMessage(
        "No actuator is connected to this tank. Connect the actuator first."
      );
      return;
    }

    if (
      hasActiveCommand &&
      commandType !==
        "STOP_ALL"
    ) {
      setCommandMessage(
        "Another action is still running. Please wait for it to finish."
      );
      return;
    }

    if (
      isPumpCommand(
        commandType
      ) &&
      shouldBlockPumpCommands
    ) {
      setCommandMessage(
        waterSafetyState.message
      );
      return;
    }

    if (
      commandType !==
        "STOP_ALL" &&
      isActionCommand(
        commandType
      ) &&
      shouldWaitForSensorRefresh
    ) {
      setCommandMessage(
        `Please wait ${actionWaitText} before another action, or wait for a fresh sensor reading after ${latestCompletedActionLabel}.`
      );

      return;
    }

    const commandTankId =
      getPrimaryTankId(
        tank,
        tankId
      );

    const commandUserId =
      actuatorDevice?.user_id ||
      getTankOwnerId(tank) ||
      currentUser?.id ||
      "";

    if (
      !commandTankId ||
      !commandUserId
    ) {
      setCommandMessage(
        "The tank or user information is incomplete."
      );
      return;
    }

    const commandValueMap = {
      FEED_ONCE: normalizeDispenseCycles(requestedCycles),
      DRAIN_FOR: "on",
      REFILL_FOR: "on",
      STOP_ALL: "stop",
      RESET_FEED_LOCK: "reset",
    };

    try {
      feedSubmission.current = true;
      setIsSendingCommand(
        true
      );

      let commandActuator = actuatorDevice;
      if (isFeeding) {
        commandActuator = await fetchActuatorDeviceForTank(tank, tankId);
        if (feedContext.current !== requestContext || emergencyEpoch.current !== commandEpoch) return;
        if (!isPairedFeedActuator(commandActuator, tank, commandTankId)) {
          setFeedError('Actuator device is not connected to this tank.');
          return;
        }
        const [pendingCommands, completedFeeds] = await Promise.all([
          fetchActiveCommandsForActuator(tank, commandActuator, tankId, true),
          fetchTodaysFeedCommands(tank, commandActuator, tankId, true),
        ]);
        if (feedContext.current !== requestContext || emergencyEpoch.current !== commandEpoch) return;
        if (pendingCommands.length) {
          setActiveCommands(pendingCommands);
          setCommandMessage('Another action is still running. Please wait for it to finish.');
          return;
        }
        setTodaysFeedCommands(completedFeeds);
        if (completedFeeds.length && !window.confirm('This tank was already fed today. Extra feeding can leave uneaten food and increase ammonia. Feed again anyway?')) {
          setCommandMessage('Feeding cancelled.');
          return;
        }
      }

      const payload = {
        user_id:
          commandUserId,

        tank_id:
          commandTankId,

        device_uid:
          commandActuator.device_uid,

        command_type:
          commandType,

        command_value:
          commandValueMap[
            commandType
          ] || "manual",

        duration_ms:
          isFeeding ? 0 : durationMs || 0,

        command_status:
          "pending",

        command_source: 'manual',
        status: "pending",
        result_message:
          "Command queued from web dashboard.",
      };

      const { data: inserted, error } = commandType === 'RESET_FEED_LOCK'
        ? { data: await queueFeedLockReset(supabase, { tankId: commandTankId, userId: commandUserId, deviceUid: commandActuator.device_uid }), error: null }
        : await supabase
          .from(
            "device_commands"
          )
          .insert(payload).select('*').single();
      if (feedContext.current !== requestContext || emergencyEpoch.current !== commandEpoch) return;

      if (error) {
        throw new Error(
          error.message
        );
      }

      if (!inserted?.id) throw new Error('The actuator request could not be confirmed.');
      controlRefreshVersion.current++;
      controlCommitVersion.current++;
      submittedCommandRef.current = inserted;
      setSubmittedCommand(inserted);
      setControlLogs(previous => [inserted, ...previous.filter(command => command.id !== inserted.id)]);

      const label =
        getCommandLabel(
          commandType
        );

      setCommandMessage(
        isFeeding ? `Feeding request sent — ${dispenseCycleLabel(normalizeDispenseCycles(requestedCycles))} requested.`
          : commandType === 'RESET_FEED_LOCK' ? 'Resetting feed test lock...' : `${label} request sent. Waiting for the device...`
      );

      setCommandWaitSeconds(
        0
      );

      setActiveTankTab(
        "controls"
      );

      await refreshTankControls();
    } catch (error) {
      if (feedContext.current !== requestContext || emergencyEpoch.current !== commandEpoch) return;
      if (isFeeding) setFeedError(getSafeErrorMessage(error, 'The feeding request could not be verified or sent. Refresh activity before retrying.'));
      else setCommandMessage(getSafeErrorMessage(error, "Could not send the action."));
    } finally {
      feedSubmission.current = false;
      setIsSendingCommand(
        false
      );
    }
  }

  /* =======================================================
     LOADING / NOT FOUND
  ======================================================= */

  if (isLoading) {
    return (
      <section className="modern-tank-loading">
        <Loader2
          className="spin-icon"
          size={34}
        />

        <h3>
          Loading tank...
        </h3>

        <p>
          Getting the latest
          information for this tank.
        </p>
      </section>
    );
  }

  if (!tank) {
    return (
      <section className="modern-tank-detail-empty-page">
        <Database size={34} />

        <h3>
          Tank not found
        </h3>

        <p>
          This tank could not
          be found or your account
          does not have access to it.
        </p>

        <Link
          to="/admin/tanks"
          className="modern-tank-link"
        >
          <ArrowLeft
            size={18}
          />

          Back to Tanks
        </Link>
      </section>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="modern-tank-detail-page sensor-recommendations-page">
      <SensorRecommendations key={tankId} tanks={tank ? [tank] : []} initialTankId={tankId} monitoring={monitoring} />

      {/* ===============================================
          HERO
      ================================================ */}

      <section className="modern-tank-detail-hero">

        <div>
          <Link
            to="/admin/tanks"
            className="modern-back-link"
          >
            <ArrowLeft
              size={18}
            />

            Back to Tanks
          </Link>

          <p className="dashboard-eyebrow">
            Tank Details
          </p>

          <h2>
            {getTankName(tank)}
          </h2>

          <p>
            Check the tank condition,
            control feeding and water,
            and review recent activity.
          </p>

          <div className="modern-tank-detail-actions">

            <button
              type="button"
              className="dashboard-primary-button"
              onClick={() =>
                loadTankDetails(
                  true
                )
              }
            >
              <RefreshCw
                size={18}
              />

              Refresh
            </button>

            <span>
              Last sensor update:{" "}
              <strong>
                {formatReadingTime(
                  latestReading?.date
                )}
              </strong>
            </span>
          </div>
        </div>

        <div className={`modern-tank-detail-hero-card safety-surface ${tankStatus}`}>

          <SafetyIcon severity={tankStatus} size={36} />

          <strong
            className={
              tankStatus
            }
          >
            {getSafetyStatusLabel(
              tankStatus
            )}
          </strong>

          <span>
            Current tank condition
          </span>
        </div>
      </section>

      {/* ===============================================
          SIMPLE INFORMATION
      ================================================ */}

      <section className="modern-tank-detail-info-grid">

        <article className="modern-tank-detail-info-card">

          <UserRound
            size={22}
          />

          <strong>
            {owner
              ? getProfileName(
                  owner
                )
              : "Unknown owner"}
          </strong>

          <span>
            Tank owner
          </span>
        </article>

        <article className="modern-tank-detail-info-card">

          <Droplets
            size={22}
          />

          <strong>
            {formatFriendlyText(
              getTankType(
                tank
              )
            )}
          </strong>

          <span>
            Tank type
          </span>
          {getTankPopulationLabel(tank) && <span className="tank-population-summary">Population: {getTankPopulationLabel(tank)}</span>}
        </article>

        <article className="modern-tank-detail-info-card">

          <Activity
            size={22}
          />

          <strong>
            {formatReadingTime(
              latestReading?.date
            )}
          </strong>

          <span>
            Latest water check
          </span>
        </article>

        <article className="modern-tank-detail-info-card">

          <ActuatorIcon
            size={22}
          />

          <strong>
            <b
              className={`modern-tank-status safety-status ${actuatorState.severity}`}
            >
              {actuatorState.label}
            </b>
          </strong>

          <span>
            Device connection
          </span>
        </article>
      </section>

      {/* ===============================================
          OPTIONAL TECHNICAL INFORMATION
      ================================================ */}

      <details className="modern-tank-technical-details">

        <summary>
          More technical information
        </summary>

        <div className="modern-tank-technical-grid">

          <div>
            <Camera size={18} />

            <span>
              <small>
                Device Reference
              </small>

              <strong>
                {actuatorDevice
                  ?.device_uid ||
                  tank
                    ?.actuator_device_uid ||
                  tank
                    ?.device_uid ||
                  tank
                    ?.iot_device_id ||
                  "Not connected"}
              </strong>
            </span>
          </div>

          <div>
            <ShieldCheck
              size={18}
            />

            <span>
              <small>
                Active Commands
              </small>

              <strong>
                {hasActiveCommand
                  ? activeCommands.length
                  : "None"}
              </strong>
            </span>
          </div>

          <div>
            <Wifi size={18} />

            <span>
              <small>
                Connection Details
              </small>

              <strong>
                {
                  actuatorState.detail
                }
              </strong>
            </span>
          </div>
        </div>
      </details>

      {/* ===============================================
          TABS
      ================================================ */}

      <div className="tank-tabs">

        <button
          type="button"
          className={
            activeTankTab ===
            "overview"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveTankTab(
              "overview"
            )
          }
        >
          Overview
        </button>

        <button
          type="button"
          className={
            activeTankTab ===
            "controls"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveTankTab(
              "controls"
            )
          }
        >
          Controls
        </button>

        <button
          type="button"
          className={
            activeTankTab ===
            "readings"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveTankTab(
              "readings"
            )
          }
        >
          Readings
        </button>

        <button
          type="button"
          className={
            activeTankTab ===
            "alerts"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveTankTab(
              "alerts"
            )
          }
        >
          Alerts
        </button>

        <button
          type="button"
          className={
            activeTankTab ===
            "logs"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveTankTab(
              "logs"
            )
          }
        >
          Activity
        </button>
      </div>

      {/* ===============================================
          OVERVIEW TAB
      ================================================ */}

      {activeTankTab ===
        "overview" && (
        <>

          {/* SAFE RANGE STATUS */}

      <MonitoringSyncNotice monitoring={monitoring} reading={latestReading?.reading} />
          {latestSafety && (
            <section
              className={`modern-tank-safety-banner safety-surface ${getSafetySeverity(latestSafety)}`}
            >
              <div className="modern-tank-safety-banner-icon">
                <SafetyIcon severity={getSafetySeverity(latestSafety)} size={24} />
              </div>

              <div className="modern-tank-safety-banner-text">
                <strong>
                  {getSafetyStatusLabel(getSafetySeverity(latestSafety))}
                </strong>

                <span>Checked using saved thresholds and available device severity</span>

                {!latestSafety.isSafe && (
                  <ul className="modern-tank-safety-issue-list">
                    {latestSafety.issues.map((issue) => (
                      <li key={issue.key}>
                        <b>{issue.label}:</b> {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          <section className="modern-tank-detail-panel">

            <div className="modern-panel-heading">

              <div>
                <p className="dashboard-eyebrow">
                  Current Status
                </p>

                <h3 data-tour="tank-monitoring">
                  Water condition
                </h3>
              </div>

              <Gauge
                size={22}
              />
            </div>

              <div className="modern-tank-detail-metric-grid">

                <DetailMetricCard
                  icon={
                    Thermometer
                  }
                  label="Temperature"
                  sensor="temperature" thresholds={latestSafety?.activeThresholds} parameter={latestSafety?.parameters.temperature}
                  value={
                    latestReading
                      ?.normalized
                      ?.temperatureLabel || "No Data"
                  }
                  severity={
                    latestSafety
                      ?.parameters
                      ?.temperature
                      ?.severity
                  }
                  statusLabel={
                    latestSafety
                      ?.parameters
                      ?.temperature
                      ?.label
                  }
                />

                <DetailMetricCard
                  icon={
                    Droplets
                  }
                  label="pH Level"
                  sensor="ph" thresholds={latestSafety?.activeThresholds} parameter={latestSafety?.parameters.ph}
                  value={
                    getPhNumericLabel(
                      latestReading?.reading
                    ) ||
                    latestReading
                      ?.normalized
                      ?.phStatus || "No Data"
                  }
                  severity={
                    latestSafety
                      ?.parameters
                      ?.ph
                      ?.severity
                  }
                  statusLabel={
                    latestSafety
                      ?.parameters
                      ?.ph
                      ?.label
                  }
                />

                <DetailMetricCard
                  icon={
                    Waves
                  }
                  label="Water Clarity"
                  sensor="turbidity" thresholds={latestSafety?.activeThresholds} parameter={latestSafety?.parameters.turbidity}
                  value={
                    latestReading
                      ?.normalized
                      ?.turbidityNumberLabel || "No Data"
                  }
                  severity={
                    latestSafety
                      ?.parameters
                      ?.turbidity
                      ?.severity
                  }
                  statusLabel={
                    latestSafety
                      ?.parameters
                      ?.turbidity
                      ?.label
                  }
                />

                <DetailMetricCard
                  icon={
                    Gauge
                  }
                  label="Water Level"
                  sensor="waterLevel" thresholds={latestSafety?.activeThresholds}
                  parameter={latestSafety?.parameters?.waterLevel}
                  value={
                    latestReading
                      ?.normalized
                      ?.waterLabel || "No Data"
                  }
                  severity={
                    latestSafety
                      ?.parameters
                      ?.waterLevel
                      ?.severity
                  }
                  statusLabel={
                    latestSafety
                      ?.parameters
                      ?.waterLevel
                      ?.label
                  }
                />

                <DetailMetricCard
                  icon={
                    FlaskConical
                  }
                  label="Ammonia"
                  sensor="ammonia" thresholds={latestSafety?.activeThresholds} parameter={latestSafety?.parameters.ammonia}
                  manualScan scanDate={getAmmoniaScanDate(latestAmmoniaRow)}
                  value={
                    latestAmmoniaValue ===
                      null
                      ? "No Scan"
                      : getAmmoniaLabel(latestAmmoniaValue)
                  }
                  severity={
                    latestSafety
                      ?.parameters
                      ?.ammonia
                      ?.severity ||
                    "neutral"
                  }
                  statusLabel={
                    latestSafety
                      ?.parameters
                      ?.ammonia
                      ?.label ||
                    "No Scan Yet"
                  }
                />
              </div>
            {!latestReading && (
              <EmptyBlock
                icon={Database}
                title="No water reading yet"
                text="This tank has not sent a recent sensor reading."
              />
            )}
          </section>

          {/* LATEST ALERT */}

          {latestAlert && (
            <section className="modern-tank-detail-panel">

              <div className="modern-panel-heading">

                <div>
                  <p className="dashboard-eyebrow">
                    Latest Alert
                  </p>

                  <h3>
                    Something may need your attention
                  </h3>
                </div>

                <Bell
                  size={22}
                />
              </div>

              <div className="command-status-card">

                <div>
                  <strong>
                    {getSimpleAlertTitle(
                      latestAlert
                    )}
                  </strong>

                  <p>
                    {getSimpleAlertMessage(
                      latestAlert
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setActiveTankTab(
                      "alerts"
                    )
                  }
                >
                  View Alerts
                </button>
              </div>
            </section>
          )}

          {/* LATEST ACTION */}

          {latestCommandLog && (
            <section className="modern-tank-detail-panel">

              <div className="modern-panel-heading">

                <div>
                  <p className="dashboard-eyebrow">
                    Latest Action
                  </p>

                  <h3>
                    Recent tank control
                  </h3>
                </div>

                <Settings
                  size={22}
                />
              </div>

              <div className="command-status-card">

                <div>
                  <strong>
                    {latestFeedPresentation?.title || formatRecordedPumpAction(latestCommandLog || {}, 'device_commands')?.title || getCommandLabel(latestCommandLog?.command_type || latestCommandLog?.action)}
                  </strong>

                  <p>
                    Status:{" "}

                    <b className={`modern-tank-status ${latestActionOutcome === "Completed" ? "normal" : latestActionOutcome === "Failed" ? "critical" : ["Blocked", "Rejected", "Executed – Rechecking"].includes(latestActionOutcome) ? "warning" : "no-data"}`}>
                      {latestActionOutcome}
                    </b>

                    {getShortResultMessage(latestCommandLog)
                      ? ` • ${getShortResultMessage(
                          latestCommandLog
                        )}`
                      : ""}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setActiveTankTab(
                      "logs"
                    )
                  }
                >
                  View Activity
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {/* ===============================================
          CONTROLS TAB
      ================================================ */}

      {activeTankTab ===
        "controls" && (
        <section className="modern-tank-detail-panel">

          <div className="modern-panel-heading">

            <div>
              <p className="dashboard-eyebrow">
                Tank Controls
              </p>

              <h3>
                Feeding and water
              </h3>
            </div>

            <Settings
              size={22}
            />
          </div>

          {/* CONNECTION */}

          <div className="modern-device-command-note">

            <ActuatorIcon
              size={17}
            />

            <span>
              Device:{" "}

              <b
                className={`modern-tank-status ${actuatorState.severity}`}
              >
                {actuatorState.label}
              </b>
            </span>
          </div>

          {/* PUMP TIME */}

          <div className="modern-device-command-note">

            <TimerReset
              size={17}
            />

            <span>
              Pump run time:

              <input
                type="number"
                min="1"
                max="15"
                value={
                  durationSeconds
                }
                onChange={(
                  event
                ) =>
                  setDurationSeconds(
                    event
                      .target
                      .value
                  )
                }
              />

              seconds
            </span>
          </div>

          {/* ACTIVE COMMAND */}

          {hasActiveCommand && (
            <div className="command-status-card waiting">

              <div>
                <strong>
                  Action in progress
                </strong>

                <p>
                  {getCommandLabel(
                    activeCommand
                      ?.command_type
                  )}{" "}
                  is{" "}
                  {formatFriendlyText(
                    activeCommand
                      ?.command_status ||
                      "pending"
                  )}
                  . Waiting{" "}
                  {
                    commandWaitSeconds
                  }
                  s...
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  refreshTankControls()
                }
              >
                Refresh
              </button>
            </div>
          )}

          {/* SENSOR WAIT */}

          {shouldWaitForSensorRefresh &&
            !hasActiveCommand && (
              <div className="command-status-card sensor-wait">

                <div>
                  <strong>
                    Waiting for updated water reading
                  </strong>

                  <p>
                    Please wait{" "}
                    {
                      actionWaitText
                    }{" "}
                    before another action.
                  </p>

                  <small>
                    Latest update:{" "}
                    {formatReadingTime(
                      latestReading
                        ?.date
                    )}
                  </small>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    loadTankDetails(
                      true
                    )
                  }
                >
                  Refresh
                </button>
              </div>
            )}

          {/* WATER SAFETY */}

          {shouldBlockPumpCommands &&
            !hasActiveCommand &&
            !shouldWaitForSensorRefresh && (
              <div className="command-status-card sensor-wait">

                <div>
                  <strong>
                    {
                      waterSafetyState.title
                    }
                  </strong>

                  <p>
                    {
                      waterSafetyState.message
                    }
                  </p>

                  <small>
                    Latest update:{" "}
                    {formatReadingTime(
                      latestReading
                        ?.date
                    )}
                  </small>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    loadTankDetails(
                      true
                    )
                  }
                >
                  Refresh
                </button>
              </div>
            )}

          {/* STUCK */}

          {isStuckLong && (
            <div className="command-status-card waiting">

              <div>
                <strong>
                  The action is taking longer than expected
                </strong>

                <p>
                  Check the actuator connection or refresh actuator state. Emergency Stop remains available; refreshing does not complete the action.
                </p>
              </div>
            </div>
          )}

          {/* FED TODAY */}

          {hasFedToday && (
            <div className="modern-device-command-message warning">

              <AlertTriangle
                size={18}
              />

              <span>
                This tank was already
                fed today
                {latestFeedToday
                  ?.created_at
                  ? ` at ${formatDate(
                      latestFeedToday.created_at
                    )}`
                  : ""}
                .
              </span>
            </div>
          )}

          {/* ACTION BUTTONS */}

          {(normalControlsLocked || emergencySending) && <div className="command-status-card" role="status" data-emergency-state>
            <div><strong>{emergencyLatched || localStopLock === controlScope ? 'Emergency stop active' : 'Verifying actuator controls'}</strong>
              <p>{controlState.error || (isCommandActive(controlState.data?.stop_command)
                ? 'Emergency stop requested. Waiting for actuator...'
                : controlState.data?.stop_command?.command_status === 'failed' ? controlState.data.stop_command.result_message
                  : emergencyLatched && controlState.data?.applied_at ? 'The actuator reports pumps and feeder stopped. Resume controls explicitly before a new action.'
                    : 'Normal controls remain locked until actuator state is verified.')}</p>
              {isCommandActive(controlState.data?.resume_command) && <p>Resume requested. Waiting for actuator...</p>}
            </div>
            {emergencyLatched && <button type="button" disabled={emergencySending || !controlState.verified || !controlState.data?.applied_at
              || isCommandActive(controlState.data?.resume_command) || currentActiveCommands.some(row => ![STOP_COMMAND, RESUME_COMMAND].includes(row.command_type))}
              onClick={() => sendDeviceCommand(RESUME_COMMAND)}>Resume Controls</button>}
            <button type="button" onClick={() => refreshTankControls()}>Refresh actuator state</button>
          </div>}

          <AutomaticFeedingSettings key={tankId} tank={tank} nowMs={nowMs}
            lastFeed={sortedControlLogs.find(isCompletedFeedCommand)} />

          <h4 className="manual-feeding-heading">Manual Feed Now</h4>
          <ManualFeedOptions cycles={activeFeedCommand ? feedingStatus?.cycles ?? selectedCycles : selectedCycles} onChange={setDispenseCycles}
            disabled={normalControlsLocked || isSendingCommand || hasActiveCommand}
            confirmation={feedConfirmation?.tankId === tankId ? feedConfirmation : null}
            busy={isSendingCommand}
            onCancel={() => setFeedConfirmation(null)}
            onConfirm={() => {
              if (feedConfirmation?.tankId !== tankId) return;
              const cycles = normalizeDispenseCycles(feedConfirmation.cycles);
              setFeedConfirmation(null);
              void sendDeviceCommand('FEED_ONCE', 0, cycles);
            }} />
          {!feedActuatorReady && <p className="manual-feed-note">Actuator device is not connected to this tank.</p>}
          {feedError && <div className="modern-device-command-message warning" role="alert"><AlertTriangle size={18} /><span>{feedError}</span></div>}
          {feedingStatus && <div className={`command-status-card manual-feed-status ${feedingStatus.outcome?.toLowerCase()}`} role="status" data-feed-status={feedingStatus.outcome}>
            <div>
              <strong>{feedingStatus.title}</strong>
              <p>{feedingStatus.message}</p>
              <small>Source: {feedingStatus.sourceLabel}</small>
              {feedingStatus.cycles !== null && <small>Dispense cycles: {feedingStatus.cycles}</small>}
              {(latestFeedCommand.result_message || latestFeedCommand.reason || latestFeedCommand.notes) && <small>Device report: {latestFeedCommand.result_message || latestFeedCommand.reason || latestFeedCommand.notes}</small>}
            </div>
            {['Pending Verification', 'In Progress'].includes(feedingStatus.outcome) ? <Loader2 className="spin-icon" size={18} aria-hidden="true" />
              : feedingStatus.outcome === 'Completed' ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
          </div>}

          <div className="modern-device-command-grid">

            <button
              type="button"
              disabled={
                normalControlsLocked ||
                isSendingCommand ||
                !feedActuatorReady ||
                hasActiveCommand ||
                shouldWaitForSensorRefresh
              }
              onClick={requestManualFeed}
            >
              {activeFeedCommand ? <Loader2 className="spin-icon" size={20} /> : <Play size={20} />}

              <strong>
                {activeFeedCommand ? 'Feeding…' : 'Feed Now'}
              </strong>

              <span>
                {activeFeedCommand && feedingStatus?.cycles === null ? 'Dispense cycles not recorded'
                  : dispenseCycleLabel(activeFeedCommand ? feedingStatus?.cycles ?? selectedCycles : selectedCycles)}{activeFeedCommand && feedingStatus?.cycles !== null ? ' requested' : ''}
              </span>
            </button>

            <button
              type="button"
              disabled={
                normalControlsLocked ||
                isSendingCommand ||
                !actuatorDevice
                  ?.device_uid ||
                hasActiveCommand ||
                shouldWaitForSensorRefresh ||
                shouldBlockPumpCommands
              }
              onClick={() =>
                sendDeviceCommand(
                  "REFILL_FOR",
                  getCommandDurationMs()
                )
              }
            >
              <Droplets
                size={20}
              />

              <strong>
                Add Water
              </strong>

              <span>
                Refill the tank safely
              </span>
            </button>

            <button
              type="button"
              disabled={
                normalControlsLocked ||
                isSendingCommand ||
                !actuatorDevice
                  ?.device_uid ||
                hasActiveCommand ||
                shouldWaitForSensorRefresh ||
                shouldBlockPumpCommands
              }
              onClick={() =>
                sendDeviceCommand(
                  "DRAIN_FOR",
                  getCommandDurationMs()
                )
              }
            >
              <Waves
                size={20}
              />

              <strong>
                Drain Water
              </strong>

              <span>
                Remove water safely
              </span>
            </button>

            <button
              type="button"
              disabled={
                emergencySending ||
                !actuatorDevice
                  ?.device_uid
              }
              onClick={() =>
                sendDeviceCommand(
                  "STOP_ALL",
                  0
                )
              }
              className="danger"
            >
              <Power
                size={20}
              />

              <strong>
                Emergency Stop
              </strong>

              <span>
                Stop pumps and feeder
              </span>
            </button>
          </div>

          {/* MESSAGE */}

          {commandMessage && (
            <div className="modern-device-command-message">

              <Info size={18} />

              <span>
                {
                  commandMessage
                }
              </span>
            </div>
          )}

          {/* ADVANCED */}

          <details className="modern-tank-advanced-controls">

            <summary>
              Advanced / Troubleshooting
            </summary>

            <p>
              These options are mainly
              for testing or recovering
              from a device problem.
            </p>

            <div className="modern-device-command-actions">

              <button
                type="button"
                disabled={
                  isSendingCommand ||
                  !hasActiveCommand
                }
                onClick={
                  refreshActuatorCommands
                }
              >
                Refresh Actuator State
              </button>

              <div><h4>Feeding Test</h4>
              <p>Allows another manual feeding test today by clearing the actuator?s local daily feed lock. Normal sensor safety rules still apply.</p>
              <button
                type="button"
                disabled={
                  normalControlsLocked || hasActiveCommand || !feedActuatorReady ||
                  isSendingCommand
                }
                onClick={
                  requestFeedLockResetForTesting
                }
                className="warning"
              >
                {isCommandActive(trackedCommand) && trackedCommand.command_type === 'RESET_FEED_LOCK' ? 'Resetting feed test lock...' : 'Allow Another Feed Test Today'}
              </button></div>
            </div>
          </details>
        </section>
      )}

      {/* ===============================================
          READINGS TAB
      ================================================ */}

      {activeTankTab ===
        "readings" && (
        <section className="modern-tank-detail-grid">

          <article className="modern-tank-detail-panel">

            <div className="modern-panel-heading">

              <div>
                <p className="dashboard-eyebrow">
                  Water History
                </p>

                <h3>
                  Recent readings
                </h3>
              </div>

              <Database
                size={22}
              />
            </div>

            {enrichedReadings.length ===
            0 ? (
              <EmptyBlock
                icon={Database}
                title="No reading history"
                text="Water readings from this tank will appear here."
              />
            ) : (
              <div className="modern-tank-detail-table">

                <div className="modern-tank-detail-table-head">

                  <span>
                    Date
                  </span>

                  <span>
                    Temp
                  </span>

                  <span>
                    pH
                  </span>

                  <span>
                    Clarity
                  </span>

                  <span>
                    Water
                  </span>

                  <span>
                    Status
                  </span>
                </div>

                {paginatedReadings.map(
                  (item) => (
                    <div
                      className="modern-tank-detail-table-row"
                      key={
                        item
                          .reading
                          ?.id ||
                        item.index
                      }
                    >
                      <span>
                        {formatDate(
                          item.date
                        )}
                      </span>

                      <span>
                        {
                          item
                            .normalized
                            .temperatureLabel
                        }
                      </span>

                      <span>
                        {getPhNumericLabel(
                          item.reading
                        ) ||
                          formatFriendlyText(
                            item
                              .normalized
                              .phStatus
                          )}
                      </span>

                      <span>
                        {formatFriendlyText(
                          item
                            .normalized
                            .turbidityStatus
                        )}
                      </span>

                      <span>
                        {
                          item
                            .normalized
                            .waterLabel
                        }
                      </span>

                      <span>
                        <SafetyBadge className="modern-tank-status" severity={item.status} />
                      </span>
                    </div>
                  )
                )}

                {enrichedReadings.length >
                  READINGS_PER_PAGE && (
                  <div className="modern-tank-detail-pagination">

                    <button
                      type="button"
                      disabled={
                        currentReadingPage ===
                        1
                      }
                      onClick={() =>
                        setReadingsPage(
                          (page) =>
                            Math.max(
                              1,
                              page -
                                1
                            )
                        )
                      }
                    >
                      Previous
                    </button>

                    <span>
                      Page{" "}
                      {
                        currentReadingPage
                      }{" "}
                      of{" "}
                      {
                        totalReadingPages
                      }
                    </span>

                    <button
                      type="button"
                      disabled={
                        currentReadingPage ===
                        totalReadingPages
                      }
                      onClick={() =>
                        setReadingsPage(
                          (page) =>
                            Math.min(
                              totalReadingPages,
                              page +
                                1
                            )
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

          {/* AMMONIA */}

          <article className="modern-tank-detail-panel">

            <div className="modern-panel-heading">

              <div>
                <p className="dashboard-eyebrow">
                  Ammonia
                </p>

                <h3>
                  Ammonia checks
                </h3>
              </div>

              <AlertTriangle
                size={22}
              />
            </div>

            {ammoniaHistoryError && ammoniaReadings.length > 0 && <p role="alert">Ammonia history could not be fully loaded. Refresh to try again.</p>}
            {ammoniaReadings.length ===
            0 ? (
              <EmptyBlock
                icon={
                  AlertTriangle
                }
                title={ammoniaHistoryError ? "Ammonia history unavailable" : "No ammonia scan yet"}
                text={ammoniaHistoryError ? "Refresh to try loading the manual scans again." : "Ammonia test-strip results scanned using the mobile app will appear here."}
              />
            ) : (
              <div className="modern-tank-detail-list">
                {ammoniaReadings
                  .slice(0, 8)
                  .map(
                    (
                      item,
                      index
                    ) => (
                      <div
                        className="modern-tank-detail-list-row"
                        key={
                          item?.id ||
                          index
                        }
                      >
                        <div>
                          <strong>
                            <SafetyBadge severity={evaluateReadingSafety({ ammonia: getAmmoniaNumericValue(item) }, thresholds).parameters.ammonia.severity} emptyLabel="No Scan" />
                          </strong>

                          <span>
                            {formatDate(
                              getAmmoniaScanDate(item)
                            )}
                          </span>
                        </div>

                        <b>
                          {getAmmoniaLabel(getAmmoniaNumericValue(item))}
                        </b>
                      </div>
                    )
                  )}
              </div>
            )}
          </article>
        </section>
      )}

      {/* ===============================================
          ALERTS TAB
      ================================================ */}

      {activeTankTab ===
        "alerts" && (
        <section className="modern-tank-detail-panel">

          <div className="modern-panel-heading">

            <div>
              <p className="dashboard-eyebrow">
                Alerts
              </p>

              <h3>
                Tank notifications
              </h3>
            </div>

            <Bell
              size={22}
            />
          </div>

          {sortedAlerts.length ===
          0 ? (
            <EmptyBlock
              icon={
                CheckCircle2
              }
              title="No alerts"
              text="There are no recent alerts for this tank."
            />
          ) : (
            <div className="modern-tank-detail-list">

              {sortedAlerts
                .slice(0, 12)
                .map(
                  (
                    item,
                    index
                  ) => {
                    const severity = waterAutomationAlertSeverity(item) ||
                      getStatusSeverity(
                        [
                          item?.severity,
                          item?.priority,
                          item?.status,
                          item?.type,
                        ]
                      );

                    return (
                      <div
                        className="modern-tank-detail-list-row"
                        key={
                          item?.id ||
                          item?.command_id ||
                          index
                        }
                      >
                        <div>
                          <strong>
                            {getSimpleAlertTitle(
                              item
                            )}
                          </strong>

                          <span>
                            {getSimpleAlertMessage(
                              item
                            )}{" "}
                            •{" "}
                            {formatDate(
                              getRecordDate(
                                item
                              )
                            )}
                          </span>
                        </div>

                        <SafetyBadge className="modern-tank-status" severity={severity} emptyLabel="Information" />
                      </div>
                    );
                  }
                )}
            </div>
          )}
        </section>
      )}

      {/* ===============================================
          ACTIVITY TAB
      ================================================ */}

      {activeTankTab === "logs" && <TankActivityHistory key={tankId} tankId={tankId} />}
    </div>
  );
}

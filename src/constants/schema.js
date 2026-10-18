/**
 * CANONICAL SUPABASE SCHEMA
 * ---------------------------------------------------------------------------
 * This is the single source of truth for table and column names used by the
 * web dashboard. It replaces the old pattern (scattered across pages) of
 * guessing table names at runtime, e.g.:
 *
 *   const tankTables = ["tanks", "user_tanks", "tank_profiles"];
 *   for (const tableName of tankTables) { ... try each until one works ... }
 *
 * Every name below was confirmed against the CrayThrive MOBILE app
 * (`craythrive_supa`), which is the working, ground-truth Supabase client.
 * The web dashboard and mobile app read/write the same database, so the web
 * dashboard must use the exact same names — guessing is no longer necessary.
 *
 * If a real column/table turns out to differ from what's below, fix it here
 * once and every page/service that imports from this file updates together.
 */

// ---------------------------------------------------------------------------
// TABLES (all confirmed via mobile app queries)
// ---------------------------------------------------------------------------
export const TABLES = {
  PROFILES: "profiles",
  TANKS: "tanks",
  IOT_DEVICES: "iot_devices",
  SENSOR_READINGS: "sensor_readings",
  AMMONIA_READINGS: "ammonia_readings",
  ALERTS: "alerts",
  THRESHOLD_SETTINGS: "threshold_settings",
  CONTROL_LOGS: "control_logs", // feeding / pump / drain / refill history (read side)
  MARKETPLACE_LISTINGS: "marketplace_listings",
  MARKETPLACE_ORDERS: "marketplace_orders",
  MARKETPLACE_CHAT_THREADS: "marketplace_chat_threads",
  MARKETPLACE_CHAT_MESSAGES: "marketplace_chat_messages",
  SELLER_PROFILES: "seller_profiles",
  NOTIFICATION_PREFERENCES: "notification_preferences",
  PUSH_TOKENS: "push_tokens",

  // NOT CONFIRMED — the web dashboard's TankDetailsPage.jsx reads/writes a
  // "device_commands" table (FEED_ONCE / REFILL_FOR / DRAIN_FOR / STOP_ALL,
  // with pending/sent/acknowledged/completed/failed states) that does not
  // appear anywhere in the mobile app. It may be a legitimate write-side
  // command queue that control_logs is populated from once a device
  // executes it, or it may be speculative code that was never backed by a
  // real table. VERIFY THIS DIRECTLY IN THE SUPABASE TABLE EDITOR before we
  // touch feeding/actuator UI. Left here, unused for now, as a flag.
  DEVICE_COMMANDS_UNVERIFIED: "device_commands",
};

// ---------------------------------------------------------------------------
// COLUMNS — only the ones that are ambiguous, reused across tables, or that
// pages need to agree on. Not every column needs to be listed here.
// ---------------------------------------------------------------------------
export const COLUMNS = {
  TANK_ID: "tank_id",
  USER_ID: "user_id",
  DEVICE_UID: "device_uid",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
};

// Monitoring columns verified against the linked remote schema for Fix #7.
// See docs/SENSOR_READING_SYNC_AUDIT.md; the full Mobile source is not in this workspace.
export const SENSOR_READING_FIELDS = {
  TEMPERATURE: "temperature_c",
  TEMPERATURE_STATUS: "temperature_status",
  PH: "ph_value", // calibrated pH; legacy `ph` is a fallback, never ph_voltage/raw_ph_value
  PH_STATUS: "ph_status",
  TURBIDITY: "turbidity_voltage", // higher voltage = clearer water
  TURBIDITY_STATUS: "turbidity_status",
  WATER_DEPTH: "water_depth_cm",
  WATER_STATUS: "water_status",
};

// Remote scan schema has ammonia_mg_l and legacy ammonia_level. The older
// reader aliases remain compatible without proposing/writing new columns.
// Scans are separate dated events, never live sensor_readings.ammonia.
export const AMMONIA_READING_FIELDS = {
  VALUE: "ammonia_mg_l", // remote scan schema; preserve mg/L, do not use sensor_readings.ammonia
  VALUE_FALLBACKS: ["ammonia_level", "ammonia", "ammonia_ppm", "ammonia_value"],
  STATUS: "ammonia_status",
  STATUS_FALLBACKS: ["status", "result", "level"],
  SOURCE_LABEL: "Smartphone Scan", // LIANKAI test strip + phone camera, not ESP32-CAM
};

// threshold_settings — confirmed via mobile src/utils/thresholdSettings.js
// AND web src/pages/admin/SettingsPage.jsx (they already agree). Stored both
// as a jsonb blob (`thresholds`) and as flattened numeric columns.
export const THRESHOLD_FIELDS = {
  JSONB_COLUMN: "thresholds",
  TEMPERATURE_MIN: "temperature_min",
  TEMPERATURE_MAX: "temperature_max",
  PH_MIN: "ph_min",
  PH_MAX: "ph_max",
  TURBIDITY_MAX: "turbidity_max",
  WATER_LEVEL_MIN: "water_level_min",
  AMMONIA_MAX: "ammonia_max",
};

// control_logs — confirmed via mobile src/screens/main/ReportsScreen.js
export const CONTROL_LOG_FIELDS = {
  ACTION_TYPE: "action_type", // e.g. contains "pump" or is a feeding action
  ACTION_STATUS: "action_status", // Recorded outcome; pending/rechecking do not establish confirmed completion.
  NOTES: "notes",
};

// profile lookup strategy used consistently across the app: try by id first
// (the normal case), fall back to case-insensitive email match. Centralized
// here so every page does this exactly the same way.
export const PROFILE_LOOKUP = {
  PRIMARY_COLUMN: "id",
  FALLBACK_COLUMN: "email",
};

// Roles allowed to use the web dashboard. Confirmed in
// src/routes/ProtectedAdminRoute.jsx — the web dashboard is a per-user
// account dashboard (role "user"), not a separate staff/superadmin panel.
// Do not change this without confirming the intended access model first.
export const ALLOWED_DASHBOARD_ROLES = ["user"];

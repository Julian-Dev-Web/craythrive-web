# Water sensor health and alert lifecycle fix

## Scope and delivery state

Implemented in the local sensor-hub and actuator sketches, Web monitoring, and a
reviewable SQL function patch. Nothing has been flashed, deployed, or pushed.
No database tables, columns, indexes, or triggers were changed. Water calibration,
physical severity thresholds, pump timing, and servo actions are unchanged.

The native mobile app source was not available in the supplied Web workspace or
the searched local source folders. Its display and any independently generated
local notifications still require review when that source folder is supplied.
The shared server alert lifecycle patch covers database-generated alerts consumed
by both clients after manual application; it is not live yet.

## Cause

The sensor sketch's failed filtered-measurement branch immediately cleared both
cached water numbers, set `SENSOR_ERROR`, and cleared `hasWaterReading`. Upload
normalization also converted missing water into `SENSOR_ERROR`, including startup.
Consequently one failed cycle produced null water values and the error warning
flag despite frequent recovery on the next measurement.

The inspected production alert trigger already suppressed consecutive identical
water statuses using the preceding reading. It did not track an active error
episode or resolve it on recovery, so alternating error/recovery readings could
create repeated alerts without closing older ones.

## Firmware files and sections

Local files edited:

- `C:\Users\AMD\Downloads\ESP32_sensorhub_patched1.1\ESP32_sensorhub_patched1.1.ino`
- `C:\Users\AMD\Downloads\ESP32_sensorhub_patched1.1\WaterReadingHealth.h` (new)
- `C:\Users\AMD\Downloads\CrayThrive_Actuator_v1_11_0\CrayThrive_Actuator_v1_11_0.ino`

Each original sketch is retained beside it as `<sketch>.ino.pre-water-health.bak`.
Full sketches contain existing local configuration and are not copied into Git.
Versioned, reviewable changes are in `firmware/patches/`; the required sensor
header is versioned as `firmware/WaterReadingHealth.h` and must accompany the
sensor sketch when building it elsewhere.

Sensor-hub sections changed:

- Includes and cached-water state: added explicit last-good depth, raw distance,
  status, advice, and the measurement-health policy.
- `refreshCachedWaterHealth()`: selects fresh, carried, waiting, or unavailable
  cache presentation without recalibrating the measurement.
- Water measurement branch in `loop()`: records successes and consecutive failed
  filtered cycles rather than discarding the cache after one failure.
- `buildSensorHealthRawPayload()`: emits the correct health, flags, source,
  freshness, age, last-good status, and failure count.
- Upload status/advice normalization and loop upload preparation: preserve
  startup `NO_READING` and transient `SENSOR_STALE`; error numeric fields serialize
  as null using the existing numeric serializer.
- Serial diagnostic output: distinguishes initial waiting from confirmed failure.

`getStableCalibratedWaterLevelCM()` and `getWaterStatusByLevel()` remain unchanged.

## State transitions

Confirmation count is **three consecutive failed filtered measurement cycles**.
The existing normal measurement interval remains five seconds. The last-good
cache also expires after three intervals (15 seconds); this freshness timeout is
independent of physical water-depth severity thresholds. Failure counts saturate
at three and elapsed-time arithmetic supports `millis()` rollover.

| Event | Numeric upload | Status | Health / flag |
| --- | --- | --- | --- |
| Valid measurement | Measured depth and raw distance | Existing depth severity | `OK`, no water error/stale flag |
| First/second failure with recent last-good value | Carried last-good values | `SENSOR_STALE` | `WARNING`, `WATER_LEVEL_SENSOR_STALE` |
| First/second startup failure | Null | `NO_READING` | `WARNING`, no water error flag |
| Third failure, or expired last-good cache | Null | `SENSOR_ERROR` | `ERROR`, `WATER_LEVEL_SENSOR_ERROR` |
| Next valid measurement after stale/error | New measured values | Existing depth severity | `OK`, failure count reset, flags cleared |

Carried values use `water_value_source="last_good"`,
`water_measurement_fresh=false`, and `water_last_good_age_ms`. Fresh readings use
`"fresh"` and `true`; unavailable readings use `"unavailable"` and `false`.
No fabricated zero depth is introduced.

## Actuator guards

`fetchLatestSensorSnapshot()` and `analyzeStableWaterReadings()` now read depth
only through `getWaterDepthOnly()`: `water_depth_cm`, then `water_level`.
Neither raw ultrasonic distance field is a depth fallback.

The water-specific `isBadWaterStatusText()` rejects `SENSOR_STALE`. Provenance
also invalidates carried values even if a row contains a fresh-looking water
status. Existing snapshot/stability checks consequently block stale data from
starting refill, drain, or scheduled feeding. Generic checks for other sensors
and pump/servo implementations are unchanged.

## Web display and history

Water measurement health is checked before physical severity:

- Fresh: existing `Normal` / `Warning` / `Critical` evaluation.
- Stale: `Latest available: 4.0 cm`, a warning badge, and an explanation that a
  fresh reading is awaited. A carried value cannot make water Normal or Critical.
- Confirmed failure: `Sensor Error`; no stale numeric value is presented as a
  current measurement. Overall tank evaluation includes a sensor-health warning.
- Startup: `No Data` / `Waiting`, with no fabricated number.

This applies to Tanks, Tank Details, Sensor Readings, Dashboard, and Reports.
Web water-control stability checks also reject stale/provenance-marked readings.
CSV exports include health, source, freshness, and last-good age. Printed values
identify carried measurements; AI monitoring context includes provenance too.
Raw stored values and statuses remain untouched.

## SQL function update required, not applied

Manual-review artifact:
`supabase/patches/water_sensor_error_lifecycle.sql`.

This replaces only the existing `create_alert_from_sensor_reading()` function
body. It reuses existing alert `metadata`, `status`, and `resolved_at` fields:

1. Lock the owner/tank/water-sensor-error key for the transaction.
2. First confirmed `SENSOR_ERROR`: create one active alert through the existing
   notification-preference helper.
3. Repeated error: retain the existing alert and its read state; no new alert
   insert means no additional insert-trigger push enqueue.
4. Stale/waiting/carried data: do not resolve the error or generate physical
   water-severity alerts from carried values.
5. Fresh valid recovery: mark matching active errors resolved.
6. Later confirmed failure: create a new active error episode.

Legacy active water error alerts without metadata are recognized by their
existing titles. Non-water alert branches match the inspected production
function exactly. No structural schema migration is needed. The live database
still uses its old behavior until this function patch is reviewed and applied.

## Validation

- Both modified sketches compile with installed ESP32 core 3.3.11, target
  `esp32:esp32:esp32`. Sensor-hub flash: 1,120,088 bytes (85%); actuator flash:
  1,173,243 bytes (89%). Both use 15% static RAM.
- Production C++ health header passes compile-time scenarios A-G, startup,
  cache expiration, saturation, and timer rollover in
  `tests/firmware/water-health-static.cpp`.
- `npm run test`: 106 passed, one existing retired-feature skip.
- Offline PostgreSQL alert tests: six passed, including repeated failures,
  preserved read state, recovery, legacy alerts, preferences, and tank isolation.
  These run against PGlite, not the live database.
- Impacted browser suite: 60 passed. Final water-health suite: six passed,
  including 390 px layouts, recovery, startup, CSV, and print.
- `npm run build`: passed; distribution security scan clean.
- New JavaScript/test files pass targeted ESLint. Repository-wide ESLint still
  reports 24 existing errors and five existing warnings. Diagnostic signatures
  for all 11 edited tracked JavaScript/JSX files match the HEAD baseline.
- Existing build warning: generated JavaScript chunk exceeds 500 kB.
- Working-tree security scan flags two unchanged mock bearer tokens in
  `tests/developer-service.test.mjs` (QA fixtures, not production credentials).

No physical HC-SR04, relay, servo, live push delivery, or native mobile runtime
testing was performed. Compilation and simulations do not replace hardware
verification. No firmware was flashed and no SQL was applied remotely.

## Changed Web and test files

- `src/components/SafetyBadge.jsx`
- `src/pages/admin/DashboardOverview.jsx`
- `src/pages/admin/ReportsPage.jsx`
- `src/pages/admin/SensorReadingsPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/TanksPage.jsx`
- `src/utils/monitoringAIContext.js`
- `src/utils/monitoringRecords.js`
- `src/utils/sensorReadingUtils.js`
- `src/utils/statusHelpers.js`
- `src/utils/thresholdEvaluation.js`
- `src/utils/waterReadingHealth.js` (new)
- `tests/monitoring.test.mjs`
- `tests/browser/water-health.spec.mjs` (new)
- `tests/firmware/water-health-static.cpp` (new)
- `tests/fixtures/sensor-alert-preferences.sql` (new; offline test helper)
- `tests/water-health-alerts.test.mjs` (new)

Additional versioned artifacts: this report, the health header, both firmware
patches, and the manual SQL function patch listed above.

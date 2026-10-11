# Dynamic sensor safe ranges — Fix #2

Implemented in the accessible React + Vite Web workspace. The Expo application
is not present, so mobile card integration and a real cross-application comparison
remain pending. No automation, severity rules or hardware firmware were changed.

## Findings and database inspection

The sensor cards already evaluated readings against effective settings but did
not consistently render the configuration beside each reading. No shared range
presentation existed. A second issue affected empty selected-tank summaries:
without a reading to identify the tank, the current snapshot could resolve the
account fallback instead of that tank's override. The snapshot now uses the
selected tank when resolving its configuration even before the first reading.

A read-only Supabase CLI query inspected `information_schema.columns` in project
`abtzkqfrwzcocyrwcrfc`. Both `threshold_settings` and `tank_threshold_settings`
have the seven existing threshold fields and a `thresholds` JSONB field. The
legacy table has no `tank_id`; the override table does. No SQL migration, database
write, backfill, RLS change or function deployment was necessary for this task.

## Threshold inheritance and display

The existing authenticated reader and shared resolver remain authoritative:

1. Selected tank's `tank_threshold_settings` override.
2. Owner's legacy `threshold_settings` row when the tank has no override.
3. Existing application defaults for unavailable settings.

Cards consume `safety.activeThresholds` from the same evaluation that determines
their status. The new formatter only presents those values; it does not evaluate
measurements, create severity bands, or modify readings or database metadata.
Configured numbers retain their saved precision.

| Parameter | Displayed configuration | Actual contract |
| --- | --- | --- |
| Temperature | Safe Range: min–max °C | `temperatureMin`, `temperatureMax` |
| pH | Safe Range: min–max | `phMin`, `phMax` |
| Water depth | Safe Limit: ≥ min cm | `waterLevelMin` |
| Water clarity | Safe Limit: ≥ min V | Historical key `turbidityMax` means minimum clear-water voltage |
| Ammonia | Safe Limit: ≤ max mg/L | `ammoniaMax`; existing test-strip/manual result unit |

The actual model has **no water maximum**. Example water ranges such as 2–4 cm
and 3–5 cm cannot truthfully be displayed from this configuration. Distinct tank
minimums of 2 cm and 3 cm are tested instead. No upper or critical boundary was
invented. Ammonia retains **mg/L** rather than relabeling existing results as ppm.

Clarity cards now display their existing numeric voltage alongside the configured
voltage limit and evaluated status. Missing readings display “No reading”; missing
ammonia scans display “No recent ammonia reading.” Existing neutral badges remain
No Data / No Scan. Actual zero readings remain valid. Latest available ammonia
scans retain their own scan date and are explicitly identified as scans, including
older results; no new recency expiration policy was invented.

The existing refresh hook reloads settings after successful local saves, cross-tab
storage notifications, window focus, visibility return and page refresh. Canonical
updates from another client are therefore reflected after returning to Web.
Legacy-only mobile writes still follow the existing inheritance rules and cannot
override an explicitly configured tank row. Integration of the unavailable Expo
source with the shared canonical threshold contract remains a separate pending
dependency; this task does not claim the currently installed mobile build changed.

## Files changed for this task

- `src/components/SensorSafeRange.jsx`
- `src/styles/sensorSafeRange.css`
- `src/utils/sensorSafeRanges.js`
- `src/utils/monitoringRecords.js`
- `src/pages/admin/DashboardOverview.jsx`
- `src/pages/admin/TanksPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/SensorReadingsPage.jsx`
- `src/pages/admin/ReportsPage.jsx`
- `tests/sensor-safe-ranges.test.mjs`
- `tests/monitoring.test.mjs`
- `tests/browser/sensor-safe-ranges.spec.mjs`
- `docs/DYNAMIC_SENSOR_SAFE_RANGES.md`

Earlier timezone, pump wording and other working-tree changes were preserved.
This list describes Fix #2 only, not every pending workspace change.

## Validation

- `node --test tests/sensor-safe-ranges.test.mjs tests/monitoring.test.mjs tests/threshold-compatibility.test.mjs`: **37 passed**.
- Browser range, threshold Apply and ammonia regressions: **20 passed** in the first
  run. These exercise all five parameters on all five monitoring pages; per-tank
  limits; empty selected tanks; Apply persistence; cross-tab refresh; external
  canonical and account fallback updates; missing versus zero scan results; older
  scan provenance; phone layout; light and dark themes. Supabase data is mocked.
- Additional narrow-phone empty-reading test: **1 passed** at 360 px; **21 browser
  tests passed in total**. The screenshot was visually checked for readable
  limits, neutral badges and wrapping of the missing ammonia message.
- `npm run build`: passed, with a pre-existing bundle size warning. Distribution
  security scan found no findings.
- Full ESLint: **22 errors / 5 warnings**, unchanged from the preceding task's
  baseline by file, rule and severity. New files have no ESLint diagnostics.
- `git diff --check`: passed. Git emits existing LF/CRLF conversion notices.

No production sensor uploads, actuator commands, threshold writes, mobile build,
Git push or application deployment were performed for this task.

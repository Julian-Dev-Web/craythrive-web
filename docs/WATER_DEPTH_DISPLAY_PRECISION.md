# Water depth display precision fix

2026-10-13. Web implementation only; no deployment or production data writes.

## Root cause

`src/utils/sensorReadingUtils.js` correctly selects the canonical
`sensor_readings.water_depth_cm` and retains it as the numeric `waterValue`.
However, the original `waterLabel` called `formatNumber(waterValue, 1)` for both
fresh and last-good values. That helper uses `Number.toFixed(decimals)`.
Reproduction: `(3.05).toFixed(1)` returns `"3.0"`; `.toFixed(2)` returns `"3.05"`.
This was display rounding, not a Supabase write, calibration calculation,
unit conversion, truncation or wrong-field selection.

Dashboard, Tanks, Tank Details, Readings and Reports all consume that normalized
label. Human-readable history/current CSV rows and printable/PDF reports also
inherit it. Recommendations independently selected one decimal for water.
The evaluator and recommendation reason additionally rounded both the water
value and active minimum to one decimal before comparison. That could falsely
classify values immediately below a minimum as Normal.

## Implementation

`supabase/functions/_shared/waterDepthDisplay.js` provides one
`formatWaterDepth()` for numeric water-depth presentation: `3.05` → `3.05 cm`,
`3` → `3.00 cm`, `0` → `0.00 cm`. Null, blank, boolean, nonfinite and negative
inputs retain a neutral/missing fallback. No numeric reading is overwritten.

The existing source priority is unchanged:
`water_depth_cm` → valid legacy `water_level` → normalized `waterValue`.
Distance, inches and planned stocking depth never supply a sensor depth.
Error/Waiting labels and last-good/stale provenance remain intact.

The shared normalizer now calls that formatter, so the five monitoring pages,
their histories and CSV/print exports agree without page-specific formatting.
TanksPage and SensorReadingsPage need no direct edits because they already use
`waterLabel`. Dashboard's existing average display also calls the formatter;
its averaging calculation is unchanged. Recommendations and saved activity
measurements reuse the same formatter.

The Web evaluator compares original numeric depth directly with the original
configured minimum. Recommendation reasons do the same. Existing firmware
warning/critical tiers and minimum-only fallback behavior remain intact; no
critical boundary was added. Thus `3.05 < 3.051` remains Warning, while
`3.05 >= 3.05` is Normal under the existing minimum rule. If two-decimal labels
hide a smaller difference, the explanation explicitly discloses the unrounded
comparison. Configured bounds can retain additional meaningful precision.

Shared alert presentation composes the existing pump wording with water-depth
presentation, covering Alerts, the notification bell, Dashboard titles, Tank
Details, Reports and report exports. Historical events use only their own
recorded depth/sensor snapshot; canonical saved depth wins over a generic
snapshot value. A pH snapshot value cannot masquerade as depth. All saved
metadata, statuses and event dates remain unchanged. Pump wording and command
outcome verification remain intact.

An alert containing only already-rounded free text has no recoverable hundredth
digit. For example, `3.0 cm` can only be formatted as `3.00 cm` without a precise
saved event value. The UI must not substitute a different/latest sensor row or
claim the historical value was `3.05`. The earlier activity audit documented
missing sensor snapshots in existing events; no historical backfill or invented
event linkage is introduced here.

## Exact files changed

Application/shared code:

- `src/utils/sensorReadingUtils.js`
- `src/utils/thresholdEvaluation.js`
- `src/components/NotificationBell.jsx`
- `src/pages/admin/AlertsPage.jsx`
- `src/pages/admin/DashboardOverview.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/ReportsPage.jsx`
- `supabase/functions/_shared/waterDepthDisplay.js` (new)
- `supabase/functions/_shared/monitoringAlertPresentation.js` (new)
- `supabase/functions/_shared/sensorRecommendations.js`
- `supabase/functions/_shared/tankActivity.js`

Tests and documentation:

- `tests/water-depth-display.test.mjs` (new)
- `tests/monitoring.test.mjs`
- `tests/sensor-recommendations.test.mjs`
- `tests/browser/water-depth-display.spec.mjs` (new)
- `tests/browser/water-severity.spec.mjs`
- `tests/browser/water-health.spec.mjs`
- `tests/browser/sensor-reading-sync.spec.mjs`
- `tests/browser/sensor-recommendations.spec.mjs`
- `tests/browser/tank-activity.spec.mjs`
- `tests/browser/mobile-reports.spec.mjs`
- `tests/browser/qa.spec.mjs`
- `docs/SENSOR_READING_SYNC_AUDIT.md`
- `docs/WATER_LEVEL_SEVERITY_FIX.md`
- `docs/WATER_DEPTH_DISPLAY_PRECISION.md` (this report)

## Verification

- Production build and distribution credential scan pass. Existing main-bundle
  >500kB warning remains (approximately 653kB JavaScript).
- Full Node suite on the current workspace: 205 passed, one retired endpoint check skipped. The final
  additional alert-bound precision cases also pass the four new regression tests.
- 70 distinct production-browser fixture checks passed across the final runs:
  68 monitoring/precision/severity/health/history/recommendation/time/control
  checks, plus phone CSV/print and reading-filter checks. An initial chronology
  assertion depended on the wall-clock fixture date; the activity fixture now
  sets its scan dates explicitly, and all ten activity checks passed again.
- The canonical `3.05` case passes on all five monitoring pages, event alerts,
  notification bell, Activity, history, CSV and printable report. Tests verify
  unchanged raw rows/metadata and no hardware/database writes.
- Full ESLint remains 22 pre-existing errors and 3 warnings. Changed helpers,
  utilities, notification component and tests pass targeted ESLint.
- `git diff --check` passes; Windows LF/CRLF notices are harmless.

The repeated precision request was rechecked against the saved implementation:
all four dedicated browser tests passed again, covering the five monitoring
pages, event alerts, notification bell, activity, CSV, printable/PDF reports,
and unrounded threshold comparison. No further application edits were needed;
the existing AI persistence changes were preserved.

No Supabase schema/data changes, sensor depth calculation, ESP32 firmware,
calibration, pump/feeder command code or automation interlock was modified.
TankDetailsPage edits only replace its alert presentation helper; its raw-depth
stability and control logic are unchanged. No commit, push or deployment was
performed for this task. The verified database value was supplied by the user;
this task did not access a production account or independently retest Mobile.

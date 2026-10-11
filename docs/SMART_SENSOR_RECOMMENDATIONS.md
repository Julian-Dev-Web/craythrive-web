# Fix #4 — smart sensor recommendations

Implemented for the accessible React Web application on 2026-10-11. No SQL,
remote configuration, firmware, pump, feeder, alert trigger or classification
changes are included. No deployment or Git push was performed.

## Findings and scope

- Web already has the canonical threshold reader, monitoring snapshots,
  `evaluateReadingSafety()`, safety badges, Philippine time formatter and
  server clock. These are reused rather than creating another classifier.
- Effective settings resolve as selected tank override in
  `tank_threshold_settings` → account row in `threshold_settings` → existing
  application defaults. The legacy table remains unchanged.
- Saved settings contain safe limits, but no separate numeric critical bands.
  Fix #3 remains an audit/proposal awaiting approval; see
  [STATUS_CLASSIFICATION_FIX3_PROPOSAL.md](STATUS_CLASSIFICATION_FIX3_PROPOSAL.md).
  Existing temperature, pH, clarity and ammonia rules can still classify a
  slightly out-of-range value as Critical. Recommendations preserve that
  evaluated severity; they do not invent or implement replacement boundaries.
- Water has a minimum depth, not a configured maximum. Clarity uses minimum
  voltage (`turbidityMax` is the historical key); ammonia uses the existing
  mg/L unit. Safe-range presentation from Fix #2 is preserved.
- The full Expo application is unavailable in this workspace. Prepared mobile
  threshold adapters are not an integrated mobile app. Mobile UI integration
  and cross-platform acceptance testing remain pending.

## Behavior

Dashboard and Tank Details have a compact floating Recommendations button.
An accessible native modal presents all five parameters for the selected tank,
with its name, latest value/unit, effective safe range/limit, evaluated status,
reason, inspection action and observation time explicitly labeled Asia/Manila.
Critical precedes Warning, unavailable evidence, then Normal. A quiet-state
message distinguishes no verified issues from missing measurements.

Opening, refreshing or switching tanks verifies the authenticated owner, reads
the tank, effective settings and latest sensor/manual ammonia rows directly
from Supabase. Both measurement queries filter by owner and selected tank.
Read failures clear the recommendation snapshot and offer retry. Old requests
cannot overwrite a newly selected tank. The panel refreshes every 30 seconds
while open, on threshold-change notifications, and on window focus; server time
also updates measurement availability without a new sensor upload.

Evidence availability is separate from classification:

- Live readings older than the existing Web control guard's five-minute age
  limit are neutral, as are explicitly carried/stale, missing, invalid or
  errored measurements. This reuses an existing age policy only for advice;
  hardware guards and global card classification remain unchanged.
- Unknown server time, invalid timestamps and future timestamps cannot establish
  current condition.
- No manual ammonia scan-validity policy exists in the available settings.
  Its actual latest value and scan date remain visible, but advice is neutral
  and requests a new test rather than claiming that scan proves current
  condition. A zero result remains a real measurement. The portable generator
  can accept an explicitly configured validity period in future; Web does not
  silently assign one.
- Water explanations use the existing evaluator's 0.1 cm comparison precision.
  Firmware severity remains attributed to the device when a corresponding
  numeric critical boundary is not configured.

The shared generator takes existing evaluated parameter results and effective
thresholds. It is suitable for later Expo reuse, but does not replace the
classification implementation or establish mobile parity by itself.

## Optional AI explanation

Only an explicit Explain with AI Guide click calls the existing
`craythrive-ai-guide` Edge Function. The request supplies this tank's verified
snapshot, effective limits and deterministic recommendations, identifies
missing/stale evidence, and requests inspection-only explanation.

The UI renders bounded plain text; it ignores returned actions, threshold
suggestions and proposed classifications. AI text cannot change a badge,
write settings or execute equipment. Network/provider errors leave the
deterministic recommendations usable. The existing authenticated function
contract was inspected and tested with mocked responses; a live provider call
has not been verified in an authenticated production session.

## Files for this task

- `src/components/SensorRecommendations.jsx`
- `src/styles/sensorRecommendations.css`
- `src/services/sensorRecommendationService.js`
- `src/pages/admin/DashboardOverview.jsx` — launcher integration only for Fix #4
- `src/pages/admin/TankDetailsPage.jsx` — launcher integration only for Fix #4
- `src/utils/sensorSafeRanges.js` — reexports the shared range formatter
- `supabase/functions/_shared/sensorSafeRanges.js`
- `supabase/functions/_shared/sensorRecommendations.js`
- `tests/sensor-recommendations.test.mjs`
- `tests/browser/sensor-recommendations.spec.mjs`
- `tests/browser/fixtures.mjs` — mocked AI and threshold-read error scenarios
- `docs/SMART_SENSOR_RECOMMENDATIONS.md`

Other working-tree changes belong to earlier requests and are preserved.

## Validation

- `npm run build`: passed; distribution security scan has no findings. The
  existing bundle-size warning (>500 kB) remains.
- Targeted recommendation, safe-range, monitoring and threshold compatibility
  unit/integration suite: 47 passed. A serialized rerun with
  `node --test --test-concurrency=1` also passed all 47 without the earlier
  concurrent Vite harness's nonfatal HMR port-in-use warning.
- Browser suite: 31 passed, including 10 recommendation tests and safe-range,
  threshold Apply and ammonia regressions. Coverage includes same Web
  Dashboard/Details results, tank isolation,
  threshold Apply propagation, stale/missing/carried evidence, error recovery,
  optional AI text-only behavior and failures, keyboard focus/Escape,
  360/768/1440 px layouts, empty tanks and emergency-control accessibility.
  These tests use an isolated production fixture with mocked Supabase data;
  they do not mutate remote readings or run hardware commands.
- Full ESLint: 22 errors and 5 warnings, unchanged file/rule/severity baseline
  from before Fix #4; no new lint findings introduced by this task.
- Rechecked the saved implementation after the repeated request: production
  build/security scan, all 47 targeted tests and targeted ESLint passed. The
  existing browser results above are from the preceding implementation run;
  no application code changed during this recheck.

Pending: approved Fix #3 implementation and validated critical boundaries;
manual ammonia recency policy; actual Expo integration; authenticated live
AI-provider and real-device acceptance testing.

# Fix #3 — classification audit and proposal

Audit date: 2026-10-11. **Awaiting user approval. No Fix #3 application, SQL,
firmware or automation implementation has been made.** Fix #2 and the other
existing working-tree changes are preserved.

## Verified current database and Web contract

Read-only queries inspected project `abtzkqfrwzcocyrwcrfc`: current table columns,
threshold JSON keys and distinct configurations, RLS policies, trigger definitions,
the actual threshold RPCs, sensor/ammonia alert functions, and five recent sensor
rows. No account identities or authentication credentials were included in the
audit output. No remote records were written.

- `threshold_settings`: account row, `UNIQUE(user_id)`, no `tank_id` column.
- `tank_threshold_settings`: override, `UNIQUE(user_id,tank_id)`, owner/owned-tank
  RLS. The existing legacy owner SELECT/INSERT/UPDATE/DELETE policies remain.
- Both contain JSON and the seven numeric fields below. **Neither columns nor
  saved JSON contain separate critical boundaries.**
- `water_thresholds` exists but has the same basic limits and no rows; it does
  not supply the missing critical bands.
- RPC: `apply_tank_thresholds(p_tank_id uuid, p_patch jsonb, p_scope text DEFAULT
  'single_tank', p_source text DEFAULT 'manual') RETURNS jsonb`. Its current
  accepted field list contains only the seven basic limits (camelCase and SQL
  aliases). Adding client inputs alone would fail RPC validation.
- `get_tank_threshold_settings()` returns the authenticated owner's legacy and
  override rows. The shared reader/resolver implements tank → legacy → defaults.
- Actual saved account configuration: temperature 20–30 °C; pH 6.5–8.5;
  clarity minimum 2.5 V; water minimum 4.5 cm; ammonia maximum 0.25 mg/L.
  Distinct tank configurations include those values and another configuration
  with clarity minimum **2.74 V** and water minimum **7.2 cm**.

| Parameter | Current Web rule in `src/utils/thresholdEvaluation.js` | Gap |
| --- | --- | --- |
| Temperature | Inside min/max Normal; outside Critical except matching COLD_WARNING/HOT_WARNING | No numeric critical boundaries |
| pH | Inside min/max Normal; outside Critical except LOW_ACIDIC/HIGH_ALKALINE_WARNING | No numeric critical boundaries |
| Clarity | Voltage ≥ `turbidityMax` Normal; below Critical except SLIGHTLY_CLOUDY/DIRTY | Historical key means minimum voltage; no critical-low voltage |
| Water depth | Minimum check gives Warning; recognized firmware codes can supply Normal/Warning/Critical | No safe maximum or numeric critical bounds; mixed authorities |
| Ammonia | Value > `ammoniaMax` Critical; otherwise Normal; no scan neutral | No separate critical-high boundary |

Fix #2's range labels consume `safety.activeThresholds`, and must continue doing
so. Depth priority remains `water_depth_cm` → `water_level` → normalized fallback;
distance is never depth. Existing ammonia display is mg/L and must not silently
be relabeled ppm.

`src/utils/statusHelpers.js` also contains label-to-severity guesses that turn
“Below Active Min”, “Above Active Max” and “Needs Attention” into Critical.
`TankDetailsPage.jsx` uses this helper for non-card status paths. The normal card
badge already uses severity directly, but those other paths need inspection and
replacement specifically for monitoring records, without changing command or
actuator health statuses.

## Freshness and overall status

The evaluator currently receives values/statuses but no observation timestamp or
trusted current time. Consequently a disconnected tank's last good values can
remain Normal indefinitely. `loadCurrentTankRows()` intentionally retrieves the
latest available record without an age cutoff. Manual ammonia scans likewise
have no validity-age policy; Fix #2 correctly labels them as latest available
scans and retains their independent dates.

`getWaterReadingHealth()` understands explicit carried/stale provenance but
assumes legacy provenance is fresh. Explicit stale water currently becomes
Warning rather than the requested neutral/gray Stale state. Missing temperature,
pH, clarity and water are neutral; ammonia has a neutral no-scan state. Overall
aggregation can still be Normal when only the available subset of parameters is
safe, so completeness/freshness must be represented separately.

Read-only execution of the actual Vite modules reproduced these synthetic cases
using existing defaults (not proposed new thresholds):

| Input, without firmware warning metadata | Current result |
| --- | --- |
| Temperature 19.9 °C | Critical |
| pH 6.4 | Critical |
| Clarity 2.49 V | Critical |
| Water 4.4 cm | Warning |
| Ammonia 0.26 mg/L | Critical |
| Water 5 cm with SENSOR_STALE | Warning |

A normalized safe numeric reading dated 2025-01-01 still returned Normal for the
four live parameters. The latest remote sensor row inspected was dated
2026-10-10 05:19:35 UTC, while the database clock during this audit was
2026-10-11 14:16 UTC. These are available historical observations, not evidence
of current live water condition.

## Live database alert inconsistencies

`create_alert_from_sensor_reading()` classifies incoming raw firmware statuses,
not effective configured numeric thresholds. It suppresses consecutive identical
statuses using the immediately previous reading, but has no active episode lock,
recovery resolution, carried-water suppression, or configured hysteresis/cooldown.
An A/B/A fluctuation can therefore insert repeated alerts. The inspected live
function directly inserts alerts instead of using the notification-preference
helper. The earlier local water error lifecycle patch is not reflected in this
live function and must not be assumed deployed.

`create_alert_from_ammonia_reading()` uses `ammonia_level >= 1` for Warning and
`>= 5` for Critical, with ppm wording. Web uses the mg/L aliases and 0.25 basic
maximum, while the actuator has yet another fallback below. This is a verified
three-way disagreement. Rewriting all historical alert severities would erase
event context and is not proposed; new alerts should store the effective settings
and evaluated severity at the time of the event.

## Local firmware inspected, read-only

Full sketches are available at the paths referenced by the earlier audit:

- `C:\Users\AMD\Downloads\ESP32_sensorhub_patched1.1\ESP32_sensorhub_patched1.1.ino`
- `C:\Users\AMD\Downloads\CrayThrive_Actuator_v1_11_0\CrayThrive_Actuator_v1_11_0.ino`

Only targeted threshold/classification/guard sections were read. Full sketches
contain local configuration and were not copied into Git. Their current source
does not prove which binary is running on physical devices.

The sensor's `ThresholdConfig` has these **local fallback calibration values**:

| Parameter | Safe fallback | Critical fallback | Boundary behavior |
| --- | --- | --- | --- |
| Temperature | 20–28.5 °C | ≤18, ≥30.5 °C | Critical inclusive |
| Water depth | 3–4.5 cm | ≤1.99, ≥5.5 cm | Critical inclusive |
| pH | 6.5–8.5 | ≤6, ≥9 | Critical inclusive |
| Clarity | ≥2.20 V | <1.50 V | 2.00–<2.20 slightly cloudy; 1.50–<2.00 DIRTY; both Web warnings |
| Ammonia | Not measured by sensor hub | None in this sketch | Separate scan/actuator path |

These values are existing source evidence, **not biological validation or approved
per-tank configuration**. Do not automatically backfill them. In particular the
saved Web water minimum **7.2 cm** cannot be combined with this firmware's safe
maximum **4.5 cm** or critical-high **5.5 cm**. The proper calibration must be
confirmed for that tank.

The sensor queries `/rest/v1/threshold_settings?tank_id=eq.<tank>`, although the
current legacy table has no tank_id. `USE_DB_WATER_THRESHOLDS` and
`USE_DB_TURBIDITY_THRESHOLDS` are false. Thus this source cannot be assumed to use
the Web canonical per-tank configuration. Existing temperature/pH JSON aliases
also differ from portions of the Web contract. The 60-second polling interval
does not repair an invalid endpoint or disabled loader.

The actuator relies on directional codes to refill/drain and stop immediately at
CRITICAL_LOW/CRITICAL_HIGH. Feeding also depends on valid/fresh water, ideal/safe
pH, dirty-water checks, and WARNING/CRITICAL ammonia. **WARNING does not mean safe
to feed.** Temperature is monitored but is not itself a direct feeder block in
the inspected quality helper. Stale water provenance is rejected. Sensor snapshot
freshness is 2 minutes; the Web manual-control guard uses 5 minutes, three stable
water readings, a 0.7 cm spread and a 90-second settle period. Those protections
must not be tied to new card labels or weakened.

Actuator ammonia behavior needs separate explicit review: stored status is used
when present; otherwise value ≤0.25 is SAFE, ≤0.50 WARNING, and >0.50 CRITICAL.
On missing/failed scan lookup the source assumes 0/SAFE. No scan-age expiration
was found in that path. This is existing behavior, left unchanged. It does not
justify displaying missing ammonia as Normal in Web/Mobile.

Changing clarity Critical to inclusive ≤1.50 would differ from the existing
firmware's strict <1.50. Similarly, changing actuator ammonia Critical to ≥0.50
would differ from its >0.50 fallback. These equality decisions require explicit
calibration approval and cannot be silently imported as matching rules.

## Proposed implementation, after approval

1. Keep legacy `threshold_settings`, its row identities and UNIQUE(user_id), the
   canonical base override table, existing safe values, and Fix #2 intact. Do not
   seed any critical values from firmware or reference literature automatically.
2. Add an owner-scoped **`sensor_classification_settings`** table with an optional
   tank_id: one account row and one row per owned tank, enforced with partial
   unique indexes and owner/owned-tank RLS. Add nullable temperature/pH critical
   low/high, water safe maximum and critical low/high, clarity critical-low V,
   ammonia critical-high mg/L, and freshness/alert recovery policy configuration.
   Separate storage prevents an older mobile legacy JSON replacement from erasing
   these new fields. NULL inherits account configuration, then remains explicitly
   unconfigured if no value exists; there are no new biological defaults.
3. Extend the authenticated read/Apply contract, keeping existing RPC signatures
   and old seven-key calls compatible. Validate the complete effective order
   criticalLow < safeMin ≤ safeMax < criticalHigh where bounds exist; validate
   clarity criticalLow < clearMinimum and ammonia criticalHigh > safeMaximum.
   Validate all affected tanks for an account/Apply All change. Preserve ownership,
   no-op behavior, actual-change activity logging, and explicit AI acceptance.
   Existing legacy-only writes can create an invalid combination with new bands;
   read-time validation must show a configuration issue rather than false Normal.
4. Build one portable pure classifier and normalization contract shared by Web,
   the server alert implementation, and the future Expo integration. For a valid
   fresh measurement: within safe bounds = Normal; outside safe bounds = Warning;
   at/beyond a **configured** critical bound in the unsafe direction = Critical.
   If that direction's critical bound is absent, outside-safe = Warning with
   “Critical limit not configured.” Keep device-reported faults/hazards visible
   as separate context, retaining every raw stored status.
5. Separate measurement health and configuration health from physical severity.
   Missing, invalid, stale, future/unknown timestamp, or untrusted clock = neutral
   No Data/Stale/Unavailable, never Normal. Proposed live-card expiry: reuse the
   existing actuator's **2-minute** age policy, without changing that actuator or
   the Web command guards. Manual ammonia validity needs its own explicit scan-age
   setting, not the live-sensor timeout. With no scan-age policy configured, show
   latest available result/date but do not claim it is a current Normal condition.
   Evaluate overall severity among valid current parameters and explicitly show
   partial/unavailable data; an incomplete snapshot must not claim fully Normal.
6. Keep dynamic Safe Range/Safe Limit labels, with an optional configured water
   maximum shown as a real range. Add a compact Critical Limits section to tank
   settings; unset limits clearly say configuration required. Recompute cards
   from unchanged raw readings after effective settings or trusted time change.
7. Generate new sensor/ammonia alerts from this same classification and observation
   provenance. Track one active episode per owner/tank/parameter/direction under
   a transaction lock. Escalate Warning→Critical immediately; suppress repeated
   inserts; rearm after confirmed fresh recovery. Recovery confirmation/cooldown
   must be explicit policy, not invented numerical safety bands. Retain alert
   history/read state and notification preferences; do not have clients also
   insert duplicate automatic alerts. Freshness faults remain identifiable as
   health events rather than physical water/temperature Critical conditions.
8. Do not rename firmware statuses, flash devices, alter refill targets, pump
   aborts, feeder rules, freshness guards or safety interlocks. Firmware threshold
   synchronization/changes require separate review and approval. Present any
   mismatch clearly until a coordinated rollout is validated.

## Mobile and rollout limits

The accessible workspace contains Web and a prepared next-mobile threshold
adapter, not the actual Expo application or its card/notification implementation.
Source was not found here; the mobile adapter is not an integrated mobile build.
Full Web/Mobile agreement requires integrating the real mobile source with the
same effective configuration, classifier, timestamp validity, and alert contract.
UI consistency cannot establish firmware safety parity while the inspected
hardware threshold loader remains incompatible. These are explicit rollout
dependencies, not completed acceptance tests.

## Planned verification after implementation approval

- Inside-safe, each safe edge, just outside, each critical edge, and beyond it for
  every configured direction; test strict-vs-inclusive compatibility explicitly.
- Missing critical configurations, invalid ordering and unit/key normalization.
- Missing/invalid/stale/future observations and clock unavailable; separate ammonia
  scan-age cases, actual zero, and independent observation dates.
- Tank isolation, account fallback, Apply This Tank/All, old RPC call compatibility,
  refresh after Web/external writes, AI recommendation-only and activity logging.
- SQL alert episode locking, escalation, recovery, rapid flapping, notification
  preferences, owner isolation, and no backfill/historical-row mutation.
- Existing water/feeder safety regression tests, proving display labels are not
  used to relax command guards or firmware interlocks. Actual firmware/mobile and
  physical pump/feeder validation remain separately required before such rollout.
- Build, targeted ESLint and browser responsiveness/accessibility checks.

Only this audit/proposal document was added as a tracked Fix #3 deliverable.
Ignored read-only audit query/result scratch files were also created. No SQL was
deployed, no new critical values saved, and no Fix #3 build/firmware/mobile runtime
success is claimed. Approval is required by the user's explicit two-stage workflow.

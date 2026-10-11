# Fix #7: monitoring synchronization

## Scope and evidence

Implemented in the accessible React/Vite Web workspace. The Expo SDK 54 application is not present here; prepared `docs/mobile-next-apk` snippets are not its application source. No Mobile application files were changed. Cross-platform runtime parity remains pending.

Read-only Supabase CLI queries explicitly targeted `abtzkqfrwzcocyrwcrfc`. The previously saved public configuration also names that project's hostname. This workspace has no configured `.env`/production env file to verify the currently deployed Vercel environment, and no Mobile client configuration to compare. The client continues to use `VITE_SUPABASE_URL` and a public key from the existing environment; no credentials or project URL were embedded in code.

The remote audit confirmed:

- `sensor_readings`: UUID `id`, owner `user_id`, tank `tank_id`, `device_uid`, `device_id`/`iot_device_id`, nullable `created_at timestamptz` with database `now()` default, canonical and legacy calibrated numeric columns, ADC diagnostic columns and `raw_payload jsonb`.
- `ammonia_readings`: separate UUID/owner/tank/`created_at` records; actual value columns `ammonia_mg_l` and legacy `ammonia_level`. At inspection all three scans used `ammonia_level`; none used `ammonia_mg_l`. There is no plain `ammonia` column in this remote scan table.
- `tanks` has an explicit owner but does not contain the guessed device UID/ID columns used by some legacy matching helpers. Device pairing is represented separately in `iot_devices`. An observation's explicit saved tank binding is authoritative; a device's current pairing must not reassign its historical uploads.
- Legacy `threshold_settings` remains unique by user, without `tank_id`; per-tank overrides live in `tank_threshold_settings`. The existing authenticated threshold reader supplies both.
- Realtime publication includes `sensor_readings` and `ammonia_readings`, but excludes the threshold tables. Both reading tables already have tank/date indexes and UUID primary keys.
- At the aggregate inspection there were 1,167 sensor rows: none lacked `tank_id`, `device_uid` or `created_at`; two lacked `ph_value`. No differing populated canonical/legacy aliases, ADC-only clarity rows, or same-tank identical timestamp groups were found. These findings do **not** prove a particular Mobile mismatch, and no raw values or account identities were copied into this report.

## Proven Web causes and risks

1. Dashboard, Tanks, Readings and Reports had no reading realtime subscriptions. Their initial snapshot stayed unchanged until a manual reload. Tank Details instead reloaded its entire page data every 8 seconds (1.5 seconds with an active command).
2. `src/utils/sensorReadingUtils.js` accepted `raw_turbidity_value` as a voltage fallback. The inspected sensor firmware uploads this field from `uploadTurbidityRawADC`; it is not volts. The current remote data did not exercise this fallback, but it was a definite interpretation error.
3. `src/constants/schema.js` called legacy `ph` canonical, although the normalizer already preferred `ph_value`. The current remote populated aliases agreed. Mobile's actual interpretation cannot be established without its source.
4. Tanks and Tank Details formatted pH to 1 decimal; Sensor Readings formatted temperature to 2 decimals. Other pages used pH 2 / temperature 1. The new browser tests reproduced these differences for the same reading.
5. Latest queries and in-memory snapshots sorted only by timestamp; ties depended on array/API order. There were no ties in the inspected remote sample, but deterministic selection was missing.
6. `loadCurrentTankRows` silently substituted bounded history when its direct latest query failed. A failed current read could therefore look like a successful current snapshot. Page loaders also lacked consistent overlapping-request protection.
7. Current cards could evaluate an old upload as Normal indefinitely. Recommendations already used the existing five-minute monitoring freshness policy, so cards and recommendations could disagree about whether the evidence was current.
8. Legacy monitoring matching could assign device-only observations to a tank using today's device aliases. Sensor snapshots/history now require an explicit observation tank binding and matching owner when available.

## Final read/display contract

Every current monitoring view selects **one whole latest `sensor_readings` row per owned tank**. It never searches backwards for a missing parameter or combines sensor values from different rows/devices/timestamps.

Queries require `user_id = authenticated user` and `tank_id = selected tank`, ordered by `created_at DESC NULLS LAST, id DESC`, with `LIMIT 1` for a current row. The UUID is only a deterministic tie-breaker, not a claim of upload sequence. The shared in-memory comparator also preserves PostgreSQL sub-millisecond timestamp ordering. Editing metadata never substitutes `updated_at` for observation time.

An explicitly bound upload remains a historical observation of that tank even if its device has since been replaced. A missing/wrong tank reference is not repaired from today's device pairing. Numeric parameters always come from the same row, whose `device_uid` remains available as provenance. No pairing or device-write rules changed.

| Parameter | Canonical field and compatible fallback | Display |
|---|---|---|
| Temperature | `temperature_c` → `temperature` | 1 decimal, °C |
| pH | `ph_value` → `ph` | 2 decimals, no voltage unit |
| Water clarity | `turbidity_voltage` → legacy calibrated `turbidity` | 2 decimals, V; higher means clearer |
| Water depth | `water_depth_cm` → `water_level` → normalized `waterValue` | 1 decimal, cm |
| Ammonia scan | separate table: `ammonia_mg_l` → `ammonia_level`; older reader aliases retained | 2 decimals, existing mg/L unit |

ADC diagnostics (`raw_ph_value`, `raw_turbidity_value`), `ph_voltage`, ultrasonic distance, inches and raw payload diagnostics are never substituted for calibrated values. `sensor_readings.ammonia` is not substituted for a manual scan. Missing/invalid values stay null; real zero remains zero. Invalid pH outside 0–14 and negative clarity/depth/ammonia are unavailable, without changing stored measurements.

Effective thresholds remain **selected tank override → authenticated user's legacy row → existing defaults**. The hook fetches canonical server settings without using local cache as current evidence. Defaults apply when the successful reader has no applicable saved row; a failed settings read is reported as unverified rather than presented as saved settings.

The existing `evaluateReadingSafety` still determines fresh numeric severity. `currentSensorSafety` is an availability gate for current views only: missing, stale, error and unverifiable-time values are neutral; it does not add biological boundaries or alter historical evaluation. The established five-minute policy is shared with Recommendations. Available fresh Warning/Critical parameters still take priority; incomplete live sensor evidence cannot produce a Normal overall badge. Manual ammonia is excluded from the live-sensor freshness requirement, retaining the existing separation between live conditions and dated scans. Current availability is recalculated periodically even if no upload arrives. Raw statuses remain metadata for the existing evaluator, including its previously documented water firmware fallback.

Ammonia keeps its own same-tank scan date and manual source. No scan-validity interval is configured, so current cards display neutral **Manual Scan** for an available dated result, not live Normal/Critical. History still shows its evaluated condition at the recorded scan. No arbitrary ammonia expiration was added. Current CSV snapshots also expose observation freshness.

## Refresh and response handling

`useTankMonitoring` owns one lifecycle-managed channel per mounted monitoring screen, with authenticated-owner filters for both reading sources and `*` events (INSERT/UPDATE/DELETE). Events invalidate the snapshot and trigger a scoped server read; they are not directly trusted as display values. Selected-tank screens ignore known events for other tanks.

Refresh occurs on successful subscription/reconnection, auth refresh, online, visible/focus return, and existing same-tab/cross-tab threshold notifications. A visible-page 60-second read-only snapshot refresh covers missed events and Mobile threshold changes because threshold tables are not published. It does not refetch marketplace/profile/full-page datasets. Invalidations are debounced; requests have abort/version guards and a 15-second deadline. Old scopes, signed-out accounts, obsolete responses and unmounts cannot commit current readings. Failed latest reads never use history/cache as a substitute.

Tank Details retains the existing 1.5/8-second command observation cadence, but now refreshes only control/device/history evidence needed by the existing guards rather than repeatedly reloading tanks, profiles, thresholds, scans and alerts. Full/manual loads and control refreshes also reject obsolete responses. Guard formulas, stable-sample counts, feeding date/wait/settle rules, command writes and hardware behavior were preserved.

Readings history incorporates the latest verified snapshot by record ID, so a same-row UPDATE cannot leave the current summary and its displayed history copy disagreeing. Reports keep their existing independent historical filters and current snapshot semantics. All observation display uses the shared Asia/Manila formatter.

## Files changed for Fix #7

Web application:

- `src/components/MonitoringSyncNotice.jsx` (new)
- `src/components/SafetyBadge.jsx`
- `src/constants/schema.js`
- `src/hooks/useTankMonitoring.js` (new)
- `src/pages/admin/DashboardOverview.jsx`
- `src/pages/admin/TanksPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/SensorReadingsPage.jsx`
- `src/pages/admin/ReportsPage.jsx`
- `src/services/tankSnapshotService.js`
- `src/services/sensorRecommendationService.js`
- `src/utils/sensorReadingUtils.js`
- `src/utils/monitoringRecords.js`
- `src/utils/statusHelpers.js`
- `src/styles/sensorSafeRange.css`

Portable utilities, tests and report:

- `supabase/functions/_shared/sensorReadingContract.js` (new)
- `supabase/functions/_shared/sensorRecommendations.js`
- `tests/monitoring.test.mjs`
- `tests/sensor-reading-sync.test.mjs` (new)
- `tests/browser/fixtures.mjs`
- `tests/browser/sensor-reading-sync.spec.mjs` (new)
- `docs/SENSOR_READING_SYNC_AUDIT.md` (new)

No SQL migration, historical write, RLS change, firmware change, deployment or Git push was performed for Fix #7. The working tree also contains earlier tasks' changes; this list identifies this task's touched files only.

## Validation and remaining work

- Production `npm run build` and bundled security scan pass. Existing bundle-size warning remains (~641 kB main JavaScript).
- 67 targeted Node unit/integration tests pass, covering monitoring, synchronization, thresholds/ranges, recommendations, Philippine time and activity history.
- 38 distinct browser checks pass across the final runs (synchronization 12, dynamic ranges 7, recommendations 10, Philippine time/control guards 9), using the real production bundle with mocked Supabase/auth/realtime and no real actuator writes. An initial combined run caught a control-history lifecycle race; after correction all nine time/control regressions passed. Earlier activity/threshold browser regressions also passed. These are isolated regression results, not live Mobile/device acceptance.
- Full ESLint reports **22 pre-existing errors / 3 warnings**, compared with 22 errors / 5 warnings before this task. New synchronization components/services/utilities/tests pass targeted ESLint. The remaining errors are existing React effect/immutability and unused-variable findings; the three warnings are existing dependencies in EditMarketplaceListingPage, MarketplaceListingDetailsPage and SellerProfilePage. `git diff --check` passes; Git emits harmless LF→CRLF notices for the Windows working copy.
- Mobile source/configuration, actual Web/Mobile/device simultaneous runtime verification, and deployed Vercel environment verification remain pending. The portable reading contract and table above provide the integration contract for the accessible Mobile workspace later.
- Fix #3 remains a proposal: separate configured numeric critical boundaries are absent, and hardware/server/app classification differences documented in `STATUS_CLASSIFICATION_FIX3_PROPOSAL.md` remain. This task does not claim to have validated or implemented that missing classifier, invent critical limits, or modify actuator interlocks.
- Existing remote access-policy concerns and the unapproved Fix #6 review SQL remain separate pending work; frontend filtering is not a substitute for RLS.

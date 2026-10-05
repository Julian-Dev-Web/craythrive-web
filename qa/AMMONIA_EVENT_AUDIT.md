# Ammonia event audit — October 5, 2026

The available web implementation is corrected and tested. The full SQL/mobile/AI audit is **not complete**: this workspace contains no verified database schema export, mobile application source, or AI backend. Their locations/schema results were requested. No SQL was executed, no migration was applied, no deployment/push was performed, and no APK was built during this task.

## 1. Current ammonia_readings schema

The **actual live schema remains unverified**. The existing frontend contract names `public.ammonia_readings`, ownership `user_id`, tank reference `tank_id`, event time `created_at`, numeric value `ammonia`, and raw metadata `ammonia_status`. These names describe existing application code, not inspected database facts. Existing readers also accept legacy numeric aliases; no corresponding columns were created or proposed.

Primary key, ownership foreign keys, actual numeric field/type/unit, created_at constraints, raw status columns, RLS policies/grants, triggers and indexes cannot be confirmed from the current repository. Existing `security/proposed-rls-hardening.sql` is an explicitly gated review draft, not proof of deployed schema.

`security/inspect-ammonia.sql` is a new read-only catalog inspection script covering those questions, including sensor columns and associated trigger bodies for possible backfill. It uses a read-only transaction followed by rollback and does not export scan rows. Run it against the intended database and provide schema results without credentials before deciding on a migration.

## 2. Whether SQL changes are required

These frontend corrections require no database writes, new tables, duplicate columns, or ammonia column on sensor_readings. Whether the live schema needs any correction remains unknown until inspection. Nothing was copied/backfilled into sensor rows, and raw statuses were not altered.

## 3. Safe SQL/index migration

No migration is proposed because no missing schema/index has been established. Inspect equivalent valid indexes first. PostgreSQL can scan a B-tree in either direction, so an existing suitable ascending index may already serve descending queries; ownership prefixes and partial predicates also matter. See the official [index ordering documentation](https://www.postgresql.org/docs/16/indexes-ordering.html) and [pg_index catalog](https://www.postgresql.org/docs/current/catalog-pg-index.html).

Only after verifying a useful index is absent should a small migration for the actual tank/time columns be prepared. Do not execute the older review draft as part of this frontend change.

## 4. Current tank snapshot

All five monitoring pages independently request each accessible tank's latest water reading and latest same-tank ammonia scan, ordered by created_at descending with null timestamps last. Requests retain the existing authenticated ownership scope and are processed in batches of four tanks. No physical merge or database update occurs.

This removes dependence on capped global history lists for current status. A quiet tank's old scan remains available even when other tanks have many newer uploads. Query failures log sanitized diagnostics and fall back to available same-tank history; that fallback can be incomplete and must be checked against staging before release.

Current cards say **Latest available ammonia scan**, show the scan's own timestamp, and display an unavailable-time message if a value has no timestamp. Missing/invalid values remain neutral **No Scan**, not fabricated zero or Normal. A real numeric zero is valid. No age cutoff was introduced.

Overall status uses current saved thresholds through evaluateReadingSafety: any critical parameter yields Critical; otherwise warning yields Warning; otherwise evaluated safe parameters yield Normal. Missing ammonia does not independently create a critical issue; no evaluated values yield No Data. Raw status strings are metadata only. An older critical manual scan can affect current overall status with its timestamp visible.

## 5. Historical records

Water readings and ammonia scans remain independent events. A water history row contains no ammonia measurement, even if legacy raw sensor metadata contains an ammonia-like field. A scan uses only its own created_at; updated_at cannot move a scan into another historical period.

Manual scan matching requires an explicit tank reference. A reused device alias alone cannot attach a scan to a different/current tank. Existing water device compatibility is retained.

Reports, Sensor Readings and Tank Details page through ammonia history rather than silently stopping at a global 300/1,000-row cap. A failed history fetch is identified; historical exports/printing are blocked if ammonia history is incomplete. Historical water/alert lists retain their pre-existing limits and are outside this ammonia pagination change.

## 6. CSV behavior

The default Historical Records export contains separate **Water Reading** and **Ammonia Reading** rows. Water rows leave ammonia fields blank; scan rows leave water fields blank. Each event keeps its own Date. One scan is not repeated across water uploads.

The explicit Latest Tank Status export contains one **Current Tank Status** row per selected tank, with distinct **Sensor Date** and **Ammonia Scan Date**, scan source and evaluated conditions. It is labeled as a latest snapshot, independent of historical date/condition filters. Existing marketplace and combined exports remain supported.

## 7. Print/PDF behavior

Historical prints have separate **Water Readings** and **Ammonia Scans** sections. A period with no scan says **No ammonia scan recorded during this period.** Filtering out existing scans by condition has a different explanation.

Latest-status prints have a dedicated **Latest Available Ammonia Scan** card with its own Scanned timestamp and a manual-scan note. Existing A4/light printing, repeated table headers and phone preview layout are preserved. Actual PDFs were generated and rendered; current and period reports fit one A4 page, and the existing 80-water-record print spans five pages without margin/blank-page findings.

## 8. Reports behavior

Latest Tank Status uses independent current data; historical date and condition filters affect historical records and analytics. Historical ammonia is included only when its own created_at falls in the selected period. An older latest scan stays on the current card without being imported into that period. A separate export selector makes Historical Records versus Latest Tank Status explicit.

## 9. AI context behavior

`src/utils/monitoringAIContext.js` provides a tested integration contract with separate latest_sensor/latest_ammonia and separate recent_sensor_readings/recent_ammonia_scans. Ammonia carries value, timestamp, evaluated condition and manual_scan measurement type. Missing scans are null. Conditions are recalculated using supplied/current thresholds.

Its instructions identify ammonia as manual and potentially older, prohibit calling it live, and require mentioning the scan timestamp when it affects advice. No stale-time policy is invented. **This helper is not connected to an AI endpoint** because no AI caller/backend exists in this workspace; actual integration remains pending.

## 10. Exact files changed

- `src/constants/schema.js`
- `src/pages/admin/DashboardOverview.jsx`
- `src/pages/admin/TanksPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/SensorReadingsPage.jsx`
- `src/pages/admin/ReportsPage.jsx`
- `src/services/tankSnapshotService.js` (new)
- `src/utils/monitoringRecords.js`
- `src/utils/monitoringAIContext.js` (new)
- `src/utils/exportPrintUtils.js`
- `security/inspect-ammonia.sql` (new)
- `tests/monitoring.test.mjs`
- `tests/browser/fixtures.mjs`
- `tests/browser/qa.spec.mjs`
- `tests/browser/mobile-reports.spec.mjs`
- `tests/browser/ammonia.spec.mjs` (new)
- `qa/AMMONIA_EVENT_AUDIT.md` (new)

## 11. Validation and remaining concerns

- `npm run build`: PASS; production bundle secret scan has zero findings. JavaScript chunk 542.50 kB (148.07 kB gzip) still triggers Vite's existing >500 kB warning.
- `npm test`: **25/25 pass**.
- Full Playwright suite: **69/69 pass**, including six responsive widths in light/dark mode, route refresh, CSV and print tests. After final orphan-scan/timestamp changes, focused ammonia suite: **7/7 pass**, including saved ammonia threshold refresh with no new upload.
- Nine PDF artifacts inspected with PDF.js: A4 portrait, no text outside checked margins, no nearly blank pages. Current-status and empty-period ammonia PDFs visually reviewed.
- ESLint: **24 existing errors and 5 existing warnings** remain, matching the prior baseline. No new findings from this change. Existing hooks/unused-import problems remain a release concern; they were not disabled or concealed.
- All browser backend traffic was mocked. These tests do not prove live Supabase schema, RLS, index use, cross-user authorization or real mobile behavior. Validate those using the requested schema/mobile/backend sources and a staging account.
- Verify actual ammonia field, measurement unit/form and ownership contract before declaring SQL/mobile parity. Existing web unit presentation and thresholds were retained without conversions or new cutoffs.
- Per-tank latest requests add network calls; complete scan history uses paginated reads and exact counts. Profile live performance after index inspection. Offset pagination is not a transactional snapshot: concurrent inserts/deletes or equal timestamps across page boundaries need staging verification and a stable ordering/key once the actual primary key is confirmed.
- Mobile application changes, database trigger/backfill audit and actual AI integration are still pending source/access availability. Nothing is deployed or production-verified by this report.

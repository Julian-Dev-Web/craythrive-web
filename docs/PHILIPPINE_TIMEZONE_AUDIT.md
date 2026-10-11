# Philippine timezone synchronization

October 11, 2026 (Asia/Manila). Supabase project: `abtzkqfrwzcocyrwcrfc`.

Web changes are implemented and tested locally. The read-only server-time RPC
was deployed separately. The Web changes have **not been committed, pushed or
deployed to hosting** in this task. Actual Expo source is unavailable, so mobile
integration and a real same-reading-ID Web/mobile comparison remain incomplete.

## Root causes and affected fields

- Pages formatted dates with `toLocaleString([])` / `toLocaleTimeString([])`,
  which use the device timezone. The header already specified Manila but obtained
  the instant from the device clock.
- Reports built filter boundaries with device-local `T00:00:00` and an inclusive
  `23:59:59.999` end. A different device timezone selected a different UTC day.
  Historical data was also capped before the selected date filter was applied.
- Tank Details computed today's feeding interval from local calendar getters.
  Freshness, connection-age and existing cooldown checks used `Date.now()`.
- Two existing manual reset actions supplied `executed_at` from browser time.
- Notification ages, refresh labels and print generation used the browser clock;
  backup preview timestamps also used implicit local formatting.

The read-only remote schema audit covered all public date/time columns. Relevant
fields include `sensor_readings.created_at`, `ammonia_readings.created_at`,
`alerts.created_at/resolved_at`, `control_logs.created_at`,
`device_commands.created_at/updated_at/executed_at`,
`tank_automation_logs.created_at`, marketplace order/listing timestamps, seller
profile timestamps, chat timestamps, and device last-seen timestamps.

These fields are `timestamp with time zone`. The relevant creation columns
already default to PostgreSQL `now()`. **No public timestamp-without-time-zone
columns were found.** No old timestamps were converted, shifted or rewritten.
The database timezone remains UTC.

## Implemented policy

`supabase/functions/_shared/philippineTime.js` is portable JavaScript for Web,
Expo/Hermes and Deno. `src/utils/philippineTime.js` reexports the exact module.

- All date/time presentation explicitly uses `Asia/Manila` and `en-PH`.
- Timestamp parsing requires an explicit offset or `Z`; PostgreSQL's space
  separator and short `+00` offset are supported. Ambiguous offsetless legacy
  values are shown as unavailable rather than guessed in the device timezone.
- Philippine calendar dates are separate from instants. October 11, 2026 uses
  **`[2026-10-10T16:00:00.000Z, 2026-10-11T16:00:00.000Z)`**.
- Reports send inclusive `.gte(created_at,start)` and exclusive
  `.lt(created_at,end)` conditions to Supabase. A selected range pages through
  its matches. The same bounds also filter in-memory/export records.
- Current tank snapshots continue to load independently of historical filters.
  Owner filters, threshold resolution and sensor values are preserved.
- Chronological comparisons use saved instants. Invalid/missing event dates do
  not become invented current timestamps.

`serverClock.js` anchors a database instant to `performance.now()`, not the device
wall clock. Web refreshes the anchor every minute and on returning to the app;
an anchor older than five minutes becomes unavailable. Missing/invalid server
time never silently falls back to the device clock.

The header, notification ages, refresh labels, print generation, today's feeding
interval, connection age and existing freshness/cooldown checks use this policy.
Clock failure leaves saved readings usable and blocks time-dependent commands;
the existing Emergency Stop path is retained. Existing cooldown durations and
hardware command payloads are unchanged.

New Web inserts already omit `created_at`, leaving creation time to database
defaults. The two manual reset updates now obtain their `executed_at` directly
from a fresh database response. The interpolated clock is only used for display
and elapsed-time checks. Backup download names use a random ID instead of a
potentially incorrect browser timestamp.

## SQL addition and remote verification

Applied only:
`supabase/migrations/20261011150000_server_time.sql`.

```sql
public.craythrive_server_time() RETURNS timestamptz
```

This read-only, SECURITY INVOKER function returns `pg_catalog.clock_timestamp()`
with a fixed `pg_catalog` search path. Authenticated EXECUTE is granted; PUBLIC
and anon EXECUTE are revoked. No table, existing policy, column default,
automation function, firmware or database timezone was changed.

Deployment used the linked project's supported CLI:

```powershell
& 'C:/Users/AMD/AppData/Local/npm-cache/_npx/b96a6bd565c470ce/node_modules/@supabase/cli-windows-x64/bin/supabase.exe' db query --linked --project-ref abtzkqfrwzcocyrwcrfc --file supabase/migrations/20261011150000_server_time.sql --output json
```

A subsequent read-only transaction executed the function as `authenticated` and
verified `authenticated_execute=true`, `anon_execute=false`, and
`security_definer=false`. It returned approximately **13:19 UTC / 21:19 Manila**
on October 11. This is a database-role verification; no user credentials were
requested or exported. No unrelated migration, including the pending pump
wording migration, was deployed.

## Exact files changed for this task

Shared utilities and Web clock:

- `supabase/functions/_shared/philippineTime.js`
- `supabase/functions/_shared/serverClock.js`
- `src/utils/philippineTime.js`
- `src/services/serverTimeService.js`
- `src/hooks/useServerTime.js`

Web pages and components:

- `src/layouts/AdminLayout.jsx`
- `src/components/NotificationBell.jsx`
- `src/components/DeveloperBackupHistory.jsx`
- `src/components/DeveloperBackupTools.jsx`
- `src/pages/admin/AlertsPage.jsx`
- `src/pages/admin/DashboardOverview.jsx`
- `src/pages/admin/MarketplaceListingDetailsPage.jsx`
- `src/pages/admin/MarketplaceOrdersPage.jsx`
- `src/pages/admin/MarketplacePage.jsx`
- `src/pages/admin/OrdersPage.jsx`
- `src/pages/admin/ReportsPage.jsx`
- `src/pages/admin/SellerProfilePage.jsx`
- `src/pages/admin/SensorReadingsPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/TanksPage.jsx`

Monitoring/export helpers:

- `src/services/tankSnapshotService.js`
- `src/utils/exportPrintUtils.js`
- `src/utils/monitoringAIContext.js`
- `src/utils/monitoringRecords.js`
- `src/utils/sensorReadingUtils.js`

SQL, tests and report:

- `supabase/migrations/20261011150000_server_time.sql`
- `tests/philippine-time.test.mjs`
- `tests/browser/philippine-time.spec.mjs`
- `tests/browser/fixtures.mjs`
- `docs/PHILIPPINE_TIMEZONE_AUDIT.md`

Existing drain/refill wording edits, threshold-audit edits and reconciliation
template/test removals predate this task and were preserved separately. They
must not be represented as part of this timezone change.

## Tests and remaining verification

- 42 timezone, monitoring and security unit/SQL tests passed, including real
  local PostgreSQL defaults and server-clock grants through PGlite.
- 23 browser tests passed, covering New York/Tokyo/London, reading/alert/activity/order
  timestamps, date-range queries and CSV/print boundaries, clocks moved to 1999
  and 2035, queued payloads omitting client timestamps, server-stamped reset
  timestamps, existing cooldown preservation and unavailable server time.
- Existing threshold and ammonia browser regressions are also exercised.
- `npm run build` passed; distribution credential scan has no findings.
- Targeted ESLint for new utilities, clock service/hook and timezone fixtures/
  tests passed. Full ESLint retains the prior 22 errors and 5 warnings.
- The existing approximately 601 kB production chunk-size warning remains.

The Expo project has no available source tree here; **no actual mobile file was
changed**. Integrate the same portable formatter/day-boundary/clock modules into
its real readers and filters, omit client creation timestamps, and ship an
updated mobile bundle. APK versus compatible OTA requirements require its build
configuration. Then compare the same reading ID on both devices.

Only `firmware/WaterReadingHealth.h` and a static C++ fixture are present. They
contain measurement-health elapsed-time logic, not an NTP setup or upload
timestamp path. The full ESP32 sketch is unavailable, so NTP and whether uploads
override `created_at` remain unverified. No firmware or pins were changed.

Authentication and the SDK's own token handling are preserved. Existing
Developer Mode expiry hints still use device time; server authorization and
restore expiry remain enforced server-side. Those hints are not authoritative
record creation timestamps and were not used to bypass their server checks.

Manual production verification after publishing the Web code:

1. Display a saved `12:00:00Z` reading: expect `8:00 PM` Manila.
2. Change the browser timezone to New York, Tokyo and London; that saved record
   must keep the same Philippine date/time.
3. Select October 11, 2026 in Reports and inspect the two UTC request boundaries
   above, CSV output and print output.
4. Confirm a normal new listing/order/command insert omits client creation time
   and the returned `created_at` agrees with database time despite clock skew.
5. Inspect the existing cooldown UI after changing the device clock; do not
   activate physical equipment solely for this timestamp test.
6. Repeat the same-record-ID check in the updated mobile app once its source is
   integrated. This acceptance item is not claimed complete.

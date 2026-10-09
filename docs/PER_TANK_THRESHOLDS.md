# Per-tank thresholds and threshold activity

## Implementation and rollout state

Implemented locally for the React/Vite Web dashboard. The migration is created
and tested against local PostgreSQL (PGlite); **it has not been applied to live
Supabase**. No deployment, Git push, firmware edit, mobile edit, authentication
change, marketplace change, or historical sensor-data write was performed.

Apply the reviewed database migration before releasing this Web change. Without
the RPC, Apply reports that database setup is required and does not activate a
browser-only substitute for a successful server save.

## Audit findings

Read-only inspection of the current linked project confirmed:

- `threshold_settings` had no `tank_id`; it used `UNIQUE(user_id)` and held two
  existing user rows at audit time.
- It already had all seven numeric threshold columns, a `thresholds` JSONB
  object, and creation/update timestamps. It did not have the pending-AI columns
  referenced by the older code.
- `/admin/settings` routes to `SettingsPage.jsx`. `ThresholdSettingsPage.jsx`
  was an un-routed second implementation with another global upsert and AI Apply
  code. It now re-exports the shared settings implementation.
- Both previous writers upserted on `user_id`; monitoring loaded one row per
  user with `maybeSingle()`. There was no selected threshold tank.
- Existing `control_logs` supports user/tank identity, action type/status,
  notes and timestamps. Tank Details displayed `device_commands` only.
- The existing control-log alert trigger recognizes feed/pump/drain/refill action
  types. `threshold_updated` matches none of those branches, so it does not create
  a fake actuator-success notification.
- There is no routed AI Guide or AI generation endpoint in this Web repository.
  The pending-recommendation acceptance flow is supported; this change does not
  invent a recommendation generator or claim AI autonomously operates the farm.

## Exact schema changes

Migration: `supabase/migrations/20261009180000_per_tank_thresholds.sql`.

- Add nullable `threshold_settings.tank_id`, referencing `tanks(id)` with cascade
  deletion when the tank is deleted.
- Replace `UNIQUE(user_id)` with `UNIQUE(user_id,tank_id)`.
- Add a partial unique index on `user_id WHERE tank_id IS NULL`, retaining one
  legacy baseline per user.
- Add `pending_ai_suggestion JSONB` and `pending_ai_suggested_at TIMESTAMPTZ`.
- Add `control_logs.metadata JSONB NOT NULL DEFAULT '{}'`.
- Add normalization and recommendation helper functions, an audit trigger and
  `apply_tank_thresholds(uuid,jsonb,text,text)` RPC.
- Add restrictive RLS guards described below. Existing permissive policies and
  actuator alert functions/triggers are retained.

## Existing-data migration

Existing threshold rows retain their original IDs, JSON, numeric values and
timestamps with `tank_id=NULL`. The migration copies each owner's existing row
to each tank belonging to that owner. It neither deletes old rows nor rewrites
sensor readings. Backfill occurs before the audit trigger is installed, so it
does not fabricate user activity.

A tank with no custom row uses its owner's retained legacy baseline; if no such
baseline exists, it uses application defaults. New rows are created on Apply.
Legacy rows are read-only to authenticated clients after migration. Older
incompatible stored values are preserved, not silently replaced; the editor
requires valid values before applying them.

**Client compatibility:** any external client still using one-row-per-user reads
or `upsert(... onConflict: 'user_id')` must adopt tank-scoped access before this
migration is rolled out. The old conflict target no longer exists, and retained
legacy plus tank rows make a user-only `maybeSingle()` ambiguous. All such Web
paths found in this repository were updated. Mobile/firmware code was outside
this task and was not changed; coordinate their compatibility before live apply.

## Apply behavior

The editor clearly selects an owned tank. Selection is retained in the settings
URL so refresh reopens that tank. Unsaved input values are distinct from the
displayed saved active values; switching tanks loads that tank's settings.

**Apply to This Tank** sends only edited fields. The RPC obtains the actor from
`auth.uid()`, checks tank ownership, locks current rows and merges the patch into
the latest saved configuration. Fields not edited by the user retain current
server values, including concurrent saves. It synchronizes the JSON and numeric
columns and records an event only if effective threshold values changed.

**Apply to All My Tanks** opens a confirmation dialog naming the owned-tank
count. After confirmation, the RPC fetches and locks the current owned tanks and
applies the selected tank's complete edited settings to each. All writes and
audit inserts share one transaction; a failure rolls everything back. Each tank
whose values changed receives one activity entry. Unchanged tanks receive no
misleading event. The response reports affected/changed counts.

## AI acceptance

A pending tank recommendation displays saved current values, proposed values,
and its explanation. Merely loading or reviewing it changes no threshold and
creates no activity. The user chooses Apply to This Tank or confirms Apply All.

For AI Apply, the server reads the current pending recommendation from the
selected tank's row and derives the patch itself. It does not trust a caller's
replacement recommendation. In Apply All, it combines the selected tank's latest
saved settings with that recommendation before copying the resulting values.
An incomplete/invalid recommendation fails validation. Acceptance clears the
pending recommendation; dismissal clears it without changing thresholds or
creating a threshold-update event.

Activity records `source=ai_recommendation`, but `actor_user_id` remains the
authenticated user. Notes say **“AI recommendation accepted by user.”**

## Activity architecture and RLS

The existing `control_logs` table stores one readable event per changed tank:

- `action_type=threshold_updated`, `action_status=updated`.
- Existing `user_id`, `tank_id`, `notes`, `created_at` identify the action.
- Metadata includes `source` (`manual` / `ai_recommendation`), `scope`
  (`single_tank` / `all_tanks`), actor UUID, and complete `old_values` / `new_values`.
- Notes list all changed fields and units in one event, plus acceptance/scope
  context when applicable.

An AFTER INSERT/UPDATE trigger audits effective value changes, including direct
authenticated writes. Pending-recommendation-only updates and no-op saves do
not produce events. Tank Details merges these configuration events with existing
command history and renders **Threshold Updated / Updated** with a settings
icon. Existing command status rendering and command cleanup remain unchanged;
configuration events are excluded from the latest-command completion check.

Restrictive threshold RLS supplements existing owner policies with actual tank
ownership checks on reads/inserts/updates. Legacy baseline rows cannot be edited
and configurations cannot be client-deleted. Changing a row's owner/tank identity
is rejected by the audit trigger.

Existing broad authenticated `control_logs` policies were found during the audit.
New restrictions isolate threshold events to the owning user/tank and prevent
client inserts, updates or deletions of those audit rows. The database-owned
audit trigger inserts them. Existing actuator-log policy behavior is untouched.
The Apply RPC uses SECURITY INVOKER, so RLS remains active, accepts no actor/user
ID from the caller, and grants execution only to authenticated callers. No
service-role credential is used by the React client.

## Monitoring refresh

Monitoring loads a per-tank threshold bundle. Tank cards, Tank Details, current
summaries, historical display, ammonia evaluation, exports and AI context resolve
the configuration for the relevant tank independently.

After successful Apply, settings are refetched. Account-scoped caches and
same-tab/storage events trigger reevaluation in open monitoring pages, including
other tabs. No new sensor upload is required. Failed saves do not mark drafts
active or update the cache with unsaved input.

A firmware `SAFE_IDEAL` reading below the newly saved tank minimum now receives a
Web Warning rather than staying Normal. Existing firmware warning/critical tiers,
stale/error health guards and 0.1 cm display precision are retained. No critical
water boundary or firmware severity threshold was invented or changed.

## Validation

- Full unit suite: **117 passed, one existing retired-feature skip**.
- Nine local PostgreSQL migration/RPC/RLS tests cover preservation/backfill,
  single/multiple/one-tank owners, Apply All isolation, no-op, AI acceptance and
  Apply All, actor attribution, duplicate constraints, new-tank fallback,
  validation, unauthorized access, concurrent untouched fields, and atomic
  rollback of settings plus activity.
- Monitoring tests cover per-tank history/snapshot/export/AI consistency and
  account-isolated caches without raw data mutation.
- Impacted browser suite: **68 passed**, covering settings, all monitoring pages,
  selection/refresh, confirmation/cancel, AI acceptance, missing migration,
  cross-tab refresh, activity rendering, stale/error regression and 390 px layout.
- Final focused browser run after saved-value/disabled-input UX changes:
  **six passed**.
- `npm run build` passes; distribution security scan is clean.
- Targeted ESLint for new/shared/settings/test files passes. Full-repository
  ESLint reports **22 existing errors and five warnings**; the previous baseline
  had 24 errors/five warnings. Remaining findings are in existing page effects or
  unrelated code. Existing >500 kB JavaScript chunk warning remains.

No live RLS/write tests or migration apply were performed. Production was only
inspected with read-only metadata queries.

## Files changed

- `src/pages/admin/SettingsPage.jsx`
- `src/pages/admin/ThresholdSettingsPage.jsx`
- `src/components/TankThresholdControls.jsx` (new)
- `src/hooks/useTankThresholdSettings.js` (new)
- `src/hooks/useThresholdRefresh.js` (new)
- `src/services/tankThresholdService.js` (new)
- `src/styles/settings.css`
- `src/pages/admin/TanksPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/DashboardOverview.jsx`
- `src/pages/admin/SensorReadingsPage.jsx`
- `src/pages/admin/ReportsPage.jsx`
- `src/utils/thresholdEvaluation.js`
- `src/utils/sensorReadingUtils.js`
- `src/utils/monitoringRecords.js`
- `src/utils/monitoringAIContext.js`
- `supabase/migrations/20261009180000_per_tank_thresholds.sql` (new)
- `tests/per-tank-thresholds.test.mjs` (new)
- `tests/browser/tank-thresholds.spec.mjs` (new)
- `tests/browser/fixtures.mjs`
- `tests/browser/qa.spec.mjs`
- `tests/browser/water-health.spec.mjs`
- `tests/browser/water-severity.spec.mjs`
- `tests/monitoring.test.mjs`
- `docs/PER_TANK_THRESHOLDS.md` (this report)

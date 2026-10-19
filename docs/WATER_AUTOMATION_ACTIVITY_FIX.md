# Automatic water Activity and persistent alerts

## Findings and data sources

`TankActivityHistory.jsx` already renders a shared timeline from
`tankActivityService.js`. The previous service read `device_commands`,
`control_logs`, `alerts` and `ammonia_readings` directly, but read
`tank_automation_logs` **only** through `get_tank_automation_history`. That RPC's
definition existed only in a review-only SQL document, not a deployable migration.
A missing RPC was cached and automation rows were skipped, so existing physical
actions could be absent even when the table contained them.

The service now retains the owner-checked RPC as its preferred automation source
and falls back to an authenticated direct table query only when the RPC is
genuinely absent. Every refresh verifies the current user owns the selected tank,
filters by tank and owner, pages all sources, applies Philippine calendar date
bounds, and checks returned row scope. Ownerless automation rows are accepted
only for that verified tank; explicitly foreign owners are excluded. RPC auth,
RLS and network errors never cause an alternative-read bypass. If direct SELECT
is denied, a notice explains that automation history could not be verified.

The resulting five sources are normalized into the existing timeline, sorted
newest first by their recorded timestamps. Source-prefixed keys such as
`device_commands:<id>` and `tank_automation_logs:<id>` prevent cross-table ID
collisions. Two real pulses with different IDs remain two events, including when
their timestamps and action types are identical. Only explicit saved references
connect command/control/alert mirrors to a canonical automation row. Independent
sensor alerts remain separate.

## Presentation and refresh

For the source table, `action_status` is authoritative:

| Value | Activity label |
| --- | --- |
| done / completed | Completed (green) |
| failed | Failed |
| blocked | Blocked |
| rechecking | Rechecking (amber) |
| missing / unknown | Unknown / Unconfirmed |

`AUTO_REFILL` is titled **Automatic Water Refill**; `AUTO_DRAIN` is
**Automatic Water Drain**. Completed result text says the actuator automatically
added/drained water. The original database reason and saved sensor statuses,
stable-reading count and duration remain visible. A duration is labeled
**Recorded duration**, not inferred from a requested manual pump command.
`created_at` remains untouched and uses the existing Asia/Manila formatter.
Manual command status still comes from `command_status`.

Refresh and the existing visible-page 30-second activity timer fetch only
Activity's sources and ownership verification. They retain the displayed timeline,
filters and pagination while fetching; they do not reload Tank Details, its
sensor/controls state or AI recommendations. This component does not have a
Realtime subscription; its existing scoped refetch strategy is retained.

## Persistent notification migration

Review the read-only inspection:
`docs/sql/20261019_water_activity_alerts_preflight.sql`.

Apply **only**
`supabase/migrations/20261019170000_water_automation_activity_alerts.sql`
for this task, after reviewing the intended project's schema. Do not apply unrelated
migrations as a broad batch. The migration requires the existing
`create_alert_if_enabled(uuid,uuid,text,text,text,text,text,jsonb)` helper. If it is
missing, the transaction stops before installing changes.

It creates/replaces the owner-checked read RPC:

```sql
public.get_tank_automation_history(
  p_tank_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
) RETURNS SETOF public.tank_automation_logs
```

Only `authenticated` receives the read-RPC execute grant. It requires `auth.uid()`
and matching tank ownership. It adds a tank/date/id read index, three private
notification functions and two triggers:

- `craythrive_water_activity_alert_payload(jsonb,text)` builds presentation from
  the recorded action status, tank name and original reason.
- `craythrive_notify_water_activity()` runs after automation INSERT/status UPDATE.
  It calls the **existing** preference helper with `pump_alerts` / `control_log`.
- `craythrive_normalize_water_activity_alert()` runs before alert INSERT. Direct
  notifications and existing command/control mirror alerts share the same source
  log ID. It uses the source log's authoritative status, normalizes automatic
  wording, honors pump preferences, and suppresses a repeated notification.

Canonical alerts use `source='tank_automation_logs'` and
`metadata.tank_automation_log_id`; a partial unique index and a transaction lock
provide duplicate protection. A later source-status update can update the same
alert's presentation while preserving its ID, read/resolved state and timestamp.
An explicitly linked older command alert can be adopted on such an update;
unrelated alerts are not merged. There is no timestamp-proximity grouping.

Completed source rows create **Automatic Water Refill Completed** or
**Automatic Water Drain Completed**. Failed/blocked rows use Failed/Blocked and
the real reason; they cannot produce a success notification. Rechecking/pending
rows create no new completion alert until a real terminal status is recorded.
No browser is required. Existing alert delivery/push hooks continue consuming the
same `alerts` table. Notification failures emit a sanitized SQLSTATE warning
instead of rolling back a valid automation log; inspect database warnings if
delivery fails. No retry scheduler is added.

The migration does **not** rewrite historical automation rows or backfill alerts,
modify existing RLS policies/device grants, replace actuator mirror/command
functions, or enqueue commands. Existing history becomes readable without
triggering another pump action. The fallback can display existing rows before
migration if current authenticated SELECT policies allow it; persistent alerts
and the preferred RPC require the migration to be applied.

## Files changed for this task

Application/shared:

- `src/services/tankActivityService.js`
- `src/components/TankActivityHistory.jsx`
- `src/components/NotificationBell.jsx` (reload saved alerts on each open)
- `supabase/functions/_shared/tankActivity.js`
- `supabase/functions/_shared/monitoringAlertPresentation.js`

SQL/docs:

- `supabase/migrations/20261019170000_water_automation_activity_alerts.sql`
- `docs/sql/20261019_water_activity_alerts_preflight.sql`
- this report

Tests:

- `tests/tank-activity.test.mjs`
- `tests/action-status.test.mjs`
- `tests/water-automation-status.test.mjs`
- `tests/water-activity-alerts-sql.test.mjs`
- `tests/browser/fixtures.mjs`
- `tests/browser/tank-activity.spec.mjs`
- `tests/browser/water-automation-status.spec.mjs`
- `tests/browser/automatic-water-activity.spec.mjs`

Earlier actuator-command compatibility changes remain separately in the working
tree. This task makes **no firmware, water algorithm, threshold, cooldown, pulse
duration, feeding, Stop/Resume or feed-lock-reset changes**.

## Validation and remaining live checks

Local tests use the supplied table schema, stored automation examples and the
existing command/control mirror fixtures. They verify existing-history reads,
owner/RPC permissions, missing-RPC fallback, multiple real pulses, one alert per
log across pipelines, preferences, source-authoritative failure/rechecking,
no-browser persistence, repeat migrations, and unchanged actuator-function
definitions. Browser tests cover Asia/Manila display, narrow layouts, retained
Activity state, preserved recommendations and bell refresh.

Checks completed:

- `npm run build`: passed; distribution security scan has no findings. Existing
  JavaScript chunk-size warning remains (approximately 687 kB).
- `npm test`: 284 total, 283 passed, one existing skip, no failures.
- Targeted Playwright Activity, automatic-water, status and recommendation
  persistence suite: 31 passed. The three new automatic-water tests also passed
  after the final orphan-alert presentation adjustment.
- Full ESLint: 18 existing errors and 3 warnings in untouched files; all files
  changed for this task are clean.

No authenticated remote database session is available in this workspace. This
migration has **not been deployed remotely**; existing production rows and a new
real automatic refill/drain have **not been observed from here**. No pump was
triggered for verification. After deployment, inspect existing rows first, then
observe the next real automatic action: one source log, one Activity entry and
one persisted alert. Refresh must not create more commands or notifications.

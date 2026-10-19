# Automatic water control status compatibility

## Current Web rendering correction

The rendering rules below supersede the original presentation contract recorded
later in this document. No additional SQL migration or database rewrite is
required for this correction.

`actionStatus.js` is now the shared source-aware status reader. Automation logs
use `action_status`; device commands use `command_status`. Other/legacy rows use
`action_status ?? command_status ?? status ?? result`. Embedded notification
metadata is a fallback, and alert read/resolution state is kept separate from
execution status. A missing `command_status` cannot invalidate a saved
automation `action_status`.

| Saved status | Current Web label |
| --- | --- |
| done / completed | Completed |
| rechecking | Executed – Rechecking |
| blocked | Blocked |
| skipped | Skipped |
| failed | Failed |
| rejected | Rejected |
| running | In Progress |
| pending | Pending Verification |
| null / unknown | Unknown / Unconfirmed |

DONE is never downgraded by missing acknowledgement timestamps, exact reason
wording, missing mirror metadata, or diagnostic text containing another status.
Saved failed rows remain Failed regardless of reason parsing. Automatic DONE,
rechecking, failed and blocked results use the requested friendly explanations;
original automation reasons and sensor context remain visible. ID-based
deduplication and source priority remain in place.

This rendering correction updates `actionStatus.js`, `waterAutomationStatus.js`,
`tankActivity.js`, `pumpActionWording.js`, `feederControl.js`, Tank Details,
the Activity timeline, and Automatic Feeding Settings plus their regression tests.
Daily feeding accounting now counts only FEED_ONCE rows with
`command_status === 'done'`; an extra acknowledgement phrase is not required.
Pending/running/rejected/failed rows do not count, and display labels do not
participate in that decision. Pump/feeder command execution and safety interlocks
are unchanged. Reports continue exporting sensor/ammonia and marketplace records;
they do not combine actuator history sources.

The existing SQL migration below remains a historical migration and its legacy
notification text is tested independently of the current Web presentation.

Files modified for this rendering correction:

- `supabase/functions/_shared/actionStatus.js` (new)
- `supabase/functions/_shared/waterAutomationStatus.js`
- `supabase/functions/_shared/tankActivity.js`
- `supabase/functions/_shared/pumpActionWording.js`
- `supabase/functions/_shared/feederControl.js`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/components/TankActivityHistory.jsx`
- `src/components/AutomaticFeedingSettings.jsx`
- `tests/action-status.test.mjs` (new)
- `tests/tank-activity.test.mjs`
- `tests/water-automation-status.test.mjs`
- `tests/water-automation-sql.test.mjs`
- `tests/feeder-control.test.mjs`
- `tests/browser/tank-activity.spec.mjs`
- `tests/browser/water-automation-status.spec.mjs`
- `tests/browser/pump-wording.spec.mjs`
- `tests/browser/manual-feeding.spec.mjs`
- `docs/WATER_AUTOMATION_STATUS.md`

## Original implementation audit

Implemented on 2026-10-19. No remote SQL, firmware deployment, historical-row
rewrite, actuator request, Git commit or push was performed for this change.

## Findings and inspected files

- `supabase/functions/_shared/tankActivity.js`: automation completion previously
  required the exact reason `Automatic water-level correction pulse completed.`;
  `rechecking` was unrecognized, blocked was collapsed into Skipped, and any
  failed status was treated as an execution failure regardless of its reason.
- `supabase/functions/_shared/pumpActionWording.js`: did not recognize rechecking;
  old titles could therefore supply an incorrect fallback outcome.
- `src/components/TankActivityHistory.jsx`, `src/styles/tankActivity.css`,
  `src/services/tankActivityService.js`: existing timeline, owner-checked history
  RPC, pagination and background-refresh behavior were reused.
- `src/pages/admin/TankDetailsPage.jsx`, `DashboardOverview.jsx`, `AlertsPage.jsx`,
  `src/components/NotificationBell.jsx`, and shared
  `monitoringAlertPresentation.js`: inspected the Latest Action summary, alert
  severity, notification and history presentation paths.
- `src/pages/admin/ReportsPage.jsx`, `src/utils/exportPrintUtils.js`,
  `src/utils/printPagination.js`: Reports exports sensor/ammonia and marketplace
  records, not automation/alert history. No automation export path exists to
  change; alerts were deliberately not reintroduced into Reports.
- Existing `20261010170000_pump_alert_wording.sql`, activity-history review SQL,
  prior schema/function audit artifacts, and existing pump/activity tests were
  inspected. The saved schema audit describes `action_status` as text with a
  default of done. It does not establish the current live CHECK constraints.
- The audited `mirror_tank_automation_log_to_device_commands()` loses original
  statuses in a terminal command mirror. Retain this terminal behavior: changing
  a history mirror to pending could accidentally enqueue another pump action.

There is no live Supabase administrative connection available in this session.
Current remote constraints and deployment are **unverified**. Local PostgreSQL
tests cover unconstrained text, a restrictive CHECK, an enum, repeat application,
and rejecting a composite safety constraint without weakening it.

## Original UI contract (superseded above)

The portable `waterAutomationStatus.js` helper handles automatic refill/drain:

| Recorded outcome | Primary label | Tone |
| --- | --- | --- |
| done | Completed | Green |
| rechecking | Executed – Rechecking | Amber |
| blocked | Blocked | Amber |
| skipped | Skipped | Neutral |
| failed with an execution-failure reason | Failed | Red |
| failed with inconclusive sensor verification, unknown, null, pending, or an ambiguous old mirror | Pending Verification | Neutral |

The failed-reason check recognizes explicit interruption/STOP_ALL, safety abort,
inability to execute/complete/start/activate, execution error and hardware fault.
Ambiguous legacy failure text remains available for inspection; it is never
rewritten into successful execution. A raw done automation row follows the
firmware's recorded-completion contract, without claiming a measured water
volume or that today's tank is at its target. Manual command acknowledgement
and feeder completion rules remain unchanged.

`tankActivity.js` feeds the Activity timeline. Latest Action and pump/alert wording
use the same portable evaluator. Rechecking descriptions state that the pump
executed but the expected effect is awaiting fresh sensor confirmation. Raw
reasons, before/after depth text, saved sensor statuses, stable reading count,
recorded duration and Asia/Manila timestamps remain visible when available.
Internal automation link identifiers are omitted from the displayed reason.

Deduplication uses source IDs plus explicit automation-log IDs, command IDs,
control-log IDs or the saved `Auto log id` reference. Raw automation has priority
over its command/control/notification mirrors. Repeated fallback mirrors also
produce one card when the raw RPC is unavailable. Different automation IDs at
the same timestamp remain separate attempts; timestamp text is never the key.

Rechecking action notifications are informational across Alerts, Dashboard,
notification presentation and Tank Details. Independent sensor alerts retain
their severity. The frontend creates no new alerts. The existing database
control-log trigger produces info for rechecking, not a failure/Critical alert.

## Migration and manual remote step

Apply **only**
`supabase/migrations/20261019120000_water_automation_rechecking.sql`
through the target project's SQL editor or the project's reviewed migration
workflow. Do not blindly deploy unrelated pending migrations.

The migration:

1. Inspects the actual action_status type/constraints at application time. It
   adds rechecking to an existing enum or extends an existing single-column
   CHECK while preserving its prior expression and validation state. It adds
   no constraint to an unconstrained text column. Composite constraints stop
   the migration for review rather than weakening another safety condition.
2. Updates the existing SQL pump wording function to recognize rechecking and
   ambiguous legacy sensor verification failures. No new tables are created.
3. Adds `Auto action status` to the existing mirror diagnostic text. Command
   status stays terminal; the actuator queue and pump/feeding rules are untouched.
4. Uses CREATE OR REPLACE on the existing functions, retaining their signatures,
   security settings, search paths and grants. Shape guards abort if the deployed
   function bodies have changed incompatibly. No trigger/table grant/RLS edits
   and no historical data update or alert backfill occur.

Allowed database values after migration are **all previously allowed values plus
rechecking**. The five firmware outcomes are done, rechecking, blocked, skipped,
failed. Existing pending/unknown/null rows remain readable; no five-value enum or
NOT NULL restriction is imposed.

Read-only remote inspection before/after applying the migration:

```sql
SELECT a.atttypid::regtype AS status_type, pg_get_expr(d.adbin,d.adrelid) AS default_value
FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid='public.tank_automation_logs'::regclass AND a.attname='action_status';

SELECT conname, pg_get_constraintdef(oid), convalidated
FROM pg_constraint WHERE conrelid='public.tank_automation_logs'::regclass;

SELECT e.enumlabel FROM pg_enum e JOIN pg_attribute a ON a.atttypid=e.enumtypid
WHERE a.attrelid='public.tank_automation_logs'::regclass AND a.attname='action_status'
ORDER BY e.enumsortorder;

SELECT proname, prosecdef, proconfig, proacl
FROM pg_proc WHERE oid IN (
  'public.craythrive_pump_action_wording(jsonb)'::regprocedure,
  'public.mirror_tank_automation_log_to_device_commands()'::regprocedure
);

SELECT public.craythrive_pump_action_wording(
  '{"action_type":"AUTO_REFILL","action_status":"rechecking"}'::jsonb
);
```

Do not insert synthetic pump requests into the production command queue to test
the UI. The updated actuator firmware must send rechecking/done/failed using the
new contract; this Web change does not install or alter that firmware.

## Modified files and validation

Application: `src/components/TankActivityHistory.jsx`,
`src/constants/schema.js`, `src/pages/admin/AlertsPage.jsx`,
`src/pages/admin/DashboardOverview.jsx`, `src/pages/admin/TankDetailsPage.jsx`,
`src/styles/tankActivity.css`, `supabase/functions/_shared/tankActivity.js`,
`pumpActionWording.js`, `monitoringAlertPresentation.js`, and new
`waterAutomationStatus.js` in that shared directory.

Database: the single migration above. Documentation: this file.

Tests: `tests/tank-activity.test.mjs`, `tests/pump-alert-sql.test.mjs`, new
`tests/water-automation-status.test.mjs`, `tests/water-automation-sql.test.mjs`,
`tests/fixtures/automation-mirror-before.sql`,
`tests/browser/tank-activity.spec.mjs`, `tests/browser/pump-wording.spec.mjs`, and
new `tests/browser/water-automation-status.spec.mjs`.

The A–E examples, legacy/null states, explicit-ID deduplication, fallback mirrors,
reason/context preservation, unchanged raw records, SQL compatibility and
desktop/390px browser rendering are covered. The full Node suite reports 225
passed, 1 pre-existing skipped, 0 failed; all 26 targeted browser checks pass.
Build/security scan pass. The
repository-wide lint baseline remains 22 existing errors and 3 warnings, with
no added lint findings. Vite retains its existing large-chunk warning.

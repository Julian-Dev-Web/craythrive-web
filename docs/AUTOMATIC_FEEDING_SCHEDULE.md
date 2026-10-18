# Per-tank automatic feeding schedule — Web

2026-10-18. Web editor, service, migration and tests implemented. The migration
has NOT been applied remotely. The complete actuator source is NOT in this
repository, so configurable physical scheduling remains pending firmware
integration. No production settings or hardware commands were changed.

## Inspection and remote evidence

Inspected SettingsPage, TankDetailsPage, ManualFeedOptions, feederControl,
tankActivity, TankActivityHistory, tankActivityService, tankThresholdService,
useTankThresholdSettings, Supabase client, server-time/Philippine-time helpers,
existing migrations, control styles and regression fixtures. No existing Web
automation editor or feeding-settings RPC helper was present in those sources.
The existing Apply All pattern belongs to thresholds; no feeding Apply All was
added to the new automation editor.

The older local schema audit includes `tank_automation_settings` with UUID
id/user_id/tank_id, device_uid and water automation/stability/pump settings. It
predates the four feeding fields. Read-only requests to the linked project
`abtzkqfrwzcocyrwcrfc`, selecting one field with `limit=0`, returned HTTP 200 for
all four current feeding fields. They already exist remotely; they are not
blindly duplicated. No tank rows were fetched by this probe.

Public OpenAPI discovery returned HTTP 401, so live defaults, constraints, RLS,
unique indexes and other RPC names were not verified through it. A public-key
read-only call to `get_tank_feeding_schedule` with an all-zero tank UUID returned
HTTP 404 / PGRST202: this reader signature is not currently available through
REST. This task has not deployed the migration. No remote save was attempted.

Only `firmware/patches/CrayThrive_Actuator_v1_11_0.ino.patch` is present. It covers
water-reading handling, not a complete settings loader or scheduled feeding
routine. A sketch path mentioned by an old local export script is outside this
repository and was not edited. No fabricated replacement sketch was created.

## Implemented UI and flow

Settings uses its existing selected-tank control. Tank Details exposes the same
reusable Automatic Feeding card in Controls, above the separately titled Manual
Feed Now controls. Both reuse the existing cycle selector and relative labels.

Load calls `get_tank_feeding_schedule(p_tank_id)`. The server verifies Auth/owned
tank and reads only its owner's matching settings row. No row is created on
page open. An absent row displays approved defaults: ON, 19:00, 2 cycles, with
an explicit "not saved" notice. A first row requires a verified paired actuator
to satisfy the existing device relationship. Existing rows preserve their
device binding. Duplicate settings/pairing ambiguity produces an error rather
than silently choosing one row or deleting data.

Save validates a boolean enabled flag and integer hour 0–23, minute 0–59 and
cycles 1–3, then calls the scoped save RPC. It changes only those four fields.
Turning OFF disables the time/cycle inputs but retains and saves their values.
An empty/invalid time prevents saving. Saved defaults are not written until an
explicit save. Success requires the returned verified values to match the
requested values. Errors never produce a success message; failed drafts remain
available. Requests have a deadline and duplicate clicks share a submission
guard. Obsolete route results are discarded on unmount/tank switch.

Focus/online/visibility recovery and a scoped same-page save event refresh saved
values without a new periodic settings poll. Unsaved edits survive these reads.
The Web does not create a feeding command, cron job, notification or activity
event when a schedule is opened/saved or when the selected time arrives.

Wall-clock settings use an HTML time input serialized as HH:MM. Display converts
the numeric hour/minute directly to 12-hour text, independent of browser zone:
19:00 always means 7:00 PM Philippine Time (UTC+8). Tank Details can show a nominal
next time using its existing trusted server clock and Asia/Manila date helpers.
It is labeled as a planned time, subject to actuator safety checks. Unsaved
default rows and unknown server time do not fabricate a next date. A confirmed
feed already recorded for the current Manila day moves the nominal next time
to the following day. Last feeding is shown only from an actually acknowledged
same-tank command, using its execution timestamp; it is explicitly limited to
the available command history, not an invented complete scheduled-feed ledger.

## Migration and exact schema/RPC contract

Apply only `supabase/migrations/20261018100000_tank_feeding_schedule.sql` after
review. Do not deploy unrelated pending migrations.

| Field | Type when newly added | Default | Valid values |
| --- | --- | --- | --- |
| auto_feeding_enabled | boolean | true | true/false |
| auto_feed_hour | smallint | 19 | 0–23 |
| auto_feed_minute | smallint | 0 | 0–59 |
| auto_feed_cycles | smallint | 2 | 1–3 |

Existing integer/smallint types are retained, not cast/restructured. Conditional
column additions support installations lacking the fields. Type/data preflight
aborts the transaction on incompatible or invalid existing values instead of
rewriting them. The feeding-only check constraint and defaults do not change
water/pump columns or backfill user actions. Existing table triggers remain.

New functions:

- `public.get_tank_feeding_schedule(p_tank_id uuid) returns jsonb`
- `public.save_tank_feeding_schedule(p_tank_id uuid, p_enabled boolean,
  p_hour integer, p_minute integer, p_cycles integer) returns jsonb`

Both are SECURITY INVOKER with explicit auth.uid()/tank ownership checks and
existing RLS active. Execute is granted only to authenticated; PUBLIC/anon get
no new function permission. Existing table grants, policies and device access
are not broadened, revoked or rewritten. No service-role key is used by Web.

Save locks the owned tank row, then updates an existing matching settings row
or inserts one with the verified actuator UID and existing water defaults.
It never assumes `ON CONFLICT(tank_id)` exists and never adds such a unique
constraint. Ambiguous duplicate rows abort. Existing per-tank water/stability
fields are not included in updates. A denied update cannot claim success.
Unknown existing RPCs are not overwritten by CREATE OR REPLACE.

## Required actuator integration — NOT implemented or flashed

Use the complete current sketch and its existing scheduling/feeding/logger
functions. Do not apply a made-up partial replacement to the water-only patch.

1. Extend the existing automation-settings model/parser with the four exact
   fields above. Load settings for the paired owner + tank + existing device
   association. Never use another owner's/tank's row or select an arbitrary
   duplicate. Replace the hardcoded authoritative hour with these saved fields;
   keep true/19/0/2 only as validated defaults for a genuinely absent setting.
   Preserve boolean false. Validate hours/minutes/cycles; invalid cycles use 2.
2. Refresh them at boot and the existing settings refresh interval. Transient
   network failures must not turn a last verified OFF into ON. Retain verified
   settings or defer execution when settings cannot be verified; do not
   silently activate defaults on an unverified cold-start network failure.
3. Use trusted device/server UTC converted to Manila UTC+8, not browser time.
   Let currentMinutes=hour*60+minute and targetMinutes=configuredHour*60+minute.
   For a five-minute window, accept elapsed=currentMinutes-targetMinutes in
   0–5. If targetMinutes+5 reaches 1440 and currentMinutes is after midnight,
   compare elapsed=currentMinutes+1440-targetMinutes and associate that slot
   with the PREVIOUS Manila calendar date. Other negative or >5 deltas are not
   eligible. Do not compare `minute <= configuredMinute + 5` by itself.
4. Keep a durable decided-slot identity (owner/tank, scheduled Manila date,
   configured HH:MM) and the existing successful-feed lock. Reboots, reconnects
   and subsequent loop iterations must not dispense the same slot again.
   Also check the existing actual Manila-day completed-feed state across both
   manual and scheduled paths. Only actual successful terminal feeding counts;
   pending/running/failed/rejected/blocked do not become completed feeds.
5. At the eligible slot, run the existing fresh sensor/ammonia/pH/turbidity/
   water-level checks and feed lock. Do not cache a Web "safe" badge as device
   authorization. If safe, call the existing feeder routine with auto_feed_cycles;
   servo angles, timing, pauses and GPIO13 remain device-controlled. GPIO32/33
   and every pump/interlock/reconnect rule remain untouched.
6. Use the existing result writer to record one meaningful scheduled decision:
   requested cycle count, intended Manila slot/date, actual UTC execution time,
   completed/failed/blocked/skipped outcome and reason. Reuse existing command/
   automation history, not a new table. `device_commands.command_value` can carry
   the cycle count; the existing reason/result text can carry the slot details
   if no structured metadata field is available. Verify actual logger columns
   and accepted action types before changing its writer. Link mirrored events
   using the existing command/auto-log IDs so Activity does not duplicate them.
7. Record/report execution success only after the existing feed routine returns
   successfully. Maintain a recognized execution acknowledgement, not a copied
   default `done`. The current Web recognizer accepts verified FEED_ONCE
   acknowledgements; unfamiliar scheduled auto outcomes remain Unconfirmed
   until their actual writer/evidence contract is inspected. Do not globally
   loosen acknowledgement checks to make an unverified schedule look complete.
8. Deduplicate a blocked decision/notification per slot. A blocked slot is not
   a successful feeding. If the current firmware intentionally retries, use
   bounded retries and emit a new event only on a meaningful outcome change,
   not every settings/sensor poll.

Required physical tests after firmware integration: browser closed/logged out;
each cycle count; saved OFF; manual feed already completed today; all existing
unsafe/missing-sensor rejections; reboot/reconnect; a normal 20:30–20:35 window;
and 23:58–00:03 rollover with the previous slot-date identity. These are pending,
not represented by the mocked Web tests as successful hardware tests.

## Files changed

- `src/components/AutomaticFeedingSettings.jsx` (new)
- `src/components/ManualFeedOptions.jsx` (extract/reuse the existing selector)
- `src/pages/admin/SettingsPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/services/feedingScheduleService.js` (new)
- `src/styles/automaticFeeding.css` (new)
- `supabase/functions/_shared/feedingSchedule.js` (new)
- `supabase/migrations/20261018100000_tank_feeding_schedule.sql` (new)
- `tests/feeding-schedule.test.mjs` (new)
- `tests/browser/feeding-schedule.spec.mjs` (new)
- `tests/browser/manual-feeding.spec.mjs` (scope manual radio locators)
- `tests/browser/fixtures.mjs` (mock the scoped schedule RPCs)
- `tests/browser/tank-activity.spec.mjs` (wait for expected failure responses
  before clearing their mock flag; avoid a late-console-event race)
- `docs/AUTOMATIC_FEEDING_SCHEDULE.md` (this report)

## Validation and remaining steps

Production build and bundled credential scan pass; the existing >500kB bundle
warning remains (~669kB JS). Full Node suite: 215 passed, one retired check
skipped. Six schedule checks include executable PostgreSQL migration/RLS tests
with PGlite, invalid input, missing/existing columns, duplicate rows, denied
ownership, no unique tank constraint and preserved water values. New helpers,
component and changed tests pass targeted lint. Full-project ESLint remains the
existing 22 errors and 3 warnings. All 69 distinct browser checks passed across
the final runs, including the corrected expected-error timing check. They use isolated fake services;
they verify settings, manual feeding, date zones, layouts and preserved controls,
not physical execution. No production settings were saved.

Next manual steps: review/apply the single migration; verify its two functions,
grants and the real authenticated per-tank Save; merge the firmware changes into
the actual sketch, flash and run the physical tests above. Scheduled feeding can
operate with the browser closed only when that device integration is present.
No Git push or deployment has been performed for this task.

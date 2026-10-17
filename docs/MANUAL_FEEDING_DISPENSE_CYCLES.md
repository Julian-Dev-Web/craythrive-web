# Manual feeder dispense cycles — Web

2026-10-17. Existing React/Vite application extended; no new application,
database migration, firmware edit, production command, push or deployment.

## Inspected flow and findings

- `src/pages/admin/TankDetailsPage.jsx`: Feed Now, `sendDeviceCommand`, inline
  `device_commands.insert`, actuator lookup, active-command polling, daily feed
  reads, status summary, five-minute action wait, and troubleshooting controls.
- `src/services/tankActivityService.js`: authenticated owner/tank-scoped history
  reads and optional automation-history RPC. No separate command insertion
  service exists; the page's existing insertion path was reused.
- `supabase/functions/_shared/tankActivity.js`: acknowledgement-based execution
  outcomes, raw automation/mirrored-command handling and historical evidence.
- `src/components/TankActivityHistory.jsx`, `src/styles/tankActivity.css` and
  `src/styles/tanks.css`: Activity presentation and existing control design.
- `src/services/serverTimeService.js`, `src/hooks/useServerTime.js`, and existing
  Philippine-time helpers: trusted clock and Manila daily boundaries.
- Existing command/Activity, Manila-time, pump-wording and water-health browser
  tests, their fake Supabase fixture, and `tests/tank-activity.test.mjs`.
- `src/constants/schema.js`, existing Activity audit/review SQL and the available
  actuator patch artifact. A complete current actuator sketch is not present.

The old Feed Now click invoked `sendDeviceCommand("FEED_ONCE", 500)` in
TankDetailsPage. Its command-value map wrote `"once"`, regardless of desired
dispensing amount. The page already polled device commands (1.5 seconds during
active work, 8 seconds idle), so no new subscription or polling timer was added.

The existing daily policy is a warning with an explicit "Feed again anyway?"
override and an Advanced "Reset Feed Test Today" operation. It is not a strict
server-enforced once-per-day lock. Those operations were not removed or loosened
as part of this cycle-selection change. The normal daily query still uses the
existing server-derived Asia/Manila `created_at` interval; it now counts only
`done` rows with the existing verified execution acknowledgement. Pending,
running, failed, blocked/rejected and unacknowledged default-done rows do not
establish a successfully completed feed.

## Data flow

1. The existing Controls tab renders compact Feed Amount radio choices:
   1 Cycle / Light, 2 Cycles / Normal / Recommended, 3 Cycles / More. Default is 2
   for a newly selected tank. Native radio inputs and focus styles support
   keyboard use. Narrow screens stack the choices without horizontal overflow.
2. Feed Now opens a native modal with the selected amount and number of
   dispensing movements. Cancel/Escape send nothing. No weight, hopper level or
   food-presence claim is made. The control shows the operator precondition:
   "Check that the feeder contains enough feed before dispensing."
3. On confirmation the existing send path normalizes the requested cycles again.
   Only integer 1/2/3 and their exact text representations are accepted; invalid
   values fall back to 2. The rendered selector and confirmation also normalize
   their input. Historical missing/legacy values use a separate nullable reader;
   history never invents a two-cycle count for old `"once"`/`"auto"` rows.
4. Existing connection, trusted-time, active-action and post-action wait checks
   remain. Feed adds a fresh read of the existing actuator lookup and rejects
   sensor hubs, unclaimed devices, other owners and another tank's actuator,
   including the legacy lookup's fallback-to-an-owner-device case. An explicit
   tank actuator UID is accepted before `iot_devices.tank_id` is populated, but
   cannot override a nonempty conflicting tank association.
5. Existing active-command and daily-feed helpers are reused in strict read
   mode immediately before insertion. Failed verification blocks insertion.
   A newly discovered pending action blocks insertion. A verified successful
   feed today retains the existing separate explicit daily override warning.
   Route/account scope changes invalidate a preflight still in progress.
6. The same `device_commands` insert now sends, for example:

   ```json
   {
     "command_type": "FEED_ONCE",
     "command_value": 3,
     "duration_ms": 0,
     "command_status": "pending"
   }
   ```

   Existing `user_id`, `tank_id`, `device_uid` and `result_message` fields remain.
   As before, event timestamps are database-generated rather than client clock
   fields. Pump command values/durations and emergency-stop payloads are unchanged.
   A feed insert returns its saved row through `.select('*').single()` using the
   same authenticated client and existing read permissions; no privileged key or
   new endpoint is introduced.
7. The saved row immediately establishes "Feeding request sent" and the requested
   amount. A synchronous submission lock prevents double-confirmation inserts.
   The local pending row keeps the control locked even if a follow-up read fails;
   an already-pending command loaded after refresh also disables feeding and
   shows its recorded amount. Cycle selection is disabled during active work.
8. Actuator ESP32 reads the row and applies its existing safety authority. The
   existing page polling observes `running`, then `done`/`rejected`/`failed`.
   Only the existing verified `FEED_ONCE completed.` acknowledgement with an
   execution timestamp and terminal success produces "Feeding completed — N
   dispense cycles." A bare/default `done` stays Unconfirmed. Rejected feeding
   is labeled Rejected with the device's reason; failed feeding is labeled Failed.
   Successful command execution is not a measurement of physical feed delivery.
9. Controls, Latest Action and Activity reuse the same feeding presentation helper.
   Activity displays `Dispense cycles: N` from `command_value` (or an explicitly
   saved cycle metadata field where available), including scheduled history when
   its saved source includes a count. Old missing counts display "Not recorded".
   No historical command/status/metadata is rewritten.

## Exact modified files

- `src/pages/admin/TankDetailsPage.jsx`
- `src/components/ManualFeedOptions.jsx` (new)
- `src/components/TankActivityHistory.jsx`
- `src/styles/manualFeeding.css` (new)
- `src/styles/tankActivity.css`
- `supabase/functions/_shared/feederControl.js` (new portable helper, used by Web)
- `supabase/functions/_shared/tankActivity.js`
- `tests/feeder-control.test.mjs` (new)
- `tests/browser/manual-feeding.spec.mjs` (new)
- `tests/browser/philippine-time.spec.mjs` (accept the new confirmation)
- `docs/MANUAL_FEEDING_DISPENSE_CYCLES.md` (this report)

No pump formulas/interlocks, sensor normalization, thresholds, authentication,
marketplace, mobile source, SQL/RLS, hardware calibration, GPIO assignments or
firmware was edited. The actuator remains responsible for servo angle, timing,
pauses, execution and safety rejection. The Web adds no alternate execution path.

## Verification

- Production build and bundled credential scan: passed, zero scan findings.
- Full Node suite: 209 passed, one retired check skipped, zero failures.
- Final combined browser run: 57 passed, including 15 manual-feeding cases,
  existing Manila-time guards, pump wording, Activity refresh/history, sensor
  health and two-decimal water depth/export regressions. Tests use isolated fake
  Supabase/device replies; no real feeder or production database was operated.
- Targeted lint for new helpers/components and changed history/tests: passed.
  Full-project ESLint remains 22 existing errors and 3 warnings; Tank Details
  retains its four existing `set-state-in-effect` diagnostics. No new lint errors.
- Existing >500kB bundle warning remains (~660kB JavaScript). Diff whitespace
  check passes; Windows LF/CRLF notices are harmless.

## Remaining firmware/backend considerations

The user confirms deployed firmware supports 1–3 `FEED_ONCE.command_value`
cycles; Web-to-real-hardware validation remains pending. If the deployed firmware
uses a different completion message, its exact acknowledgement must be verified
before extending the existing recognizer; this task does not turn any `done`
string into assumed success. No firmware update is required by the Web payload
contract provided in the request.

The existing frontend does not itself make parameter-by-parameter feeding safety
decisions; the actuator/backend remains the final safety authority. Existing
frontend action guards are preserved, and safety rejection is never shown as
success. A strict once-per-day cap or a fully atomic duplicate exclusion across
simultaneous browsers would need a verified backend/device rule. This change
prevents repeated clicks in this page and rechecks already-saved pending work;
it does not claim cross-client atomicity or alter backend policy.

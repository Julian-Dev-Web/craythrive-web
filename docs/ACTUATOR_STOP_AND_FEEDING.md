# Emergency Stop, remote feed-lock reset, and scheduled feeding history

Implementation date: 2026-10-19. Git publication does not apply the remote
migrations or upload firmware. No remote migration, firmware upload, or
physical actuator test was performed for this work.

## Release status - firmware follow-up is still pending

The Web and SQL implementations are locally tested. The actuator sketch in
Downloads received the base Stop/RESET_FEED_LOCK changes and explicit schedule
origin metadata. The final safety refinement is prepared as
`firmware/patches/CrayThrive_Actuator_v1_29_0_stop_safety_followup.patch` but has
NOT been applied to that external sketch or compiled. Repeated automatic
approval-review failures reported "Selected model is at capacity"; these were
review-service failures, not a finding that the requested edits were unsafe.

Do not upload the current Downloads sketch as the final release. Apply the
follow-up, copy the updated `EmergencyStopGuard.h`, compile, and perform the
bench tests below first. The existing running ESP32 was never flashed here.

One intermediate actual ESP32 compile passed, using esp32:esp32:esp32, ESP32
core 3.3.12, and ESP32Servo 3.2.1: 1,229,215 bytes of flash (93%) and 50,484 bytes
of globals (15%). That was BEFORE the last schedule-origin payload addition
and the unapplied safety refinement. It is not verification of the final
firmware patch set. A new compile is required.

## Findings from the real code and saved schema audit

- `TankDetailsPage.jsx` sends actuator requests to `public.device_commands`.
  The existing stop is **STOP_ALL**. Normal actions are FEED_ONCE, REFILL_FOR
  and DRAIN_FOR, with older REFILL_ON/DRAIN_ON aliases in the firmware.
- Active UI state was maintained separately from the returned command row;
  submitted feed snapshots could survive a rejection. Existing command
  refreshes also reloaded unrelated Tank Details data. Stop could share the
  normal submission lock, and the old recovery button wrote synthetic failed
  outcomes. The old test-reset button rewrote successful feeding history.
- Firmware `fetchAndRunPendingCommand()` originally fetched the oldest pending
  command without Stop priority. Feeding used blocking servo delays without
  stop checks; manual success followed the sequence unconditionally. Pump
  loops intentionally avoided HTTP while energized. That existing pump
  safety constraint is preserved.
- The original Stop only turned outputs off. It did not persist a latch. No
  explicit cloud Resume lifecycle existed.
- Activity already reads all owned tank device_commands, control_logs,
  tank_automation_logs, alerts and ammonia_readings. There was NO manual-only
  filter to remove. Source-less scheduled FEED_ONCE rows with numeric cycles
  could not reliably be identified as scheduled; timestamps used creation
  instead of the available completion time. Existing related alert/control
  events are deduplicated against the canonical command row.
- The saved Supabase schema audit has command_type TEXT and no origin/metadata
  field on device_commands. Its command-alert trigger is AFTER UPDATE OF
  command_status only. Firmware inserts completed automatic feeding history
  directly, so this path never fired that trigger. No live schema connection
  was available in this session. CHECK constraints require the supplied live
  preflight; none are removed or guessed.
- Scheduled safety skips in the inspected firmware are Serial messages, not
  persisted attempts. No new skip-logging persistence mechanism was added.
  Genuine saved rejected/failed/skipped records remain visible and never
  become completed notifications.

## Commands and authoritative lifecycle

`device_commands.command_status ?? status ?? result` supplies command status.
Automation history continues using `action_status` first.

| Saved state | Presentation | Active |
| --- | --- | --- |
| pending | Pending Verification | yes |
| running / processing | In Progress | yes |
| done / completed | Completed | no |
| rejected | Rejected | no |
| failed | Failed | no |
| cancelled / canceled | Cancelled | no |

The actual device/database uses running and done. Cancellation uses its
existing supported rejected state with "Cancelled because Emergency Stop was
activated." No new command_status enum/check values are required.

- STOP_ALL immediately locks the Web's normal controls, uses a separate
  submission guard, and remains callable during a normal in-flight request.
  The backend serializes enqueues per tank, latches the existing settings row,
  cancels queued normal actions, and returns one idempotent stop request.
- Running normal commands are NOT fabricated as done or failed by the Web.
  The firmware must abort them and persist their real interrupted result.
- Stop DONE requires outputs off first, and its exact acknowledgement is
  `Emergency stop applied. Pumps and feeder are stopped.` The cloud latch
  stays active after DONE, timeout, refresh and browser close.
- RESUME_CONTROLS is an explicit command, accepted only after confirmed Stop
  and no active normal command. Only its matching actuator acknowledgement
  unlatches cloud state. Firmware NVS also preserves the latch over reboot.
  The pending safety refinement additionally serializes local X with Resume
  and prevents Resume while an older automatic/interlock routine is unwinding.
- RESET_FEED_LOCK is ordinary queued maintenance: pending -> running ->
  done/failed/rejected. It calls the same clearLastFeedLock() helper as Serial
  C. Only the actuator's `actuator/last_feed` key is cleared. Opening NVS must
  succeed, and the key must actually be absent before done. Already absent is
  idempotent success. No servo, pump, WiFi, pairing, tank assignment, schedule
  update, history deletion or successful-feed rewrite occurs.
- FEED_ONCE still rejects getLastFeedDate()==today and still performs its
  existing sensor checks. A successful new sequence saves today again.
  RESET_FEED_LOCK does not count as a feed. Web daily-feed warnings preserve
  the real earlier feeding records, so another explicit extra-feed warning
  may still appear after a test reset.
- Stop/Resume and reset requests without an acknowledgement expire after
  120 seconds when the authenticated control-state RPC reconciles them.
  Failure is persisted without inventing executed_at. Stop remains latched;
  an offline actuator must reconnect and confirm a retried Stop before Resume.
  No client timer pretends that hardware completed an action.
- Only active commands trigger the 1.5-second control poll. It reads bounded,
  owner/tank/device-scoped command snapshots, including terminal cancellations.
  Terminal snapshots remove pending local state and stop command polling.
  No command lifecycle refresh reloads sensors, AI, or the whole page. Settings
  maintenance uses the same service/command architecture.

## Database changes and exact SQL

Run the read-only inspection first:
`docs/sql/20261019_actuator_controls_preflight.sql`.

The exact migrations to review/run in order, individually, are:

1. `supabase/migrations/20261019140000_latched_emergency_stop.sql`
2. `supabase/migrations/20261019150000_scheduled_feeding_activity_alerts.sql`

Do NOT run a broad db push that would deploy unrelated pending migrations.
Neither migration has been applied remotely here.

The first extends the existing unique tank_id settings row with:

- emergency_stop_active BOOLEAN NOT NULL DEFAULT false
- emergency_stop_command_id UUID
- emergency_stop_applied_at TIMESTAMPTZ
- emergency_resume_command_id UUID
- emergency_stop_generation BIGINT NOT NULL DEFAULT 0

Its authenticated RPC signatures are:

```sql
public.get_tank_actuator_control_state(
  p_tank_id uuid, p_device_uid text, p_command_id uuid DEFAULT NULL
) RETURNS jsonb
public.request_tank_emergency_control(
  p_tank_id uuid, p_device_uid text, p_action text
) RETURNS jsonb
```

They validate auth.uid(), tank ownership and the claimed paired actuator.
Internal functions are revoked from PUBLIC/anon/authenticated. No anonymous
RPC grant or table/RLS policy change is introduced. Table triggers enforce
queue/latch rules even for clients inserting directly, protect emergency
settings from client writes/deletion, and process exact current Stop/Resume
acknowledgements. Existing water/feeding settings writes remain valid. Existing automation rows
are preserved. If Stop must create the first settings row, feeding is explicitly
OFF (avoiding a new default scheduled feed); other missing fields use their
existing database defaults. Review that first-time water configuration before
resuming controls.

The second adds nullable `device_commands.command_source TEXT` with allowed
non-null values manual, schedule, automation and system. Null keeps old clients
and historical rows valid. It extends the EXISTING
`create_actuator_alert_from_command()` function/trigger to INSERT and relevant
UPDATE events, preserving pump and other command alert branches. A scheduled
completed FEED_ONCE creates one existing alerts row, keyed by command_id, with
real cycles, execution timestamp and Asia/Manila text. A partial unique index
for scheduled-source alerts plus the existing command-id check prevents
repeated/reopened client activity from creating more alerts. The existing
alert-to-mobile-push mechanism remains in place.

Both migrations stop if a command_type CHECK constraint needs review. The
second also stops if another existing origin/metadata field is discovered or
the audited command-alert function changed (expected revision
41b0c2a1915b0972c55bbdc87b8b1c40). This protects newer production logic rather
than overwriting it blindly. Review a preflight failure before proceeding.
No standalone RESET_FEED_LOCK table or unnecessary command-type migration is
introduced. Existing RLS, privileges, legacy thresholds and sensor rows are
not rewritten.

These changes preserve the project's EXISTING device-writer authentication
model. The stored done field/result contract is not cryptographic proof of
physical delivery or device identity. No new anonymous writer privileges or
client service-role credentials are introduced.

Historical source-less feeds are NOT guessed from human result text. For a
specific historical row whose scheduled origin has been independently
verified, an administrator may explicitly set its metadata; the extended
trigger then creates the missing notification once. Use the actual row ID:

```sql
UPDATE public.device_commands
SET command_source = 'schedule'
WHERE id = 'PASTE_VERIFIED_COMMAND_UUID'::uuid
  AND command_type = 'FEED_ONCE'
  AND command_status = 'done'
  AND command_source IS NULL;
```

Do not run this for unverified rows or as a bulk text-matching backfill. No
such historical update was executed here.

## Firmware artifacts and application

The inspected/partly edited actual sketch is:

`C:/Users/AMD/Downloads/CrayThrive_Actuator_v1_29_0_DB_FEED_SCHEDULE_SERVO_STATUS_FIX/CrayThrive_Actuator_v1_29_0_DB_FEED_SCHEDULE_SERVO_STATUS_FIX.ino`

The new attachment contained instructions naming a `(1).ino`; that actual
file was not present in the attachment folder. The available current v1.29
sketch has the described Serial C implementation and was used. Its private
network configuration was kept out of the repository.

Artifacts:

- `firmware/patches/CrayThrive_Actuator_v1_29_0_emergency_stop.patch`: base diff
  against original v1.29. These changes ARE already in the Downloads sketch,
  including the final schedule-origin payload line. Do not apply twice.
- `firmware/patches/CrayThrive_Actuator_v1_29_0_stop_safety_followup.patch`:
  additional safety refinement, NOT applied to Downloads because approval
  review could not complete. It must be applied before release.
- `firmware/EmergencyStopGuard.h`: final header, including atomic stop/token
  state and main-routine scope guard. Copy this version beside the final ino;
  the copy currently in Downloads predates the final routine-scope guard.

To finish manually in PowerShell, using the actual sketch folder above:

```powershell
Set-Location -LiteralPath 'C:\Users\AMD\Downloads\CrayThrive_Actuator_v1_29_0_DB_FEED_SCHEDULE_SERVO_STATUS_FIX'
git apply --check 'C:\Users\AMD\craythrive-web-dashboard\firmware\patches\CrayThrive_Actuator_v1_29_0_stop_safety_followup.patch'
git apply 'C:\Users\AMD\craythrive-web-dashboard\firmware\patches\CrayThrive_Actuator_v1_29_0_stop_safety_followup.patch'
Copy-Item -LiteralPath 'C:\Users\AMD\craythrive-web-dashboard\firmware\EmergencyStopGuard.h' -Destination '.\EmergencyStopGuard.h'
```

Compile in Arduino IDE using the actual installed ESP32 board configuration.
Do not upload if compilation fails. Upload only after both related migrations
are applied and the final firmware compiles. The new firmware reads emergency
columns; a missing migration fails closed and blocks normal outputs.

Current applied sketch locations (follow-up shifts line numbers):

| Function | Current line | Change |
| --- | --- | --- |
| checkLocalEmergencyStop | 950 | Local X is checked between action steps |
| latchEmergencyStop / finishConfirmedResume | 978 / 991 | Persistent off/resume state; follow-up serializes races |
| updateCommandStatusScoped | 1673 | Scope + active-state conditional claim/ack; verifies returned row |
| emergencyMonitorTask | 2681 | Independent Stop/Resume polling, no HTTP in energized pump loops |
| feedCycles | 2761 | Original angles/timings/cycles with interruptible waits and truthful bool result |
| runDrainFor / runRefillFor | 2805 / 2896 | Frequent stop flag checks; existing pulse limits/interlocks retained |
| executeCommand | 4863 | STOP_ALL, RESET_FEED_LOCK and conditional normal claim/completion |
| fetchAndRunPendingCommand | 4969 | Normal FIFO excludes Stop/Resume; independent monitor prioritizes Stop |
| handleSerialHardwareTests | 5241 | Shared C reset; X reaches busy loops; follow-up adds serial coordination |
| insertAutomaticFeedHistory | 5320 | Same existing single history insert plus command_source=schedule |
| clearLastFeedLock | 5379 | Shared C/remote NVS helper |
| handleAutoFeeding | 5401 | Existing schedule/day/sensor rules; abort does not save a successful feed |
| setup | 5497 | Restore emergency NVS, initialize stop monitor and fail closed on setup failure |

The scheduler's configured clock time, recovery window, cycle count, servo
angles and normal daily/sensor checks were not redefined. The Stop task adds
interruption; the scheduled-history task adds source metadata only. Relays and
servo writes obey the off latch. Network failures cannot extend an energized
pump pulse: its own loop remains bounded and network-free.

## UI locations and modified files

Settings for the selected tank: Automatic Feeding followed by Feeding Test,
with confirmation and the one-shot Allow Another Feed Test Today button.
Tank Details -> Controls -> Advanced / Troubleshooting also provides the
existing maintenance entry using the same reset service. No permanent test
mode toggle exists. Emergency Stop and explicit Resume are in Controls.

Web/shared files:

- src/pages/admin/TankDetailsPage.jsx
- src/pages/admin/SettingsPage.jsx
- src/components/FeedingTestSettings.jsx
- src/components/TankActivityHistory.jsx
- src/services/actuatorControlService.js
- src/services/feedTestService.js
- supabase/functions/_shared/actuatorCommandLifecycle.js
- supabase/functions/_shared/actionStatus.js
- supabase/functions/_shared/feederControl.js
- supabase/functions/_shared/tankActivity.js

Also changed/added: the two migrations, three firmware artifacts above, this
guide, the read-only preflight SQL, tests/browser/fixtures.mjs,
tests/browser/manual-feeding.spec.mjs, tests/browser/emergency-stop.spec.mjs,
tests/browser/scheduled-feeding.spec.mjs, tests/emergency-stop-sql.test.mjs,
tests/scheduled-feeding-sql.test.mjs and
tests/actuator-command-lifecycle.test.mjs. No accessible mobile source was
changed. Both clients consume the same persistent command/alert data; older
mobile builds need their own presentation update to show structured origins.

## Required live/physical acceptance tests

The automated browser tests simulate actuator acknowledgements; they do not
prove physical pump shutoff or servo motion. With final firmware compiled and
uploaded, use the actual paired tank and observe the hardware:

1. Feed once successfully. A subsequent ordinary Feed Now must be rejected
   "tank was already fed today", show the real reason, and leave no active
   banner/spinner. Failed/rejected rows must not count as fed.
2. In Settings, cancel the feed-test confirmation: no command. Confirm it:
   exactly one RESET_FEED_LOCK, no servo movement, pending/running then actual
   done, history intact. Feed Now must still check all sensors and save the
   date after success. Serial C must still work. Use the test reset outside
   the automatic feeding recovery window: Serial C and remote reset clear
   the SAME lock used by the existing scheduler; the schedule stays enabled.
3. Queue a feed then Stop: feed is rejected/cancelled and cannot run later.
   Stop itself stays pending until the actuator turns outputs off and acks.
   Double Stop clicks must not create duplicates.
4. While filling, press Stop and physically verify fill OFF. Repeat while
   draining and feeding. Further servo cycles must stop. Interrupted action
   must fail, not report done. Test local Serial X while each watched action
   is busy; the final follow-up must be present.
5. With the actuator offline but Supabase reachable, Stop should fail after
   120 seconds, remain latched and stop spinning. No executed_at/success is
   fabricated. Reconnect, retry Stop, confirm actual off, then Resume.
6. Reload/reopen after Stop completed: controls remain locked. Explicit
   Resume must complete while outputs stay OFF. Start a NEW action only after
   that. Race another Stop against Resume; newest Stop must win. Attempt a
   direct normal insert while latched: backend must reject it.
7. Choose a scheduled time a few minutes ahead without changing safety limits.
   Close the website. After the real sequence, verify ONE FEED_ONCE done row,
   command_source=schedule and the actual cycles/executed_at; ONE existing
   alerts row with title Automatic Feeding Completed and matching command_id.
   Reopen: one Activity event titled Automatic Feeding, correct cycles,
   Automatic schedule source and Manila time. Refresh/reopen on both clients:
   no extra command or alert. Verify manual Feed Now is source=manual instead.
8. A safety-blocked scheduled feed must not create a completed row or success
   notification. If it has only Serial output in current firmware, report
   that missing skip-history evidence honestly.

Live Supabase application, final firmware compilation/upload, and all physical
acceptance steps above remain pending. Do not equate local builds/tests with a
successful production or hardware verification.

## Local validation results

- `npm run build`: passed; bundled security scan reports no findings. Existing
  chunk-size warning remains (main JavaScript about 685 kB, limit 500 kB).
- `npm test`: 247 tests, 246 passed, 1 existing skip, 0 failures.
- Targeted Playwright suite: 53 passed (Emergency Stop/reset, manual feeding,
  feeding schedules, scheduled Activity/Alerts and existing Activity behavior).
- SQL fixtures exercise both migrations together, owner/pair validation,
  persistent latch, queued cancellation, interrupted running actions,
  Stop/Resume acknowledgement rules, timeouts, settings preservation,
  maintenance history preservation, completed INSERT notifications and
  repeated-update notification deduplication. These are local PGlite tests,
  not live Supabase/RLS or physical-device verification.
- Full ESLint: 18 existing errors and 3 existing warnings in untouched files.
  The changed Web/shared files pass the targeted ESLint check.
- `git diff --check`: passed. LF/CRLF conversion notices are not build errors.
- Read-only `git apply --check` confirmed that the pending firmware follow-up
  fits the current external sketch, and reverse-check confirmed the base
  patch is already applied. Neither check applied or uploaded the follow-up.

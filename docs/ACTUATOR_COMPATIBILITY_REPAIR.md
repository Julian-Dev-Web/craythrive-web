# Actuator command submission compatibility repair — 2026-10-19

The supplied production diagnostic confirms the emergency-control RPCs and
queue/acknowledgement triggers already exist, but `device_commands.command_source`
does not. The Web sender unconditionally included that optional metadata field.
PostgREST rejected Feed, Drain, Add Water and feed-test-reset requests before the
actuator could receive them. This was a Web/schema rollout regression.

The scheduled-alert migration had stopped before adding the column because its
function-revision guard supported only the later pump-wording revision. The actual
production command-alert function, supplied for review, matches the existing local
fixture at revision `64cff69aa4deda3bd7afd5d73c7c7860`. The repaired guard accepts
that reviewed revision and `41b0c2a1915b0972c55bbdc87b8b1c40`. Unknown definitions
still stop deployment. Do not replace the guard with a wildcard.

## Repair for the currently deployed Web

Run **only**
`supabase/migrations/20261019160000_actuator_command_source_compatibility.sql`
in the intended Supabase SQL Editor. It is a repeatable, additive transaction:

```sql
BEGIN;
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS command_source text;
NOTIFY pgrst, 'reload schema';
COMMIT;
```

It does not enqueue a command, clear an emergency latch, modify RLS, replace alert
functions, change thresholds/schedules, or alter execution history. It fixes the
missing metadata column for the already-deployed Web. An independent permission,
pairing, emergency-stop or sensor-safety rejection must still be resolved normally.

For scheduled-feed notifications, the separately reviewed and repaired
`20261019150000_scheduled_feeding_activity_alerts.sql` may follow. The compatibility
repair can precede it because both use `ADD COLUMN IF NOT EXISTS`. Fresh installs
can still apply them chronologically. Do not rerun the already-installed emergency
migration or broadly deploy unrelated pending migrations. Neither SQL file has
been deployed remotely by this repair session.

## Web sender changes

`src/services/actuatorCommandService.js` now performs a scoped, zero-row SELECT to
check optional metadata support **before** making one command INSERT. It omits
only `command_source` on an explicit missing-column response (`42703`/`PGRST204`
that names that column). Auth/RLS, network, other schema and safety errors fail
without a fallback INSERT. There is no capability cache to survive schema updates.

The sender never retries a failed or uncertain INSERT. Its bounded timeout and
scope validation cannot manufacture a completion. Payload scope, cycles, pulse
duration, statuses and existing safety gates remain intact. Stop and Resume still
use the existing verified emergency RPC flow; this optional-metadata path cannot
unlock them. Settings reset uses the same sender and preserves completed history.

## Rule-based behavior and actual firmware limitation

No firmware, calibration, threshold evaluation, automatic schedule, pump pulse,
feeding decision or servo timing was modified in this repair. The supplied sketch
still contains `canFeedNow`, `canDrainNow`, `canRefillNow`, daily feed-lock checks
and the scheduler's sensor checks.

However, this supplied sketch does **not** implement `RESUME_CONTROLS`, the new
persistent Stop latch/independent emergency monitor, or the database's exact Stop
acknowledgement contract. Its older `STOP_ALL` acknowledgement cannot complete the
new emergency lifecycle. The presence of rule functions does not prove successful
physical operation or full emergency compatibility. Do not force-clear database
latches or pretend the device has acknowledged Stop/Resume. Final firmware
integration, compilation, upload and observed hardware acceptance remain separate
pending work. Earlier prepared patches target a different sketch state and must
be reviewed against this latest supplied version before application.

## Validation

Regression coverage exercises actual missing-column responses in the browser,
Feed/Add Water/Drain/reset single inserts, preserved payloads and successful
history, metadata adoption after installation, unstable-water and emergency
locks, no INSERT retries after ambiguous failures, and late timeout responses.
Local PostgreSQL-compatible PGlite tests verify both known function revisions,
unknown-revision rejection, additive repair repeatability, unchanged safety
settings, legacy command inserts and deduplicated scheduled completion alerts.

These are local tests and simulated actuator acknowledgements, not authenticated
remote Supabase or physical device tests. No automatic hardware request was sent.

Results for this repair:

- `npm run build`: passed, including the bundled security scan (no findings).
  Existing bundle-size warning remains (main JavaScript approximately 687 kB).
- `npm test`: 274 total, 273 passed, 1 existing skip, no failures.
- Targeted Playwright compatibility, emergency, manual-feed, feeding-schedule and
  scheduled-history suite: 46 passed.
- ESLint on every changed JavaScript/JSX/test file: passed. Full-repository ESLint
  still reports 18 errors and 3 warnings in untouched files.
- `git diff --check`: passed.

## Changed files

Application:
`src/services/actuatorCommandService.js`, `src/services/feedTestService.js`,
`src/components/FeedingTestSettings.jsx`, `src/pages/admin/TankDetailsPage.jsx`.

SQL:
`supabase/migrations/20261019150000_scheduled_feeding_activity_alerts.sql`,
`supabase/migrations/20261019160000_actuator_command_source_compatibility.sql`,
`docs/sql/20261019_actuator_alert_function_review.sql` (read-only diagnostic).

Tests:
`tests/actuator-command-service.test.mjs`,
`tests/actuator-compatibility-sql.test.mjs`,
`tests/browser/actuator-compatibility.spec.mjs`, `tests/browser/fixtures.mjs`.

Documentation: this file and `docs/ACTUATOR_STOP_AND_FEEDING.md`.

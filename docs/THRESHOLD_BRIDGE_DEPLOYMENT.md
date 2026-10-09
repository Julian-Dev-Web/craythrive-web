# Per-tank threshold compatibility bridge deployment

Date: October 10, 2026 (Asia/Manila).
Project: `abtzkqfrwzcocyrwcrfc`.

## Deployed migration

[`20261010120000_threshold_compatibility_bridge.sql`](../supabase/migrations/20261010120000_threshold_compatibility_bridge.sql)
was applied to the linked remote project using only this command:

```powershell
& 'C:/Users/AMD/AppData/Local/npm-cache/_npx/b96a6bd565c470ce/node_modules/@supabase/cli-windows-x64/bin/supabase.exe' db query --linked --project-ref abtzkqfrwzcocyrwcrfc --file supabase/migrations/20261010120000_threshold_compatibility_bridge.sql --output json
```

The first remote grant inspection found Supabase's explicit default `anon`
EXECUTE permission, despite revoking PUBLIC. A focused follow-up transaction
removed `anon` EXECUTE from Apply and removed direct caller EXECUTE from the
trigger function, then notified PostgREST to reload its schema. The checked-in
migration includes those corrected revocations. Both callable RPCs were then
verified as executable by `authenticated` and not by `anon`.

The retired, unapplied same-table candidate is archived under
`docs/sql/20261009180000_per_tank_thresholds.sql`; it is outside automatic
migrations and was not deployed. No unrelated migration was applied. The remote
project had no Supabase migration-history table; deployment was verified from
actual database catalogs, privileges, policies and data rather than a history
entry. Do not blindly run all historical migrations against this project.

## Remote tables and functions

Created table: **`public.tank_threshold_settings`**.

- UUID primary key and owner UUID referencing `auth.users(id)`.
- Tank UUID referencing `tanks(id)`, required for an override.
- `UNIQUE(user_id,tank_id)` and ownership-enforced RLS.
- Existing seven operational values as JSON plus matching numeric columns.
- Pending AI recommendation metadata and creation/update timestamps.

Created functions:

| Function | Purpose |
| --- | --- |
| `public.apply_tank_thresholds(uuid,jsonb,text,text)` | Atomic selected-tank or Apply All write |
| `public.get_tank_threshold_settings()` | Caller-owned overrides plus logical legacy fallback |
| `public.craythrive_threshold_values(jsonb)` | Existing normalization/default rules |
| `public.craythrive_ai_threshold_patch(jsonb)` | Supported recommendation whitelist |
| `public.craythrive_audit_threshold_change()` | Trigger recording actual authenticated value changes |

Exact Apply signature:

```sql
public.apply_tank_thresholds(
  p_tank_id uuid,
  p_patch jsonb,
  p_scope text DEFAULT 'single_tank',
  p_source text DEFAULT 'manual'
) RETURNS jsonb
```

This matches Web's `rpc()` name, parameter names and argument types. Apply and
read use SECURITY INVOKER, caller `auth.uid()` and existing ownership/RLS.
Apply accepts no caller-supplied actor UUID. Both RPCs have explicit
authenticated EXECUTE; anon EXECUTE is revoked. The audit trigger uses SECURITY
DEFINER only to create protected activity, with fixed schema references and
ownership validation. Its direct caller EXECUTE is revoked.

`control_logs.metadata` was added for activity details, and the existing table
receives a `threshold_updated` entry only when an authenticated effective value
actually changes. No actuator command is created.

## Legacy preservation

**The existing `public.threshold_settings` table is unchanged.** No column,
constraint, policy, trigger, row ID, value or timestamp was altered by migration.
Its original `UNIQUE(user_id)` remains intact. Remote before/after comparisons
verified the complete schema/constraint/policy definitions and a fingerprint of
all original rows; both legacy rows were identical immediately after deployment.

There is no new physical `tank_id` column on the legacy table. The new read RPC
projects `tank_id: null` onto legacy results solely to provide a common logical
row shape for Web. Old clients still receive the exact original table shape.

No data was cloned/backfilled. Immediately after migration, the override table
contained **zero rows** and threshold activity contained **zero rows**.

Effective resolution is selected-tank override → authenticated owner's original
legacy row → application defaults. Single Apply writes only an override. Apply
All upserts every owned override and synchronizes the original legacy row's
known JSON/numeric values in the same transaction, preserving identity,
creation time and unrelated JSON fields. A late legacy write failure rolls back
all overrides and activity together.

## RLS policies

- Existing `threshold_settings` and `tanks` policies are unchanged.
- `tank_threshold_owner` on `tank_threshold_settings`: owner must equal
  `auth.uid()` and the referenced tank must belong to that caller, for reads
  and writes. Clients receive SELECT/INSERT/UPDATE only; no direct DELETE.
- `threshold_activity_read_guard`: threshold activity is visible only to its
  owning user and tank.
- `threshold_activity_insert_guard`: blocks client-forged threshold activity.
- `threshold_activity_update_guard` and `threshold_activity_delete_guard`:
  prevent client rewriting/removing threshold activity.
- Existing non-threshold activity and actuator policies are retained.
- The trigger rejects moving an override to a different user or tank.

## Web and mobile/AI behavior

Web now reads the logical bridge RPC and resolves every reading by tank. Before
the bridge exists, reads can fall back to the original table; writes still fail
truthfully if the Apply RPC is unavailable. Dismissing a tank recommendation
changes only its override metadata.

Recommendations do not modify active thresholds until explicit Apply. AI Apply
uses the latest pending recommendation for that known tank, with server-side
whitelisting and validation. No installed mobile source or deployed AI Guide
function was edited or deployed. Existing user-only reads/upserts remain valid
because the original table and its uniqueness behavior remain intact.

The source backup allowlist includes the new override table. Existing backup
Edge Functions were not redeployed as part of this focused threshold fix.

## Validation

- Full unit suite before deployment: **135 passed, one existing skip**.
- Seven local bridge SQL/RPC/RLS tests pass; the fixture models Supabase's
  explicit default function grants to anon/authenticated.
- Browser regression suite: **56 passed**, including selected-tank/Apply All,
  confirmation, pending AI, refresh, monitoring reevaluation and phone layout.
- `npm run build`: passed; distribution security scan has no findings.
- Targeted ESLint on changed JavaScript/test files: passed.
- Full-project ESLint still reports 22 existing errors and five warnings in
  unrelated files; no new errors were introduced in the changed files.
- Existing >500 kB bundle-size warning remains.

This release includes the matching Web changes used for the browser checks.
The production Web read path needs this release to resolve the new override
table correctly after refresh. A GitHub push delivers the integration to the
repository; the hosting deployment status must be checked separately.

## Real authenticated remote test

**Passed against the remote project after the user signed in manually in an
isolated browser.** These were actual UI actions using the verified user's
Supabase client and the local Web integration, not mocked requests or an
administrative SQL role impersonation.

| Check | Actual remote result |
| --- | --- |
| Initial resolution | Selected tank with no override used the existing legacy settings |
| Apply to This Tank | HTTP 200; one tank affected, one changed; only that override written |
| Single-tank isolation | Complete legacy row unchanged, including identity and timestamps |
| Persistence | Reload displayed the saved override value |
| Other-tank fallback | Account has only one owned tank; initial no-override fallback passed, separate other-tank UI check unavailable |
| Apply to All Tanks | HTTP 200; one owned tank affected, one changed; original effective values restored |
| Legacy synchronization | All seven JSON and numeric-column values matched the requested original effective settings; original row ID/creation time preserved |
| Activity | Exactly one real change entry for Single Apply and one for Apply All; correct authenticated actor, source and scope |
| Legacy/mobile API | Real user-only singular read and same-row `ON CONFLICT(user_id)` upsert passed |
| Ownership/RLS | Unowned-tank Apply rejected with SQLSTATE 42501; cross-owner override query returned no rows |
| Probe/no-op activity | Unchanged-value legacy upsert and ownership probes created no extra activity |
| Final values | Original effective thresholds restored and confirmed after reload |

Only one tank belongs to this test account. Multi-tank isolation/Apply All and
application-default resolution are also covered by the passing local SQL and
browser tests; the remote run does not claim multiple owned tanks were tested.
The existing mobile APK and AI screens were not separately exercised. Their
original table/API remains unchanged, and the authenticated legacy API check
passed. No mobile or deployed AI function was modified.

`scripts/verify-remote-threshold-apply.mjs` performed a real UI single-tank Apply
with a temporary 0.1 cm adjustment, verifies refresh and unaffected legacy/other
tank fallback, then uses UI Apply All to restore the original effective settings
for all owned tanks. It checks protected activity counts/actor/scope, legacy JSON
and flat-column synchronization, an unchanged-value legacy user-only upsert, and
rejection of an unowned tank. The actual test changes remain in activity history.

Only sanitized pass/fail metadata and counts are saved to the ignored local
results file. Passwords, session tokens, refresh tokens, cookies, authorization
headers, screenshots, traces and persistent browser profiles are not exported,
logged or saved by the runner.

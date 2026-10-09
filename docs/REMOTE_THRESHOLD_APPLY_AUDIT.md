# Initial production threshold Apply audit

**Update, October 10, 2026:** the user approved the bridge and its migration has
been deployed. The current implementation leaves the legacy table completely
unchanged, including its columns. See
[THRESHOLD_BRIDGE_DEPLOYMENT.md](THRESHOLD_BRIDGE_DEPLOYMENT.md) for the deployment
and authenticated verification results. Findings below describe the initial
missing-RPC state and the proposal before that approval.

## Verified remote findings

Read-only Supabase CLI queries against linked project
`abtzkqfrwzcocyrwcrfc` confirmed:

- `public.apply_tank_thresholds` does not exist (no overloads).
- `public.get_tank_threshold_settings` does not exist.
- `threshold_settings.tank_id` does not exist.
- `threshold_settings` still has its original `UNIQUE(user_id)` constraint.
- There are two legacy rows belonging to two distinct users.
- RLS is enabled on both `threshold_settings` and `tanks`, with owner policies.
- There is no `supabase_migrations.schema_migrations` history table. The absence
  of the schema/function changes establishes that the candidate is not applied
  in the current database; there is no history record to assert an earlier run.
- No public SQL function definition references `threshold_settings` in the
  dependency inspection. This is not an audit of missing mobile source.

A direct public-key HTTP request reproduced **404 / PGRST202** using the exact
Web RPC parameter names. That was an **unauthenticated endpoint check**, not a
successful authenticated Apply.

No remote write, migration, role impersonation, Auth-user creation, mobile edit,
AI deployment, Web deployment, Git commit or push was performed in this task.
The existing mobile behavior was left unchanged.

## Existing migration and exact interface

The repository already contains
`docs/sql/20261009180000_per_tank_thresholds.sql`, which defines:

```sql
public.apply_tank_thresholds(
  p_tank_id uuid,
  p_patch jsonb,
  p_scope text DEFAULT 'single_tank',
  p_source text DEFAULT 'manual'
) RETURNS jsonb
```

`src/services/tankThresholdService.js` calls `rpc('apply_tank_thresholds', ...)`
with precisely `p_tank_id`, `p_patch`, `p_scope`, `p_source`. Name, parameter names
and types agree. The production failure is an absent function, not a mismatch
between those definitions. The existing migration intentionally refuses DDL
pending compatibility review.

## Compatibility issue

Removing `UNIQUE(user_id)` from the original table allows multiple tank rows but
invalidates the old predicate-free `ON CONFLICT(user_id)` upsert. A partial
legacy index does not replace that conflict target. Multiple rows also invalidate
an old user-only singular read, and a user-only UPDATE would affect overrides.
The installed mobile query implementation is still unavailable, so these paths
cannot safely be assumed absent merely because mobile currently works.

Adding a nullable column alone does not solve these problems. Deploying the
guarded same-table candidate as-is is not an acceptable production fix.

## Concrete bridge proposal prepared, not applied

SQL proposal:
[`sql/20261010120000_threshold_compatibility_bridge.sql`](../supabase/migrations/20261010120000_threshold_compatibility_bridge.sql).

This preserves the original table, `UNIQUE(user_id)`, existing policies and row
values. It adds nullable `threshold_settings.tank_id`, constrained to NULL for
the legacy API, and puts owned tank overrides in `tank_threshold_settings` with
`UNIQUE(user_id,tank_id)`. The new override table always requires an owned tank;
the original legacy table never requires a tank ID.

It creates the **same Apply signature expected by Web**, using caller `auth.uid()`
and SECURITY INVOKER/RLS. Single Apply writes only an override. Apply All updates
every owned override and then synchronizes the original legacy row atomically.
No legacy row is rewritten during migration; no backfill or migration activity
is generated. Audit records represent actual authenticated value changes.
The proposal grants execution to authenticated callers, removes public access,
and notifies PostgREST to reload its schema cache at commit.

The companion read RPC returns the logical collection of owned tank overrides
and the original NULL fallback row. Resolution stays tank → legacy → defaults.
It does not require any change to installed mobile or deployed AI Guide.

This physical layout differs from the requested same-table arrangement. Approval
of that difference is pending; the SQL remains outside automatic migrations.
Otherwise the actual mobile source is required before a same-table deployment.

Matching Web/backup integration patch:
[`patches/web-threshold-bridge-integration.patch`](patches/web-threshold-bridge-integration.patch).

The patch updates Web's read path to the logical read RPC, retains read fallback
before migration, dismisses only a selected tank's pending metadata in the new
table, and includes overrides in future developer backups. It leaves installed
mobile and the working deployed AI function alone. The existing production Web
read path must be updated along with the bridge, or it would read only legacy
settings after saving a tank override. The patch is prepared and `git apply
--check` passes; it has not been applied to active source or deployed.

## Validation performed

- Seven local PGlite tests in `tests/threshold-bridge.test.mjs` pass. They cover
  exact legacy preservation/nullable column, old user-only upsert/read/update
  after multiple overrides, single tank fallback, Apply All synchronization,
  RLS/ownership/grants/exact signature, AI pending/acceptance and rollback of all
  writes/activity on a late legacy synchronization failure.
- Targeted ESLint for the new test and remote test runner passes.
- Web integration patch check passes against the current repository.
- No frontend build result is offered as evidence of remote RPC availability.
- **A real authenticated remote Apply has not run.**

The isolated runner `scripts/verify-remote-threshold-apply.mjs` is prepared. After
the compatible migration and Web patch are approved/applied, the user signs in
normally in a fresh browser and explicitly chooses a tank/change to Apply. The
runner verifies HTTP 200, authenticated ownership, saved values for the selected
scope, Apply All legacy synchronization, rejection of an unowned tank, and reload.
It never records passwords, JWTs, traces, screenshots or a persistent profile.
No stored browser session or credential store is read.

## Deployment command and result

**No deployment command has been executed.** Once the physical-layout decision
is confirmed, promote the reviewed SQL to the migration path, apply that exact
file using the supported CLI `db query --linked --project-ref
abtzkqfrwzcocyrwcrfc --file <reviewed-file>`, release the matching Web read change,
then inspect the remote function/grants/column definitions and run the isolated
authenticated browser test. Do not run the previously guarded candidate or an
unreviewed bulk migration push.

Before any deployment, an ignored local read-only fingerprint was recorded for
the original legacy rows. A post-deployment comparison must ignore the newly
added NULL column and verify all original IDs, values and timestamps are intact.

## Pending input

1. Approve the bridge layout, or supply the actual mobile source so the requested
   same-table arrangement can be assessed without risking the working flow.
2. Sign in to the isolated browser for the actual remote Apply verification, or
   perform the production Apply and provide its result. No password/token should
   be sent in chat.

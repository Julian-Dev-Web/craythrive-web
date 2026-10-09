# Historical threshold compatibility audit

**Superseded on October 10, 2026:** the compatibility bridge was approved and
deployed. The legacy table was left completely unchanged. See
[THRESHOLD_BRIDGE_DEPLOYMENT.md](THRESHOLD_BRIDGE_DEPLOYMENT.md) for current
objects, grants and test results. The same-table candidate below is archived
and must not be deployed.

## Outcome

The same-table SQL candidate is **not approved for production**. Nothing was
applied to live Supabase, deployed, committed or pushed during this audit.
The migration now stops before any schema/data change unless an explicit
compatibility-review setting is enabled. Only the isolated PostgreSQL tests
enable it; passing those tests does not establish installed-APK compatibility.

Archived candidate: [`20261009180000_per_tank_thresholds.sql`](sql/20261009180000_per_tank_thresholds.sql).

The actual Expo source has not been located or supplied. Consequently its
threshold reads, recommendation persistence and Apply implementation remain
**unverified**. This is a release dependency, not a claim that the APK is safe.

## Existing reads and writes

| Source | Identity / read behavior | Write / conflict behavior |
| --- | --- | --- |
| Current Web `tankThresholdService.js` | `threshold_settings.select('*').eq('user_id', userId)` returns an array; no `maybeSingle()` | Apply calls `apply_tank_thresholds` with selected tank, source and scope; no client-side upsert |
| Current Web `useTankThresholdSettings.js` | Selected tank row, otherwise owner's NULL legacy row, otherwise defaults | Dismissal clears pending metadata by `user_id + tank_id + id`; does not change threshold values |
| Current Web `thresholdEvaluation.js` and five monitoring pages | Account-scoped bundle; resolves the reading's tank before evaluation | Read only; refreshed after successful saves; drafts never activate before server success |
| Previous Web implementation, documented in `PER_TANK_THRESHOLDS.md` | User-only `maybeSingle()` | User-only `upsert` conflict target; removed from current Web paths |
| SQL candidate | `user_id + tank_id` for selected row; `user_id + tank_id IS NULL` for fallback | Partial-index SQL conflict predicates explicitly match tank and legacy indexes |
| Developer backup `developerDatabase.js` | Full allowlisted table snapshot, ordered by introspected primary key | Restore conflicts on actual primary key (`id` here), checks schema, suppresses/restores triggers; not a user-only threshold Apply path |
| Deployed `craythrive-ai-guide` entry, read-only downloaded | Verifies caller with `auth.getUser()` and tank using `id + user_id + maybeSingle()`; currently accepts threshold context from client | **No threshold table read/write/upsert** in the downloaded entry; returns a recommendation only |
| Installed Expo APK / source | **Unknown**: actual source unavailable | **Unknown**: caller-side recommendation persistence and Apply must be inspected |

Repository searches included literal `threshold_settings`, `THRESHOLD_SETTINGS`,
`pending_ai_suggestion`, `apply_tank_thresholds`, `fetchThresholdRows` and
`loadActiveThresholds`. The schema constant is a declaration, not an additional
writer. `ThresholdSettingsPage.jsx` re-exports the current settings page.

Read-only live schema inspection confirmed `tanks.id` is UUID and the original
threshold table has a named `UNIQUE(user_id)` constraint. Original numeric and
JSON columns, timestamp columns and ownership policies were inspected. No type
or key was guessed.

The downloadable local APK contains a Hermes bytecode bundle. This does not
establish its query implementation and is not a substitute for the actual
mobile source or an end-to-end test of the installed build.

## Why nullable tank_id and partial indexes are insufficient

A same-table transition requires removing global `UNIQUE(user_id)` to permit
multiple tank rows. PostgreSQL then rejects the old statement:

```sql
INSERT INTO threshold_settings (user_id, thresholds) VALUES (...)
ON CONFLICT (user_id) DO UPDATE SET thresholds = excluded.thresholds;
```

A partial index `ON (user_id) WHERE tank_id IS NULL` only supports a matching
conflict predicate. Old PostgREST `on_conflict=user_id` does not supply it.
Likewise, retaining legacy plus tank rows means an old user-only singular read
can return multiple rows and fail. These are actual PostgreSQL regression cases
in `tests/per-tank-thresholds.test.mjs`, not solved by nullable columns or RLS.
An explicit NULL-row insert/update works; this does **not** mean old upsert works.

The proposed compatibility bridge would retain the original one-row-per-user
`threshold_settings` and its unique constraint, and store new tank overrides in
`tank_threshold_settings`. Logical resolution remains tank → legacy → defaults;
Apply All would synchronize the original account row. That physical layout
differs from the requested same-table model, so it has **not** been implemented
while the architecture clarification and mobile-source request are pending.

Do not enable the migration guard based on the Web tests alone. If installed
clients use legacy singular reads/upserts, choose the bridge rather than making
an APK rebuild a prerequisite for this migration.

## SQL candidate corrections prepared

- Nullable UUID `tank_id`, FK to `tanks(id)` with cascade deletion of tank rows.
- Distinct partial unique indexes for NULL legacy rows and non-NULL tank rows.
- Legacy row IDs, original JSON/numeric values and original timestamps preserved
  during backfill. Backfill runs before the audit trigger, generating no actions.
- Owner RLS permits reading, inserting and updating owned NULL legacy rows;
  non-NULL rows additionally require ownership of that tank. Legacy deletes
  remain owner-scoped as before; tank-row deletes remain restricted.
- Row identity cannot be moved between owners/tanks, including NULL → tank moves.
- Apply This Tank changes only that tank, leaving legacy and other tanks alone.
- Explicit Apply All updates every owned tank and then upserts the NULL legacy
  row to the same JSON and flat numeric values, in the same transaction. Its
  existing identity and pending metadata survive. Unchanged legacy values do not
  bump its timestamp. Foreign owners are unaffected.
- Tank insert audit compares with the previous legacy fallback, because legacy
  synchronization happens after tank writes. There is no extra legacy tank event.
- Authenticated effective value changes create activity; recommendation-only,
  no-op, migration and administrative changes without a user actor do not.
- Invalid scope, unsupported values, foreign tanks and missing AI context fail;
  any Apply All error rolls back tank, legacy and activity writes together.
- The existing Web missing-RPC error remains truthful until the reviewed
  migration is actually applied. No save is simulated in browser storage.

These corrections do not remove the old-client architecture blocker above.

## Web and portable resolver

`supabase/functions/_shared/thresholdResolution.js` holds the defaults,
normalization, bundle resolution and a selected-tank database reader, with no
Vite/React/browser dependency, secrets or writes. Web imports it rather than
maintaining separate normalization code. Existing units, numeric readings,
severity rules and design are preserved.

The portable selected-tank reader queries user+tank with `maybeSingle()`, then
explicit `tank_id IS NULL`, then defaults. Before the column exists, only a
confirmed missing-`tank_id` schema error permits an old user-only singular read.
Permission, network, duplicate-row and unrelated-column errors propagate. A
missing tank ID is rejected, never replaced with a guessed tank.

## Mobile preparation — not integrated

[`mobile-next-apk/thresholdSettings.js`](mobile-next-apk/thresholdSettings.js)
provides a tested adapter for the next Expo build. It uses the portable reader
and the atomic RPC for explicit manual Apply and tank-scoped pending-AI Apply.
Copy the portable resolver into the Expo project and adjust the adapter import.
No mobile UI change is needed merely to adopt the reader.

The actual mobile caller must still be inspected and wired: tank identity,
recommendation persistence, old account-level settings screens and pending-AI
acceptance cannot be safely inferred. The pending-AI adapter requires a
recommendation stored against the known tank; it does not attach a global
recommendation to a guessed tank. Receiving a recommendation does not invoke it.

An eventual APK rebuild is required to ship new per-tank behavior to mobile.
It must **not** be required just to keep an installed old APK working when the
database changes. The bridge is the proposed solution if old queries persist.

## AI patch prepared — not deployed

[`patches/ai-guide-authoritative-thresholds.patch`](patches/ai-guide-authoritative-thresholds.patch)
was prepared against the read-only downloaded deployed entry. `git apply --check`
passes against that exact entry. It imports the portable reader and fetches
authoritative settings after caller/tank verification, replacing untrusted
client-provided threshold context. No writes or autonomous Apply were added.
Existing suggestion whitelist, supported numeric validation, provider parsing,
scope enforcement and explicit-user-Apply language remain unchanged.

Missing tank context still returns 400; unauthorized tank context returns 403;
threshold-loading errors return 503. No account-wide or first-tank guess is added.

The entry imports `src/utils/aiScope.js` and `src/utils/aiResponseParsing.js`, which
are absent from this workspace. Supabase CLI downloaded the entry but refused
to extract a dependency outside its function download directory. Its path guard
was not bypassed. Full function type-check/build/deploy and mobile caller Apply
verification therefore remain pending the actual source tree. A passing patch
check does not mean the full Edge Function has been built.

## Deployment order

1. Obtain the actual Expo source/repository and identify installed APK threshold
   reads, writes and AI Apply paths. Confirm whether the bridge is needed and
   approved. Keep the current production schema and APK working meanwhile.
2. Complete the compatible storage migration and integrations for that verified
   layout. Test the existing APK against a staging database, including old
   singular reads/upserts, new Web writes, ownership and AI acceptance.
3. Take a database backup and apply **only the reviewed compatible migration**.
   The current guarded candidate must not be applied as-is for unknown clients.
4. Deploy the authoritative-context AI patch together with its actual missing
   dependencies and portable resolver. Verify it with the existing APK.
5. Release Web; verify a confirmed save removes the missing-RPC warning and
   refresh re-evaluates the existing readings against the right tank's settings.
6. Ship the next APK with explicit tank-scoped resolution and Apply behavior.
   Retain the legacy configuration until all supported old clients are retired.

No production operation from this sequence was executed during this task.

## Validation

Current results:

- `npm run build`: passed; distribution security scan has no findings.
- `npm test`: 127 passed, one existing retired-feature skip, zero failures.
- Focused browser suite: six passed, including phone layout, Apply All legacy
  synchronization, confirmation, AI acceptance and refreshed monitoring.
- Targeted ESLint on every changed JavaScript/test file: passed.
- Full ESLint: unchanged baseline of 22 existing errors and five warnings in
  other files. Existing production JavaScript chunk warning (>500 kB) remains.
- AI patch `git apply --check`: passed against the downloaded entry only.
- `git diff --check`: passed. Windows LF/CRLF conversion notices are not errors.

Tests include the guard's rollback-before-DDL behavior, both partial
uniqueness cases, explicit legacy writes, Apply All synchronization, first
per-tank row fallback, defaults, AI acceptance, unchanged recommendations,
ownership, atomic rollback and the known old-client incompatibility.

## Exact files changed

- `src/services/tankThresholdService.js`
- `src/utils/thresholdEvaluation.js`
- `supabase/functions/_shared/thresholdResolution.js` (new portable resolver)
- `docs/sql/20261009180000_per_tank_thresholds.sql` (guarded candidate)
- `tests/per-tank-thresholds.test.mjs`
- `tests/threshold-compatibility.test.mjs` (new)
- `tests/browser/fixtures.mjs`
- `tests/browser/tank-thresholds.spec.mjs`
- `docs/PER_TANK_THRESHOLDS.md`
- `docs/THRESHOLD_COMPATIBILITY_AUDIT.md` (this report, new)
- `docs/mobile-next-apk/thresholdSettings.js` (prepared adapter, new)
- `docs/patches/ai-guide-authoritative-thresholds.patch` (prepared patch, new)

No actual mobile-project file or deployed AI function was changed.

## Repository discovery limitation

Automatic approval review rejected a proposed script that would read a stored
GitHub credential and use it to enumerate repositories. The script was not run,
no credential was extracted, and that method was not retried or bypassed.
The mobile source folder or a specific repository link is needed instead.

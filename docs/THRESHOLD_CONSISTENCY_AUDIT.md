# Cross-client threshold consistency audit

October 10, 2026. Project: `abtzkqfrwzcocyrwcrfc`.

## Confirmed regression and scope

The latest remote read shows the affected account's legacy JSON and flat water
minimum both equal **3.5 cm**, updated after its canonical override, whose JSON
and flat minimum remain **4.0 cm**. There is exactly one owned tank and only the
water minimum differs. Web resolves the override first, so refresh alone cannot
make the newer legacy change effective. The previous compatibility verification
checked legacy read/upsert success, but did not verify a legacy change after an
override had been created. API compatibility did not establish synchronization.

No tables should be dropped. `tank_threshold_settings` remains canonical;
`threshold_settings` remains fallback/legacy mirror with `UNIQUE(user_id)`.

## Actual paths inspected

| Component | Verified read/write path |
| --- | --- |
| Web monitoring | `loadActiveThresholds` -> `fetchThresholdRows` -> `get_tank_threshold_settings`; shared `thresholdBundle` / `resolveTankThresholds` applies tank -> legacy -> defaults |
| Web Settings | Same bridge read RPC; explicit Apply calls `apply_tank_thresholds(p_tank_id,p_patch,p_scope,p_source)`; successful Apply refetches saved rows |
| Web pending AI controls | Explicit acceptance uses that same RPC with `p_source='ai_recommendation'`; the RPC uses the selected tank's saved pending recommendation |
| Current deployed AI Guide entry | Downloaded entry matches the earlier inspected source. Verifies caller/tank, accepts client-supplied threshold context, returns recommendations; contains no threshold writes or Apply RPC invocation |
| Canonical Apply RPC | SECURITY INVOKER; `auth.uid()` ownership, allowed numeric keys/ranges, tank-scoped writes/audits, All synchronizes legacy |
| Legacy table | Exactly one row per user; no `tank_id`, source/acceptance field or custom trigger. A legacy write cannot identify an intended tank for a multi-tank owner |
| Installed Expo / mobile AI Apply UI | **Not yet verified: actual source is unavailable.** The observed write bypasses canonical synchronization, but direct client write versus another caller cannot be asserted from database values alone |

The supported CLI downloaded the current AI entry but refused extraction of its
external `source/src/utils/aiScope.js` dependency. The complete deployable AI
source is not present. Do not deploy an incomplete/reconstructed AI function.
The existing prepared authoritative-resolver patch is not a deployed fix.

## Independent Web fixes implemented

- Settings tank switches refetch the latest database rows.
- Settings and monitoring refetch on window focus/return to a visible tab, in
  addition to same-tab save and cross-tab storage notifications.
- Settings ignores superseded load responses; successful Apply invalidates
  earlier in-flight loads before refetching.
- Existing design and unsaved editor drafts are preserved. A draft is not
  automatically applied when remote settings change.

Neither threshold table is currently published to Supabase Realtime. Focus,
tank switch, successful Apply and full page refresh supply the refresh behavior;
no publication/RLS change has been deployed. These refresh fixes intentionally
do **not** pretend that an independent legacy write updates canonical data.

## Current-data repair prepared

[`sql/reconcile_confirmed_water_threshold.sql`](sql/reconcile_confirmed_water_threshold.sql)
is a one-time guarded repair, outside automatic migrations. It requires the
audited complete-row fingerprints, exactly one owned tank, matching unrelated
thresholds, a newer legacy timestamp and matching JSON/flat accepted 3.5 cm value.
It writes only the canonical water minimum, preserving legacy and unrelated
settings. It aborts on concurrent changes/ambiguous ownership and creates no
threshold-change activity. It is **not** a permanent legacy synchronization rule.

**Executed and verified remotely:** the guarded repair was applied using the
supported linked-project CLI `db query --file .security-reconcile-confirmed-water.sql`.
The private local operator copy supplies only the audited row fingerprints, no
credentials. Post-repair readback confirms both canonical JSON/flat values and
legacy JSON/flat values are **3.5 cm**. The complete legacy fingerprint remained
unchanged; only canonical water fields/update time changed. The transaction
verified that no threshold activity was generated. No schema/function/policy was
changed. This repairs the known accepted value; it does not resolve future
legacy-only Apply operations or replace the missing mobile integration.

## Required mobile/AI integration before architecture deployment

The actual Expo source location/repository has been requested. Inspect the
installed build's threshold utility and AI Apply handler before altering them:

1. Verify how selected `tank_id` reaches the Apply button and what it sends.
2. Replace updated clients' tank-context reads with the shared canonical resolver.
3. Route explicit manual/accepted-AI Apply through the existing canonical RPC.
4. Verify where pending recommendations are stored; never apply merely because
   a recommendation was generated or attach an account-wide suggestion to a
   guessed tank.
5. Make AI read canonical thresholds after verified ownership; preserve all
   existing recommendation behavior and dependencies.
6. Exercise mobile AI 3.5 -> Web refresh, Tank B isolation, Web 3.7 -> updated
   mobile, All 4.0 -> canonical+legacy, unapplied recommendation, legacy client
   reads/writes and foreign-tank rejection.

**APK rebuild status: not verified.** If the installed client directly performs
legacy-only reads/writes, adopting the new resolver/RPC requires shipping an
updated mobile bundle (APK rebuild unless an established compatible OTA release
mechanism is verified). A server cannot recover an omitted tank ID for an owner
with multiple tanks. Do not claim a server-only solution or no rebuild without
inspecting the actual source/build setup.

## Validation and release status

- Seven targeted browser regressions passed, including remote-client canonical
  changes observed on tank switch/focus/refresh without local Apply notifications.
- Targeted ESLint for changed hooks/browser test passed.
- All eleven SQL bridge/reconciliation checks passed, including stale snapshot,
  multi-tank ambiguity, unrelated differences and no fabricated activity.
- `npm run build` passed; distribution credential scan has no findings.
- Existing bundle-size warning remains.
- No firmware, actuator, pump/feed, existing AI deployment or legacy schema was
  changed. No new architecture migration is deployed by this audit.
- The eight requested cross-client cases are **not claimed complete** while the
  actual mobile code and its installed-build Apply path are unavailable.

Files changed/prepared in this audit:

- `src/hooks/useTankThresholdSettings.js`
- `src/hooks/useThresholdRefresh.js`
- `tests/browser/tank-thresholds.spec.mjs`
- `tests/threshold-bridge.test.mjs`
- `docs/sql/reconcile_confirmed_water_threshold.sql`
- `docs/THRESHOLD_CONSISTENCY_AUDIT.md`

This release includes the tested Web refresh changes, regression checks and
guarded data-repair template. Hosting deployment status must be checked after
the GitHub push. No new migration or Edge Function deployment is included. The
one-time data repair is already visible to the existing production canonical
reader after refresh. Permanent mobile Apply integration remains pending the
actual mobile source.

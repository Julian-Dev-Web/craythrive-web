# Threshold synchronization: current audit and incomplete integration

Date: October 10, 2026 (Asia/Manila). Remote project: `abtzkqfrwzcocyrwcrfc`.

**The requested mobile-to-Web verification is not complete.** The actual Expo
source/repository has not been supplied or located. A prepared adapter is not an
installed mobile implementation. No new migration, Edge deployment, production
threshold write, reconciliation or GitHub push was performed in this pass.
Pending drain/refill work in the workspace belongs to the earlier request and
was left separate; this pass does not deploy or extend it.

## Actual paths and remaining gaps

| Requested item | Verified result |
| --- | --- |
| Current mobile threshold read | Unverified: actual Expo source is unavailable. `docs/mobile-next-apk/thresholdSettings.js` is only a prepared adapter. |
| Current mobile AI Apply write | Unverified: database changes demonstrate independent legacy writes, but cannot identify the exact mobile handler or caller. |
| Web read | `loadActiveThresholds` / Settings -> `fetchThresholdRows` -> shared `fetchTankThresholdRows` -> authenticated `get_tank_threshold_settings()`. |
| Web write | `useTankThresholdSettings.apply` -> `applyTankThresholds` -> `apply_tank_thresholds`. Successful Apply refetches; tank switches, focus, visibility and reload also refresh. |
| Canonical source | `public.tank_threshold_settings`, unique `(user_id,tank_id)`. |
| Resolver | `_shared/thresholdResolution.js`: selected tank override -> caller's legacy row -> existing application defaults. Settings now calls this same resolver. |
| RPC changes | None required or deployed in this pass. Existing deployed signature, ownership checks, whitelisted numeric patch validation and RLS were inspected. |
| AI context | Current deployed entry still accepts client-supplied thresholds. Its server-authoritative resolver patch remains pending; it is not deployed. |
| Reconciliation | None in this pass: newer legacy data cannot safely be attributed to an accepted selected-tank change from the available evidence. |
| Mobile files changed | None: actual project is missing. Prepared adapter was exercised locally, not integrated into Expo. |
| APK requirement | Updated mobile code must be shipped for true per-tank support. A new APK is needed unless the project's established compatible OTA mechanism can be verified. An unchanged legacy-only APK cannot display different per-tank values. |

The current AI function was downloaded again using the supported CLI. Its entry
hash matches the earlier audit. The CLI refuses extraction of an external
`source/src/utils/aiScope.js` dependency; the deployable source also needs
`aiResponseParsing.js`. Neither dependency is present here. The incomplete
download must not be redeployed. The entry verifies the user and tank and
returns recommendations, but does not write threshold settings.

## Exact RPC contract

```sql
public.apply_tank_thresholds(
  p_tank_id uuid,
  p_patch jsonb,
  p_scope text DEFAULT 'single_tank',
  p_source text DEFAULT 'manual'
) RETURNS jsonb
```

The existing patch keys are **camelCase**: `waterLevelMin`, `temperatureMin`,
`temperatureMax`, `phMin`, `phMax`, `turbidityMax`, `ammoniaMax`.
The attachment's example `{water_level_min: 3.5}` is not the deployed RPC
contract and is rejected. Mobile integration must send `{waterLevelMin: 3.5}`.

- Single Apply writes only the selected owned tank override.
- All applies the selected effective configuration plus patch to all owned tanks
  and synchronizes the original legacy row, preserving its identity and unknown
  JSON metadata.
- AI acceptance currently derives values from the selected override's saved
  `pending_ai_suggestion`; the supplied patch cannot override that suggestion.
  Mobile's actual pending-recommendation storage must therefore be inspected
  before wiring AI Apply. No suggestion may be attached to a guessed tank.
- Actual authenticated value changes get `threshold_updated` / `updated`
  activity. AI notes say "AI recommendation accepted by user." Unchanged values
  and administrative/backfill writes do not fabricate user activity.

Remote catalogs confirm authenticated EXECUTE and no anon EXECUTE for Apply and
read RPCs, SECURITY INVOKER for both, and enabled RLS on `tanks`,
`threshold_settings`, and `tank_threshold_settings`. The canonical ownership
policy checks both `user_id=auth.uid()` and ownership of `tank_id`. Legacy
owner-only SELECT/INSERT/UPDATE/DELETE policies and `UNIQUE(user_id)` remain.
The legacy table still has no `tank_id` column and was not restructured.

## Latest remote conflict

The affected single-tank account currently has:

| Source | Water minimum | Updated (UTC) |
| --- | --- | --- |
| Canonical tank override | 3.5 cm | 2026-10-09 17:04:21.039727 |
| Legacy account row | 4.5 cm | 2026-10-09 17:08:56.525 |

Other effective parameters match. The last recorded threshold activity predates
both timestamps and is manual; there is no newly recorded AI acceptance proving
that the later legacy 4.5 should replace this tank's 3.5. The earlier known
accepted 3.5 was already repaired in the previous task. This pass preserves the
newer values and canonical-first precedence rather than guessing another repair.
The other legacy account has no override and correctly uses legacy fallback.

## Changes in this pass

- `supabase/functions/_shared/thresholdResolution.js`: one collection reader for
  Web, prepared mobile and future AI integration. If the bridge RPC is missing,
  read the actual separate override table before the unchanged legacy table.
  Only a genuinely absent override table allows pre-bridge legacy-only reads.
  Permission/network failures propagate. Never query legacy `tank_id`.
- `src/services/tankThresholdService.js`: reuse that reader and keep existing
  Web cache behavior, rather than a separate legacy-only fallback.
- `src/hooks/useTankThresholdSettings.js`: resolve editor baseline with the
  same portable resolver used by monitoring and the prepared mobile adapter.
- `tests/threshold-compatibility.test.mjs`: fallback/ownership/error regressions,
  including newer legacy 4.5 alongside canonical 3.5.
- `tests/threshold-bridge.test.mjs`: added local SQL/RLS contract exercise through
  the prepared mobile adapter and actual Web service. Preexisting removal of
  earlier reconciliation-template tests was preserved.
- `docs/THRESHOLD_SYNC_CURRENT_AUDIT.md`: this report.

No new SQL migration or deployed Edge entry was changed. The shared `.js` helper
above is a source change, not an Edge deployment. Existing unrelated working-tree
changes and the preexisting reconciliation-template deletion were preserved.

## Validation

- **15 targeted tests passed**: real local PostgreSQL execution through PGlite,
  ownership/RLS, pending AI -> explicit 3.5 acceptance -> Web reader, separate
  Tank B fallback, Web 3.7 -> prepared mobile reader, All 4.0 -> overrides+legacy,
  fresh reads, no-op activity, rollback and foreign-tank rejection.
- **7 isolated browser tests passed**: selected tank, Apply, refresh/focus,
  cross-tab monitoring, pending AI, Apply All, activity and mobile viewport.
  Browser tests use mocked accounts; these are not installed-APK remote tests.
- `npm run build`: passed; distribution credential scan has no findings.
- Targeted ESLint on all five changed JavaScript/test files: passed.
- Full ESLint: 22 existing errors and 5 warnings. Per-file rule/severity counts
  match the prior baseline. Existing production chunk-size warning remains
  (approximately 602 kB minified).
- Remote schema/RPC/data audit: read-only, completed. **No real mobile Apply was
  executed in this pass**, so the requested cross-client acceptance criterion
  remains unmet.

Completion requires the actual Expo source/repository, complete AI deployment
dependencies, integration of the shared resolver/RPC into the selected-tank
mobile handlers, shipping that mobile change, and the real same-tank remote
tests. The installed client must not be represented as fixed before those tests.

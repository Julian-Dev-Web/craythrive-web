# Tank Details refresh and AI explanation persistence

2026-10-13. Existing pending water-depth precision changes are preserved.

## Verified cause

No `window.location.reload()` or location assignment exists in the Tank Details
monitoring path. The initial full load is tied to the route's tank ID and a stable
refresh callback. Manual Refresh and post-command loads already pass `silent=true`.
Same-user token refresh does not change the protected route's account key.
Changing tank/account intentionally creates a new scope.

Tank Details observes controls every 8 seconds while idle and every 1.5 seconds
while a command is active. These are scoped reads and normal React rerenders,
not full browser reloads. Its sensor hook separately subscribes to reading changes
and has a visible-page 60-second recovery read and 15-second freshness check.
Those mechanisms are useful and remain enabled.

The actual AI state-loss paths were in `SensorRecommendations.jsx`:

1. Every 30-second recommendation refetch set the whole dialog to loading,
   removing the AI child from the rendered tree even with unchanged measurements.
2. `AIExplanation` used `key={JSON.stringify(recommendations)}`. A new reading,
   threshold or availability status therefore remounted it and cleared its state.
3. Answers existed only in the child component's `useState`; closing the dialog,
   navigation or browser refresh discarded them. There was no saved explanation
   history in this panel.

A production-bundle browser test reproduced answer loss after a real context
refetch triggered by advancing the simulated clock 31 seconds. The same test
passes after the fix. A separate three-minute simulation verifies unchanged root
DOM identity, zero document navigations and no repeated full-profile fetches.

## Changes

Background context reads retain the mounted AI child and previous context.
Errors remove unverified deterministic cards but keep the previous AI answer
visible and mark it Outdated. AI identity is keyed only by verified owner/tank.
Context requests are coalesced, obsolete results rejected, and a 15-second deadline
keeps verification retryable. Visible-page 30-second context polling, focus/online
threshold recovery and explicit refresh still work. Existing sensor-hook changes
also signal a debounced context refresh; no extra Realtime channel is created.

Overlapping Tank Details control polls are suppressed per tank. Existing cadence,
command reads/writes, cooldowns, stable-sample checks, raw water-depth comparisons
and automation safety decisions are unchanged. The complete page is not reset
on a new observation; command/forms/tabs remain independent from AI results.

The new `recommendationHistory` service retains up to five completed explanations
per verified Auth user ID and tank ID in browser-tab `sessionStorage`, with an
in-memory fallback when browser storage is blocked. Cached schema/identity/text,
timestamp, expiry and sizes are validated before restore. Cache retention is
24 hours from the trusted server generation timestamp; this is a UI retention
policy, not a biological/sensor safety threshold. Expired/future/malformed entries
are not restored, and expired stored entries are removed when read. The key is
versioned and scoped to owner/tank; no tokens, passwords, provider keys or full
raw sensor context are stored.

Generation samples trusted server time before building the deterministic context,
avoiding a one-second render-clock race with a just-arrived upload. Completion
receives a server timestamp and displays it in Asia/Manila. A fingerprint of the
supplied observation IDs, effective limits and deterministic recommendations
marks the saved answer Outdated when evidence changes. It is not a React key.
Missing verification, expired retention or unknown clock also marks an existing
answer outdated. Prior explanations remain accessible as historical entries.

Only Explain with AI Guide / Refresh AI Recommendation starts an AI request.
Concurrent requests for one owner/tank share one pending promise. Closing or
navigating within the same authenticated account can complete that request once
and save its result; reopening attaches to it. Account verification runs before
generation and before caching completion. Logout/account switch clears the old
owner's cache and cancels pending requests; a late response cannot repopulate it.
The existing protected route listener performs this cleanup without adding a new
auth listener. Same-user refresh does not clear history.

Existing AI Edge Function/domain restrictions, explanation-only capabilities,
returned-action rejection, deterministic statuses and explicit threshold Apply
confirmation remain intact. The original panel is a fixed explanation request,
not a free-form chat; this change saves its previous explanation results. It does
not introduce a new chat workflow or change the Edge Function's history contract.

## Files touched for this task

- `src/components/SensorRecommendations.jsx`
- `src/services/recommendationHistory.js` (new)
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/DashboardOverview.jsx`
- `src/routes/ProtectedAdminRoute.jsx`
- `src/styles/sensorRecommendations.css`
- `tests/recommendation-history.test.mjs` (new)
- `tests/browser/recommendation-persistence.spec.mjs` (new)
- `tests/browser/sensor-recommendations.spec.mjs`
- `docs/SMART_SENSOR_RECOMMENDATIONS.md`
- `docs/TANK_DETAILS_AI_PERSISTENCE.md` (this report)

Some files also contain pending edits from the preceding water-depth task. No
earlier work was reverted, committed or published by this task.

## Verification

- Full Node suite: 205 passed, one retired endpoint test skipped. Six new cache
  tests cover owner/tank isolation, bounded history, expiry/malformed data,
  blocked storage, deduplication, error retention and cancelled late responses.
- Final combined production-browser suite: 61 passed. Includes ten new
  persistence checks, existing recommendation/AI restrictions, Auth isolation,
  Realtime cleanup/reconnect, threshold Apply, two-decimal depth/exports and
  Philippine-time/manual-control guard regressions. Supabase, Auth and AI are
  mocked; no production records or physical equipment were modified.
- Tests cover three-minute idle observation, the original 30-second failure,
  realtime changes/outdated marking, saved threshold changes, panel closure,
  tabs/manual Refresh, navigation/hard refresh, tank switching, in-flight
  reopening, logout, account switching and network verification errors.
- Full ESLint remains the existing 22 errors and 3 warnings. Changed persistence
  components/helpers/guard/tests pass targeted lint. Build and bundled security
  scan pass; the existing >500kB main-bundle warning remains (~653kB JS).

## Limits

History belongs to this browser tab and expires after 24 hours; it is not synced
to other browsers/devices and normally ends when the tab is closed. Blocked or
quota-limited storage falls back to this app instance's memory and cannot promise
restore after a hard reload. Completed answers restore after reload; an unfinished
AI request cannot be resumed after the browser destroys its JavaScript process.
Restoration waits for verified user/tank context and trusted time, rather than
using cached content as authorization or current sensor evidence.

No appropriate existing secure backend explanation store was wired to this panel.
The task forbids database-record changes, so no table, migration, backfill or
backend persistence write was introduced. A live authenticated AI-provider/device
soak test remains separate from these isolated regression checks. No ESP32,
sensor calibration, pump/feeder firmware, SQL deployment, Git push or website
deployment was performed.

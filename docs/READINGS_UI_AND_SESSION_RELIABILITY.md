# Fix #8 and #9 — Web readings and session reliability

2026-10-13. Implemented in the available React/Vite Web workspace. The actual
Expo SDK 54 application is not present here; Mobile integration and live
Web/Mobile simultaneous-session acceptance remain pending.

## Findings

- Five metric cards shared a narrow overview panel alongside a tall update
  panel. Auto-fit could create narrow columns, values were only 0.9rem, and
  explanations competed with values, ranges and badges.
- The update panel stretched beside the entire overview and imposed a 150px
  minimum inner height. Ammonia appeared among continuous IoT metrics.
- A legacy `.admin-dashboard-shell` breakpoint also matched the modern shell
  between 921–1180px, making the sticky sidebar consume a full row and moving
  the actual dashboard below it. Browser geometry and screenshots reproduced
  this existing conflict; the selector now excludes the modern shell.
- The Web Supabase client already exists once at module scope and enables
  `persistSession`, `autoRefreshToken` and URL session detection. These settings
  remain intact; no custom token refresh loop or second client was added.
- Web logout, login profile-validation failures and the password-reset cleanup
  used unscoped `auth.signOut()`. Supabase defaults this operation to global
  scope, revoking other sessions' refresh tokens. This is a verified code-level
  cross-device invalidation path, not a claim of observed Mobile runtime behavior.
  [Supabase sign-out scopes](https://supabase.com/docs/guides/auth/signout).
- The old route guard collapsed temporary Auth/profile failures into
  unauthenticated, and could sign out on a failed profile lookup. It listened
  only for SIGNED_OUT, leaving mounted account state unchanged on identity
  switches. Ordinary logout also navigated away even when sign-out failed.

## Changes

The four live water cards use the full overview width: one column in narrow
containers, two from 560px of available panel content, four from 880px. This
accounts for the sidebar rather than assuming viewport width equals card space.
Each card presents its current/last-known value, effective configured limit,
existing evaluated badge, explicit freshness, and saved Asia/Manila timestamp.
Details expand on demand. Ammonia is a separate manual/camera result with its
own scan date and explanation that it cannot establish a live condition.
Latest Update is compact. History retains its data, search, all filters and
pagination, with larger text, clearer columns and horizontal desktop scrolling;
mobile rows remain labeled cards. Existing theme variables are reused.

All Web sign-out calls now explicitly use local scope. A failed profile request
does not sign out; a definitively missing/disallowed login profile can reject
only the local session. The route verifier separately handles initialization,
confirmed absence/invalidity, denied profiles and temporary unavailability.
Temporary failures fail closed without clearing the stored session or redirecting
to login; Retry, online and visible/focus recovery recheck access. Initial access
verification has a 15-second UI deadline. Existing SDK request retries remain.

The guard owns one cleaned-up listener for its mounted lifecycle. Auth callbacks
do not await SDK operations; deferred verification coalesces initialization
events. Same-user refresh does not rebuild the protected tree or create another
monitoring subscription. A different user immediately unmounts the protected
tree, cancels obsolete verification and mounts a fresh tree only after verified
Auth identity and matching profile approval. Existing monitoring hooks clean
up their old owner channels and load the new owner's tanks/readings. A failed
ordinary logout remains on the dashboard with a retryable error.

Local browser logout can affect other tabs sharing that browser session through
the SDK's existing storage/broadcast mechanism. Independent Mobile sessions are
not copied into Web. No global-logout UI is added. Password update validation and
server-enforced revocation/security policies are preserved; local cleanup does
not override password-change policies.

## Files

- `src/pages/admin/SensorReadingsPage.jsx`
- `src/styles/readings.css`
- `src/styles/dashboard.css`
- `src/services/dashboardSession.js` (new)
- `src/services/authService.js`
- `src/routes/ProtectedAdminRoute.jsx`
- `src/layouts/AdminLayout.jsx`
- `src/pages/auth/ResetPassword.jsx`
- `src/styles/auth.css`
- `tests/auth-session.test.mjs` (new)
- `tests/browser/auth-session.spec.mjs` (new)
- `tests/browser/readings-layout.spec.mjs` (new)
- `tests/browser/fixtures.mjs`
- `tests/browser/qa.spec.mjs` (update the old live-Normal ammonia assertion to
  the existing dated-manual-scan contract while retaining historical severity)
- `docs/READINGS_UI_AND_SESSION_RELIABILITY.md` (this report)

## Verification and pending acceptance

- Production build and distribution security scan pass; existing >500kB bundle
  warning remains (approximately 646kB main JS).
- Full Node suite: 195 passed, one retired endpoint test skipped.
- Combined isolated production-browser suite: 80 passed. Covers the new UI and
  auth tests, existing reading synchronization, safe ranges, Philippine time,
  tour and Developer Mode. Tests simulate API outages, SDK access-token refresh,
  account switching, local logout/failure and channel cleanup without real
  credentials or production/hardware writes.
- Two additional existing login/history-filter browser checks passed after
  aligning the old ammonia assertion with Fix #7's manual-scan policy: 82
  distinct browser checks passed in total. The history row retains its recorded
  Normal status while the current scan card remains neutral and dated.
- Layout checks pass at 1600, 1024 and 390px in light/dark themes; desktop dark
  and phone light screenshots were visually inspected. Existing range tests
  also cover tablet/phone dimensions and unavailable readings.
- Full ESLint remains 22 existing errors and 3 warnings. New session service,
  guard and test files pass targeted lint. No blanket rule suppression was added.

No SQL, RLS, saved reading, threshold configuration, severity rule, freshness
policy, pump/feeder logic or Auth project setting was changed. GitHub publication
was subsequently requested by the user. Hosting deployment must be verified
separately after the push; no SQL or Auth configuration deployment is included.

Pending on real devices: sign into the same account independently on Web/Mobile,
refresh Web and restart Mobile, locally log out/re-login on each device, switch
networks/background/foreground, and compare owner-scoped tank/reading IDs.
The project's remote single-session/expiry policies were not inspected or
changed; a policy restricting concurrent sessions would need separate verified
review. Mock SDK tests cannot establish those production acceptance results.

When the Expo project becomes available, inspect its storage and singleton
client first. Follow the existing Supabase React Native guidance for persistent
storage, SDK refresh with one managed AppState lifecycle and subscription
cleanup. Do not introduce cross-platform token synchronization.
[Official React Native Auth setup](https://supabase.com/docs/guides/auth/quickstarts/react-native).

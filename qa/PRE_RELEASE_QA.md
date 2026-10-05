# CrayThrive pre-release QA

Date: 2026-10-05. Starting commit: `6a3c088`. Changes are local and uncommitted.

Follow-up mobile/CSV/print work is documented in [Mobile responsiveness QA](MOBILE_RESPONSIVENESS_QA.md). That pass adds combined exports and dedicated A4 portrait output; the results below describe the original pre-release pass.

**NOT READY FOR VERCEL DEPLOY.** Local build, automated regressions, browser tests, and dependency audit pass. ESLint still fails, and live Supabase integration/authorization has not been verified. No deployment, Git push, database migration, or live database write was performed.

Browser PASS below means a real Chrome browser running a separate production bundle with synthetic Supabase Auth/REST responses. This verifies frontend behavior; it does not establish that the live schema, RLS, Storage policies, or email provider work. Test requests cannot reach the real Supabase project. Forms write only to in-memory fixtures. PSGC address responses and external font requests are also intercepted.

## 1. Commands and tests executed

| Command | Final result |
| --- | --- |
| `npm run build` | PASS; production bundle and built-output secret scan |
| `npm run lint` | FAIL; 24 errors, 5 warnings |
| `npx --no-install eslint src` | FAIL; the same 24 errors, 5 warnings |
| `npm test` | PASS; 19 tests, zero failures/skips |
| `npm run test:security` | PASS; 9 security tests, also included in `npm test` |
| `node --test tests/monitoring.test.mjs` | PASS; 10 monitoring/export/print regressions |
| `npm run test:browser` | PASS; 48 tests, zero failures/skips/flaky tests, about 2.9 minutes |
| `npm audit --json` | PASS; zero vulnerabilities after adding the browser test dependency |
| `node scripts/security-scan.mjs --dist` | PASS; zero detected private credential signatures in scanned current files/dist |
| `git diff --check` | PASS; Git's LF-to-CRLF notices remain informational |

Dependencies already existed. A full dependency reinstall was unnecessary. Added only the authorized Playwright development dependency with `npm install --save-dev @playwright/test --ignore-scripts`. The npm registry initially failed under restricted network access; the authorized network retry succeeded. Targeted tests were run before/after each reproduced fix, then the complete suites were rerun.

## 2. Feature results

| Feature | Result | Evidence and limits |
| --- | --- | --- |
| Routing / direct refresh | PASS, mocked browser | 17 major routes load and refresh; invalid URLs fall back to Landing; invalid tank/listing IDs show useful states |
| Back / Forward / login alias | PASS, mocked browser | Tanks/Readings history navigation and `/admin/login` alias |
| Protected routes / role checks | PASS, mocked browser | Every protected route rejects absent sessions; expired/rejected session and disallowed profile role redirect to Login |
| Authentication | PASS locally; live pending | Empty/invalid/valid login, disabled submit while waiting, persisted reload, logout, generic recovery response |
| Dashboard | PASS, mocked browser | Latest per-tank safety; old critical history no longer determines current health |
| Tanks / Tank Details | PASS, mocked browser | Multiple tanks, one tank, empty collection, paired identifiers, unpaired/no-reading case; matching values and severity |
| Threshold Settings | PASS, mocked browser | Alias/fallback regression tests; saving settings changes existing-reading safety on all five monitoring pages |
| Sensor Readings | PASS, mocked browser | Water/ammonia history, all parameter filters, severity filters, tank filter, refresh, pagination |
| Ammonia | PASS locally; live schema pending | Correct tank matching, independent history/time, threshold evaluation, missing scan neutral |
| Reports | PASS for existing modes | All/specific tanks, marketplace, date/condition filters, refresh, empty state, analytics rendering |
| CSV | PASS | Actual browser downloads plus multiline/quote/comma/formula protection tests |
| Print preparation | PASS | Actual browser popups for all tanks, selected tank, marketplace; combined sections tested through shared print helper |
| Marketplace / Seller Profile / Listings | PASS, mocked browser | Legacy null category, search, product details, safe links, seller profile save, add/edit, hide/activate/soft remove |
| Orders | PASS for existing read-only page | Pending reservation display, buyer/seller fields, status filtering; live order/reservation creation pending |
| Responsive / themes | PASS in tested fixtures | All 17 routes at four sizes in light/dark; no page-level horizontal overflow after fixes |
| Browser runtime | PASS in fixtures | No unexpected exceptions, React key/nesting warnings, console errors, or failed local HTTP responses; intentionally rejected auth requests are expected |
| Security sanity | PASS locally; live pending | No `dangerouslySetInnerHTML` in `src`; safe seller links; redacted diagnostics; source/dist scan and public-env tests |
| Build / dependency audit | PASS | Final production build; zero npm audit vulnerabilities |
| ESLint | FAIL | Remaining baseline findings are listed in section 16 |

Web Sign Up and a separate Users/Admin-management page are not routed features of this app. Threshold editing is available at `/admin/settings`; the standalone `ThresholdSettingsPage.jsx` is not a registered route. The allowed dashboard role remains `user`.

## 3–4. Bugs found, fixed, and retested

1. **Field priority disagreement:** pH preferred `ph` instead of the requested `ph_value`; Tanks/Tank Details separately read pH again. Both displayed values and safety inputs now use the shared normalized values. Temperature keeps `temperature_c → temperature`; water keeps `water_depth_cm → water_level → waterValue`. The first valid numeric value wins. Distance is never a water-depth fallback.
2. **Invalid numeric coercion:** booleans and arrays could become numeric zero. Only finite numbers or nonblank numeric strings are accepted. Actual zero is retained. Invalid/missing metrics display neutral `No Data`; a missing reading now also has a complete neutral safety result.
3. **Blank threshold coercion:** empty/invalid saved limits became zero. Parsing now retains operational defaults for those values. Settings imports the same defaults and normalizer used by monitoring instead of its duplicate parser.
4. **Stale Dashboard health:** historic unsafe readings and stored alerts could keep current tank health Critical after the latest values became Normal. Current health now evaluates each tank's latest water reading and latest independent ammonia scan. Historical issue counts and alerts remain available separately.
5. **CSV text loss:** whitespace normalization erased embedded newlines. CSV now preserves multiline content and escapes commas, quotes, LF/CR, and spreadsheet formula prefixes while retaining signed numeric values. Print continues to escape user HTML.
6. **Mobile Tanks/Alerts overflow:** inline desktop grid columns overrode responsive styles. Column sizing now follows the existing responsive CSS; page grids can shrink to the available width. Both pages pass the 390px checks in both themes.
7. **Listing preview memory leaks:** mount-only cleanup captured an empty preview URL. Add/Edit Listing cleanup now tracks `imagePreview`, releasing blob URLs on replacement/unmount. Both SPA-navigation regression tests pass.
8. **Clock initializer purity:** Tank Details evaluated `Date.now()` during every render. A lazy initializer now samples once; its existing timer still updates the clock. This removes one existing lint error.

Valid database reading values and stored raw `*_status` fields are not overwritten or deleted. Primary safety remains **safe/normal → Normal; warning → Warning; critical/danger/unsafe → Critical**, with missing data neutral. The existing evaluator currently marks threshold breaches Critical; no new Warning thresholds were invented. Parameter explanations remain. Browser tests assert visible badges and icons and prove stale raw statuses cannot override current threshold evaluation.

## 5. Exact files changed

Application fixes:

- `src/pages/admin/AddMarketplaceListingPage.jsx`
- `src/pages/admin/AlertsPage.jsx`
- `src/pages/admin/DashboardOverview.jsx`
- `src/pages/admin/EditMarketplaceListingPage.jsx`
- `src/pages/admin/SettingsPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/pages/admin/TanksPage.jsx`
- `src/styles/alerts.css`
- `src/styles/tanks.css`
- `src/utils/exportPrintUtils.js`
- `src/utils/sensorReadingUtils.js`
- `src/utils/thresholdEvaluation.js`

Test setup and documentation:

- `.gitignore`
- `eslint.config.js`
- `package.json`
- `package-lock.json`
- `playwright.config.mjs` (new)
- `scripts/qa-server.mjs` (new)
- `tests/browser/fixtures.mjs` (new)
- `tests/browser/qa.spec.mjs` (new)
- `tests/browser/stop-server.mjs` (new)
- `tests/monitoring.test.mjs` (new)
- `README.md`
- `qa/PRE_RELEASE_QA.md` (new)

SensorReadingsPage, ReportsPage, status/tone helpers, routing, Supabase architecture and production Vite/Vercel config were inspected and tested; they did not require direct edits in this QA pass. Their monitoring behavior receives the shared utility fixes.

## 6–8. Tanks, Readings, Ammonia

PASS locally. `0.6 cm` with `waterLevelMin=4.5` is Critical. `pH=4.8` with `phMin=6.5` is Critical. `26.3°C` inside 20–30 is Normal. Raw Safe Ideal fields cannot change those results. Changing saved limits makes the same existing readings Normal after reload.

Readings filters preserve their separate parameter/severity/tank structure. Temperature, pH, clarity and water-level filters return only water records; Ammonia returns separate scan records. Warning returns an empty result for the current all-Normal/Critical fixture, correctly respecting the existing severity rules. Missing scans show No Scan. Historical water records do not inherit a tank's latest ammonia scan.

Ammonia compatibility is tested against the app's existing `AMMONIA_READING_FIELDS` definitions and `ammonia_readings` usage. The actual live table/schema cannot be confirmed from this workspace: no migrations/schema or staging database access were provided. The fixture is not evidence of live-schema correctness.

## 9–11. Reports, CSV, Print

PASS for the existing tank/marketplace report modes. Selected-tank outputs exclude other tanks. Date and condition filters affect history; refresh updates scans; empty export is handled. Charts/donuts render without runtime errors and retain Normal/Warning/Critical legends, including zero-count legends.

Tank CSV retains Type, Tank, Temperature/Condition, pH/Condition, Water Clarity/Condition, Water Level/Condition, Ammonia/Condition, Overall Condition and Date. Water rows leave ammonia blank; Ammonia Reading rows contain only their own scan fields/time. Actual CSV bytes preserve commas, quotes and embedded newlines.

Actual print popup preparation includes ammonia values, conditions and timestamps and preserves marketplace statuses such as Pending. Shared print generation also passes a two-section combined tank/marketplace test and HTML-escaping tests. **There is no combined tank-and-marketplace report mode in the current Reports UI**; an end-user combined report workflow therefore remains unavailable. Physical printing/PDF layout still needs manual review.

## 12. Marketplace

PASS with mocked requests. Old null categories remain crayfish. Category/search filtering, product details, seller links, seller-profile validation/save, listing creation/edit, hide/activate and soft removal were executed. Removal sends PATCH with status deleted, not DELETE. Orders preserve marketplace status vocabulary and show buyer/seller/reservation information. The current web Orders page is read-only; real reservation creation and state changes must be verified in their existing mobile/backend flow.

Image preview selection and cleanup are tested. The listing submission fixture does not upload to real Storage; live upload permissions, supported formats, quotas and image availability still need staging verification.

## 13. Responsive UI

PASS for the tested production fixtures at 1440×900, 1366×768, 768×1024 and 390×844. Every major route is visited in both themes. Long tank/store names are included. Tests assert no page-level horizontal overflow; intentionally scrollable tables/tab strips can still scroll internally. Light/dark mobile Report screenshots were inspected. This is not a full visual/accessibility audit of every possible record or modal, and remote fonts are stubbed for deterministic offline coverage.

## 14–15. Security sanity and build

PASS locally. Final production JavaScript is approximately 541.57 kB (146.85 kB gzip); CSS is approximately 230.33 kB. No private credential signatures were detected in the scanned current source/public/dist files. Supabase public configuration is intentionally browser-visible. The existing public-env guard and Vercel metadata regression tests still pass. URL tests reject executable/non-HTTP schemes and embedded credentials. No unsafe user-controlled HTML rendering was found in `src`.

These checks do not prove live RLS, Storage authorization, AI backend authorization or absence of every possible secret encoding. The previous pre-production security audit's live-backend limitations still apply.

## 16. ESLint result and remaining inventory

**FAIL: 24 errors and 5 warnings** for both project lint and `eslint src`. Baseline was 25 errors and 6 warnings. The remaining rule findings predate this pass; no new findings remain in the QA harness or shared utility fixes. No rules were disabled. The first remaining error is `AdminLayout.jsx:109`, synchronous state updates in an effect. Its existing mobile-menu state synchronization still needs refactoring. Other existing loader/pagination effects and missing hook dependencies also remain unresolved; passing browser tests do not clear those lint failures.

| File under `src/` | Error lines / rules | Warning lines |
| --- | --- | --- |
| `layouts/AdminLayout.jsx` | 109, set-state-in-effect | — |
| `pages/admin/AddMarketplaceListingPage.jsx` | 375, unused mobileOnly; 576, immutability/declaration ordering | — |
| `pages/admin/AlertsPage.jsx` | 1241, 1245, set-state-in-effect | — |
| `pages/admin/DashboardOverview.jsx` | 618, set-state-in-effect | — |
| `pages/admin/EditMarketplaceListingPage.jsx` | 19, unused Tag; 414, immutability/declaration ordering | 415, exhaustive-deps |
| `pages/admin/MarketplaceListingDetailsPage.jsx` | — | 328, exhaustive-deps |
| `pages/admin/MarketplaceOrdersPage.jsx` | 998, 1002, set-state-in-effect | — |
| `pages/admin/MarketplacePage.jsx` | 13, unused CircleDollarSign | — |
| `pages/admin/OrdersPage.jsx` | 804, 808, set-state-in-effect | — |
| `pages/admin/ReportsPage.jsx` | 1660, 1828, set-state-in-effect | — |
| `pages/admin/SellerProfilePage.jsx` | — | 438, exhaustive-deps |
| `pages/admin/SensorReadingsPage.jsx` | 976, 980, set-state-in-effect | — |
| `pages/admin/SettingsPage.jsx` | 1607, set-state-in-effect | — |
| `pages/admin/TankDetailsPage.jsx` | 1985, 1989, 2031, 2422, set-state-in-effect | 1986, 2022, exhaustive-deps |
| `pages/admin/TanksPage.jsx` | 1067, set-state-in-effect | — |
| `pages/admin/ThresholdSettingsPage.jsx` | 1863, set-state-in-effect | — |

## 17–18. Browser tests and npm audit

PASS: 48 Playwright/Chrome tests with no skips, flaky tests or unexpected failures. A separate ignored `.security-qa-dist` bundle has fake public Supabase config; all backend HTTP/WebSocket requests are intercepted. The main `dist` build is untouched by this fixture. The test server uses the actual `vercel.json` response headers and SPA fallback, and shuts down after tests. Browser test infrastructure uses [Playwright network mocking](https://playwright.dev/docs/mock) and [test configuration](https://playwright.dev/docs/test-configuration).

PASS: npm audit reports zero vulnerabilities after installation of the development-only test dependency. No production dependency upgrade was needed for this QA run.

## 19. Remaining warnings / issues

- ESLint failures above remain a release gate.
- Live Auth, email delivery/reset link, schema/RLS, Storage and AI checks are unverified; no staging setup was supplied.
- Combined UI export/print was absent in this original pass. The subsequent [mobile/export pass](MOBILE_RESPONSIVENESS_QA.md) adds and browser-tests it.
- `device_commands` remains explicitly unverified in the existing schema constants. No feeding/pump/drain commands were sent.
- Vite still warns about the single JavaScript chunk exceeding 500 kB. Code splitting/performance work remains.
- `public/craythrive-logo.png` is 5,385,752 bytes (about 5.1 MiB); this may affect first-load performance and exceeds the listing uploader's 5 MiB limit. The branding asset was not changed.
- Playwright emits an environment-only NO_COLOR/FORCE_COLOR notice; application console checks pass.
- LF-to-CRLF Git notices are informational. Test outputs, screenshots and the fixture build are ignored by Git.

## 20. Manual browser / staging tests still required

1. Supply the staging schema/migrations and dedicated QA accounts; verify `ammonia_readings`, threshold columns/JSON and ownership/device relationships against actual rows.
2. Execute real valid/invalid login, token refresh/expiry, persisted session and logout. Verify password recovery email, real reset-link expiry, allowed redirect origin and successful password reset.
3. Verify per-user RLS using two accounts, protected roles, private profile visibility, owner-only listing/profile changes and public marketplace reads. Run no destructive production tests.
4. Verify actual image upload/read permissions and seller address-provider behavior. Confirm rejected schemes cannot be saved or opened with actual persisted records.
5. Validate live water/ammonia rows for multiple tanks, missing scans, separate timestamps and saved-threshold reload without an ESP32 upload.
6. Exercise reservation/order creation and transitions through the existing mobile/backend workflow; this web Orders page is read-only.
7. Review printed/PDF output for long names, many rows, combined helper sections and marketplace reports. Check keyboard/screen-reader use, filter menus, notifications, seller controls and real data at all four widths.
8. Resolve the listed lint failures, rerun the commands above, and repeat live-browser smoke tests against the intended deployment configuration before publishing.

## 21. Final status

**NOT READY FOR VERCEL DEPLOY.** The local QA run and confirmed frontend fixes are complete, but ESLint and live-backend release gates remain open. No deployment was performed.

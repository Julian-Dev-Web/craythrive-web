# Web dashboard tour

Implemented 2026-10-08 for the React + Vite web project only. No React Native,
Expo, APK, SQL, RLS, Edge Function or Developer Mode files were changed.
No dependency or tour library was added. The implementation was validated locally
before GitHub publishing. No direct Vercel deployment commands were run.

## Login invitations and replay

`AdminLogin` creates a non-security UX login ticket only after
`signInWithDashboardAccess` succeeds with a verified dashboard profile.
It stores no password, token, role decision or developer identity.
The protected layout's tour provider consumes that ticket for the matching
current user after arrival at `/admin`.

- First introduction in this browser: noticeable, non-blocking welcome card
  with **Take a Tour** and **Skip for Now**. The tour never starts automatically.
- Future explicit successful login: smaller **Welcome back!** card with
  **Take a Tour** and **Maybe Later**.
- localStorage stores `craythrive_web_tour_seen` and
  `craythrive_web_tour_completed`. sessionStorage stores
  `craythrive_web_tour_login`: login ID, user ID, invitation kind, offered and
  dismissed flags. These values cannot grant authentication or authorization.
- A ticket is claimed once. Rerenders, data refreshes, route changes, browser
  reloads, restored sessions and token refreshes do not create another ticket.
  Leaving the invitation's dashboard entry also removes it from view; returning
  does not repeat it even when neither invitation button was clicked.
- Dismissal and starting the tour mark the current ticket dismissed. Signing
  out clears it. Another explicit successful login creates a fresh ticket.
- **Settings → Help & Learning → Take a Tour** always starts at step 1,
  regardless of completion, dismissal or an absent login invitation.
- Blocked browser storage has an in-memory fallback. Persistence across reloads
  is naturally unavailable when the browser forbids storage.

The provider never creates invitations from Auth listeners. Its listener only
closes existing tour UI on sign-out or a different signed-in account.

## Seven steps

| Step | Title | Route/target |
| --- | --- | --- |
| 1 | Welcome to CrayThrive | Dashboard condition overview |
| 2 | Manage Your Tanks | Tanks / Add Tank button; pairing can happen later |
| 3 | Monitor Tank Conditions | Existing tank's Water condition heading, when available |
| 4 | Review Monitoring History | Sensor Readings overview |
| 5 | Generate Reports | Reports overview; existing CSV and Print / Save as PDF |
| 6 | Crayfish Marketplace | Marketplace overview |
| 7 | Settings & Thresholds | Settings overview and permanent replay location |

Ammonia is explicitly described as manually scanned, with its own timestamp
and separate historical events. No AI/Guide step is included because this web
application has no AI/Guide screen. The unused AI context utilities are not a
user-facing feature. No future tutorial CMS or placeholder video links were added.

All steps have progress, Back, Next (Finish Tour on the last step), and immediate
Skip Tour. Back is disabled on step 1. Escape skips; Enter activates the focused
control or advances from the card. Focus stays within the temporary dialog and
returns to the originating control if still mounted, otherwise replay or main
content. Background interaction is inert only while the tour is open.

## Targeting and fallback

One portal overlay follows the existing routes using replace navigation.
It measures `data-tour` elements through their actual DOM bounds, observes
content/layout changes and follows resizing/scrolling. Mobile uses page controls
instead of an off-screen sidebar. Cards use theme tokens, opaque backgrounds,
wrapping controls, viewport bounds and internal scrolling for short screens.

The monitoring step only opens a route from an existing rendered **View Tank**
link. With no available link/tank it remains on Tanks and explains the feature
using a centered card. Missing, loading, deleted or unmounted targets fall back
to an informational card. No sample tank or application record is created.
The tour ends on the current page. Active step progress is not resumed after a
browser reload; manual replay starts again at step 1.

## Exact files changed

New:

- `src/components/tour/DashboardTourProvider.jsx`
- `src/components/tour/DashboardTourOverlay.jsx`
- `src/components/tour/DashboardTourInvitation.jsx`
- `src/components/tour/DashboardTourHelp.jsx`
- `src/context/DashboardTourContext.js`
- `src/utils/dashboardTour.js`
- `src/styles/dashboardTour.css`
- `tests/dashboard-tour.test.mjs`
- `tests/browser/dashboard-tour.spec.mjs`
- `docs/WEB_DASHBOARD_TOUR.md`

Updated:

- `src/pages/auth/AdminLogin.jsx`: successful-login UX ticket only.
- `src/layouts/AdminLayout.jsx`: provider, invitation slot and focus fallback.
- `src/pages/admin/SettingsPage.jsx`: Help & Learning section and target marker.
- `src/pages/admin/DashboardOverview.jsx`: target marker only.
- `src/pages/admin/TanksPage.jsx`: Add Tank / existing detail-link markers only.
- `src/pages/admin/TankDetailsPage.jsx`: target marker only.
- `src/pages/admin/SensorReadingsPage.jsx`: target marker only.
- `src/pages/admin/ReportsPage.jsx`: target marker only.
- `src/pages/admin/MarketplacePage.jsx`: target marker only.

Sensor calculations, threshold evaluation, ammonia processing, tank creation,
marketplace/report calculations, backend authorization and Developer security
were not changed. Existing files may gain a final newline.

## Validation

- `npm run build`: passed; bundled credential scanner has no findings.
- `npm test`: 92 passed, 1 existing retired-endpoint skip.
- Tour browser suite: all 16 tests passed against a production Vite bundle.
  Includes real login-form interaction with a mocked Supabase backend, invalid
  login, skip, explicit re-login, token-refresh event, restored/direct entry,
  manual replay after finishing/skipping, Back, Escape/Enter/Tab, cross-tab
  sign-out, zero tanks, missing targets and desktop-to-phone resizing.
- All seven steps pass at 390×844, 768×1024, 1366×768 and 1440×900 in both light
  and dark mode. Phone tests also use 150% root text size. Buttons stay in the
  viewport, no horizontal overflow, no browser errors and no application writes.
  Phone and desktop screenshots were visually inspected.
- Full browser regression suite: 123 passed, 18 existing retired-form skips.
- ESLint: new tour components, context, utilities, login integration and tour
  tests have no errors or warnings. Full repository retains 24 existing errors
  and 5 warnings in earlier page/layout code. None were added by this feature.
- Existing Vite chunk-size (>500 kB) and test-runner color warnings remain.

Tests use mocked API responses; production Supabase login and physical-device
screen readers were not exercised. No direct deployment commands were run.

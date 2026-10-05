# Pre-production security audit - 5 October 2026

Frontend hardening is implemented. **Production security clearance is pending backend verification.** No deployment, database execution, data deletion, credential replacement or Git history rewrite was performed.

## Scope and evidence

Inspected web source, public assets, configuration, package scripts, documentation, tracked files, the local environment file and final build output. The original workspace contained no Supabase migrations, SQL schema, Edge Function source or Vercel serverless API. New SQL/scripts here are review material, not evidence of live database configuration.

The redacted pattern scan examined 288 reachable Git text blobs plus commit messages. Fourteen historical binary assets/APKs were excluded. It checks common private key formats, non-anon JWTs, credential assignments, connection URLs and hardcoded bearer tokens. It cannot rule out encrypted/split/unusually formatted secrets, secrets in binaries, or deleted/unreachable Git objects. Dependency packages are audited with npm. No `dangerouslySetInnerHTML` use or direct secret-dependent provider call was found in web source.

## 1. Exact files changed

The exact manifest appears at the end. `.env` was removed from Git tracking and remains intact locally. Some initial fixes were already included in a new HEAD commit during the audit; the manifest includes them and the subsequent working changes.

## 2. Client configuration classification

| Variable | Classification | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Safe client configuration | Supabase HTTPS project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Safe client configuration | Preferred browser API key |
| `VITE_SUPABASE_ANON_KEY` | Safe client configuration / unused when publishable is set | Legacy fallback |
| `VITE_APP_SITE_URL` | Safe client configuration, optional | Canonical recovery origin; existing fallback retained |
| Any other `VITE_*` | Unsupported / remove from client configuration | Rejected until explicitly reviewed |
| Vite `MODE`, `BASE_URL`, `DEV`, `PROD`, `SSR` | Nonsecret built-ins | Build/runtime flags |

**VITE values are public browser data.** The build/runtime reject unsupported names, non-public Supabase key types and URLs containing credentials/query strings/fragments. HTTPS is required except localhost development. The anon JWT check classifies key type; it does not verify a signature. Supabase verifies sessions.

The existing `.env` contains JavaScript declarations referencing `import.meta.env`, not dotenv assignments. Vite loaded no VITE values from it. Configure actual values before authenticated testing; no fake runtime credentials were introduced. `.env.example` has blank values. Missing configuration now reaches the existing not-configured screen instead of a module-load crash.

## 3-4. Private secrets and rotation

No private credentials were found in the examined workspace/history or final bundle. **No specific private secret requiring rotation was identified.** This is bounded scan evidence, not a guarantee about other repositories/deployed settings. Publishable/anon keys are intentionally public and require RLS for private data protection.

If a real private key appears in another repository, deployed bundle, screenshot, history object or environment, mark it **ROTATION REQUIRED** and revoke/rotate it at the provider. Removing a value or untracking `.env` does not revoke a credential. No history rewrite was performed and full credentials were not printed.

## 5-6. RLS and proposed SQL

Live RLS/policy weaknesses could not be confirmed or excluded: no actual policies/schema/admin connection was supplied. Owner filters and hidden buttons are not authorization. Several pages contain unscoped admin query branches based on profile roles, although this dashboard currently permits only role `user`. Backend policies must enforce ownership and prevent client role escalation regardless of UI behavior.

`inspect-supabase.sql` is read-only. It inventories every public relation plus profiles, tanks, devices/iot_devices, readings, ammonia, alerts, thresholds, marketplace, chat, notifications, tokens and control/command tables. It reports RLS, policies, columns, grants, views, functions, triggers and bucket settings. Review policies together: adding an owner policy cannot neutralize another permissive `USING (true)` policy.

`proposed-rls-hardening.sql` is a **guarded review-only migration draft**, outside automatic migrations. It intentionally aborts immediately and checks assumed columns. Restrictive guards intersect existing permissive policies and add no access grants. It illustrates owner/tank checks, profile role protection, seller/listing ownership, buyer/listing relationships, chat sender checks and scoped Storage writes. **No SQL was executed.**

Do not apply the draft as a finished migration. Chat columns/order relationships are assumptions, not verified schema. Legacy device-only rows, ingestion identities, public seller fields and mobile workflows need review. Direct order updates/thread creation are denied in the draft until verified backend workflows are integrated. Owner-only seller SELECT requires an intentional public projection to preserve shop links. Schema mismatch/duplicate policy failures roll back the transaction. Finalize on a staging clone against the real schema before removing the review gate.

## 7. Marketplace and Storage

Listing writes use authenticated seller IDs and owner filters; seller profile writes use authenticated user IDs. These frontend checks do not prove backend enforcement. Seller details currently select all columns, so private/public fields need explicit review. Orders are largely read-only in this web UI. Chat names exist in constants but backend creation/sender enforcement is absent. Order pricing, inventory, ownership immutability and status transitions need authorized atomic backend transactions; participant membership alone is insufficient.

Uploads already use authenticated-user folders, `upsert: false`, JPG/PNG/WEBP and a 5 MB client limit. Direct API calls bypass client validation. No Storage policies were available. Verify server MIME/size limits plus folder AND owner checks for overwrites/deletes. Existing images/buckets/URLs were not moved or deleted. Public image READ may remain if intentional; audit legacy ownership before write restrictions.

## 8. AI Edge Function

`supabase/functions/craythrive-ai-guide/` is absent. No AI API key, direct Groq/OpenAI/Resend/SMTP request or AI function invocation was found in this web source. The frontend reads pending suggestions from thresholds. **No Edge Function security fix is claimed.**

Obtain the actual function/config. Verify the caller token with Supabase Auth; derive user identity from verified claims, never a request-body user ID. Scope threshold reads/writes, preserve parameter/domain allowlists, reject arbitrary database/admin operations and user-chosen provider URLs, redact errors/logs and bound request size/rate. Keep provider credentials in Supabase Secrets. Do not invent a replacement function contract.

## 9-10. Vercel/server environment

Configure the four client-safe variables in section 2 as needed; prefer a publishable key and omit the anon fallback when unnecessary. No Vercel serverless function exists here requiring private Vercel variables. Use separate preview/staging and production Supabase projects where practical.

**Never prefix these with VITE:** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `AI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `SMTP_PASSWORD`, `DATABASE_URL`, `DB_PASSWORD`, `JWT_SECRET`, `PRIVATE_KEY`, `SECRET_KEY`, `ACCESS_TOKEN`, `WEBHOOK_SECRET`. Put server credentials in Supabase Secrets for Edge Functions, or ordinary server-only variables in a real server backend. AI URL/model configuration can remain server configuration; URLs must not contain credentials.

## Headers, XSS, recovery and logging

Vercel now sets nosniff, strict-origin referrer policy, disabled unused camera/microphone/geolocation/payment/USB permissions, frame denial, and CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`. The SPA rewrite remains intact.

Strict script/style/connect source restrictions were intentionally omitted pending integration tests for Print inline scripts/styles, React styles, Google Fonts, Supabase HTTP/WebSocket/Storage and PSGC. This minimal CSP does not claim complete script-injection protection. Custom HSTS/subdomain policy was not added without validating all domains.

Seller links now allow only HTTP/HTTPS on save and render. Bare domains normalize to HTTPS; executable schemes, controls, backslashes and embedded credentials are rejected. React renders descriptions/chat/profile content as text. Print already HTML-escapes values. CSV now makes formula-like user text literal while preserving signed numeric readings.

Password recovery no longer queries profiles to disclose account existence and gives a generic success message. Live email/rate behavior still needs verification. Protected routes use server-verified `getUser()` through the auth service and react to sign-out; RLS remains the security boundary. Diagnostic output contains fixed labels and bounded code/status fields, not full errors/sessions/tokens. Provider error text is replaced with friendly local messages.

## 11-12. Dependencies and validation

Initial npm audit: 9 affected packages (6 high, 1 moderate, 2 low), no critical. Compatible `npm audit fix --ignore-scripts` updates used no force/major upgrades. Vite is 8.3.2; React Router/DOM is 7.18.4. Final audit: **zero vulnerabilities**. Commit the lockfile, use `npm ci` and recheck advisories before release.

Production build and final dist credential scan passed. Seven security regression tests passed. ESLint retains **25 existing errors and 6 warnings**, with no new findings. The JS bundle still triggers Vite's 500 kB warning. Local headless Chrome checks passed on landing, login, forgot-password, protected and reset-password routes using the production bundle and configured headers, with no runtime exceptions. Live Supabase was not contacted. These checks do not verify live RLS, email delivery or Edge Function authorization.

## 13-14. Remaining risks and manual steps

1. Supply actual public values in `.env.local` and Vercel; the local `.env` is malformed. Use Vercel's Vite preset, `npm run build`, output `dist`, and a supported Node runtime matching tested Node 24. Do not deploy before backend verification.
2. Run `inspect-supabase.sql` in Supabase SQL Editor and obtain the actual AI source/config. Export policy/schema results for review; redact private literals in definitions before sharing.
3. On a staging clone, finalize RLS/grants against actual schema, protect owner identities/profile roles and exposed functions/views, and preserve device ingestion/mobile flows. Do not bypass the draft gate without this review.
4. Test direct API access with users A/B and anon: A cannot read/update/delete B's tank data/thresholds, elevate roles, forge listing/order identities, access nonparticipant chat or spoof senders. Confirm permitted owner actions too. Verify server order pricing/inventory/state transitions and thread membership creation.
5. Separate intentional public seller contact/shop fields from private profile data using a reviewed projection. Preserve seller forms, links and public marketplace browsing.
6. Inspect `marketplace-images`: intentional public READ, server 5 MB/MIME limits, folder/owner write checks, cross-user overwrite/delete denial and legitimate legacy image access. Do not move/purge files to fix policies.
7. Put actual provider secrets only in Supabase Secrets. Verify authenticated same-user AI access, allowlists, bounded usage and redacted errors/logs. Rotate any real private credential exposed elsewhere; this web scan did not identify one.
8. In Supabase Auth, verify Site URL and explicit recovery redirects, confirmation settings, email delivery and rate limits. Avoid broad production wildcard redirects. Test login/logout, expired sessions and generic recovery responses for both known/unknown emails.
9. In a future authorized preview, verify security response headers and all working flows: Supabase/realtime, uploads, seller links, marketplace, threshold save/refresh, CSV and Tank/Marketplace Print. Inspect JS for private credentials and browser console for CSP/runtime regressions. No preview/deployment was performed here.

## Official references

- [Supabase keys](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage](https://supabase.com/docs/guides/storage/security/access-control)
- [Authenticated Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt)
- [Vercel CSP](https://vercel.com/docs/cdn-security/security-headers)
- [OWASP CSV injection](https://community.owasp.org/attacks/CSV_Injection)

## Exact change manifest

<!-- Generated manifest follows. -->

- `.env` (removed from tracking; local file retained)
- [.env.example](../.env.example)
- [.gitignore](../.gitignore)
- [README.md](../README.md)
- [eslint.config.js](../eslint.config.js)
- [package-lock.json](../package-lock.json)
- [package.json](../package.json)
- [scripts/security-scan.mjs](../scripts/security-scan.mjs)
- [security/PRE_PRODUCTION_AUDIT.md](../security/PRE_PRODUCTION_AUDIT.md)
- [security/inspect-supabase.sql](../security/inspect-supabase.sql)
- [security/proposed-rls-hardening.sql](../security/proposed-rls-hardening.sql)
- [src/components/NotificationBell.jsx](../src/components/NotificationBell.jsx)
- [src/lib/supabase.js](../src/lib/supabase.js)
- [src/pages/admin/AddMarketplaceListingPage.jsx](../src/pages/admin/AddMarketplaceListingPage.jsx)
- [src/pages/admin/AlertsPage.jsx](../src/pages/admin/AlertsPage.jsx)
- [src/pages/admin/DashboardOverview.jsx](../src/pages/admin/DashboardOverview.jsx)
- [src/pages/admin/EditMarketplaceListingPage.jsx](../src/pages/admin/EditMarketplaceListingPage.jsx)
- [src/pages/admin/MarketplaceListingDetailsPage.jsx](../src/pages/admin/MarketplaceListingDetailsPage.jsx)
- [src/pages/admin/MarketplaceOrdersPage.jsx](../src/pages/admin/MarketplaceOrdersPage.jsx)
- [src/pages/admin/MarketplacePage.jsx](../src/pages/admin/MarketplacePage.jsx)
- [src/pages/admin/OrdersPage.jsx](../src/pages/admin/OrdersPage.jsx)
- [src/pages/admin/ReportsPage.jsx](../src/pages/admin/ReportsPage.jsx)
- [src/pages/admin/SellerProfilePage.jsx](../src/pages/admin/SellerProfilePage.jsx)
- [src/pages/admin/SensorReadingsPage.jsx](../src/pages/admin/SensorReadingsPage.jsx)
- [src/pages/admin/SettingsPage.jsx](../src/pages/admin/SettingsPage.jsx)
- [src/pages/admin/TankDetailsPage.jsx](../src/pages/admin/TankDetailsPage.jsx)
- [src/pages/admin/TanksPage.jsx](../src/pages/admin/TanksPage.jsx)
- [src/pages/admin/ThresholdSettingsPage.jsx](../src/pages/admin/ThresholdSettingsPage.jsx)
- [src/pages/auth/AdminLogin.jsx](../src/pages/auth/AdminLogin.jsx)
- [src/pages/auth/ForgotPassword.jsx](../src/pages/auth/ForgotPassword.jsx)
- [src/pages/auth/ResetPassword.jsx](../src/pages/auth/ResetPassword.jsx)
- [src/routes/ProtectedAdminRoute.jsx](../src/routes/ProtectedAdminRoute.jsx)
- [src/services/authService.js](../src/services/authService.js)
- [src/utils/exportPrintUtils.js](../src/utils/exportPrintUtils.js)
- [src/utils/publicConfig.js](../src/utils/publicConfig.js)
- [src/utils/safeUrls.js](../src/utils/safeUrls.js)
- [src/utils/securityDiagnostics.js](../src/utils/securityDiagnostics.js)
- [src/utils/thresholdEvaluation.js](../src/utils/thresholdEvaluation.js)
- [tests/security.test.mjs](../tests/security.test.mjs)
- [vercel.json](../vercel.json)
- [vite.config.js](../vite.config.js)

## Existing ESLint findings

- src/layouts/AdminLayout.jsx:109 - react-hooks/set-state-in-effect (error)
- src/pages/admin/AddMarketplaceListingPage.jsx:375 - no-unused-vars (error)
- src/pages/admin/AddMarketplaceListingPage.jsx:576 - react-hooks/immutability (error)
- src/pages/admin/AddMarketplaceListingPage.jsx:587 - react-hooks/exhaustive-deps (warning)
- src/pages/admin/AlertsPage.jsx:1241 - react-hooks/set-state-in-effect (error)
- src/pages/admin/AlertsPage.jsx:1245 - react-hooks/set-state-in-effect (error)
- src/pages/admin/DashboardOverview.jsx:618 - react-hooks/set-state-in-effect (error)
- src/pages/admin/EditMarketplaceListingPage.jsx:19 - no-unused-vars (error)
- src/pages/admin/EditMarketplaceListingPage.jsx:414 - react-hooks/immutability (error)
- src/pages/admin/EditMarketplaceListingPage.jsx:425 - react-hooks/exhaustive-deps (warning)
- src/pages/admin/MarketplaceListingDetailsPage.jsx:328 - react-hooks/exhaustive-deps (warning)
- src/pages/admin/MarketplaceOrdersPage.jsx:998 - react-hooks/set-state-in-effect (error)
- src/pages/admin/MarketplaceOrdersPage.jsx:1002 - react-hooks/set-state-in-effect (error)
- src/pages/admin/MarketplacePage.jsx:13 - no-unused-vars (error)
- src/pages/admin/OrdersPage.jsx:804 - react-hooks/set-state-in-effect (error)
- src/pages/admin/OrdersPage.jsx:808 - react-hooks/set-state-in-effect (error)
- src/pages/admin/ReportsPage.jsx:1660 - react-hooks/set-state-in-effect (error)
- src/pages/admin/ReportsPage.jsx:1828 - react-hooks/set-state-in-effect (error)
- src/pages/admin/SellerProfilePage.jsx:438 - react-hooks/exhaustive-deps (warning)
- src/pages/admin/SensorReadingsPage.jsx:976 - react-hooks/set-state-in-effect (error)
- src/pages/admin/SensorReadingsPage.jsx:980 - react-hooks/set-state-in-effect (error)
- src/pages/admin/SettingsPage.jsx:1730 - react-hooks/set-state-in-effect (error)
- src/pages/admin/TankDetailsPage.jsx:1681 - react-hooks/purity (error)
- src/pages/admin/TankDetailsPage.jsx:1988 - react-hooks/set-state-in-effect (error)
- src/pages/admin/TankDetailsPage.jsx:1989 - react-hooks/exhaustive-deps (warning)
- src/pages/admin/TankDetailsPage.jsx:1992 - react-hooks/set-state-in-effect (error)
- src/pages/admin/TankDetailsPage.jsx:2025 - react-hooks/exhaustive-deps (warning)
- src/pages/admin/TankDetailsPage.jsx:2034 - react-hooks/set-state-in-effect (error)
- src/pages/admin/TankDetailsPage.jsx:2428 - react-hooks/set-state-in-effect (error)
- src/pages/admin/TanksPage.jsx:1073 - react-hooks/set-state-in-effect (error)
- src/pages/admin/ThresholdSettingsPage.jsx:1863 - react-hooks/set-state-in-effect (error)

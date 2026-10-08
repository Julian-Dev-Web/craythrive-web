# Single-account Developer Mode

Implemented and verified locally on 2026-10-08, published in commit `d472ef7`.
The owner subsequently saved the production UUID secret and authorized Edge
Function deployment. All three Developer Mode functions are now deployed to
the active `craythrive` project (`abtzkqfrwzcocyrwcrfc`). The saved secret was
compared against the owner's provided UUID without exposing its value.
No real developer identity is stored in tracked files. The local server-only
environment file is ignored by Git. Missing/invalid secrets still fail closed.

## Scope and existing implementation

This branch had no Developer Mode route, logo gesture, OTP flow, or
Backup/Restore engine. The implementation adds the requested single-account
authorization boundary and entry/OTP flow. It does not invent database
backup coverage, restore semantics, SQL privileges, or a second admin model.
The owner was asked whether the previous Developer Mode exists elsewhere.

The new `developer-backup` and `developer-restore` endpoints are guarded but
have **no operation engine configured**. They return 403 to unauthorized
callers; an authorized developer with recent OTP receives 501, without any
database read/write. The UI clearly reports that Backup/Restore is not
configured and offers no operation buttons. If the real engine is supplied,
connect it only as the shared handler's server-side `operation` callback;
never expose a separate unguarded RPC, storage URL or service-key endpoint.

## Identity and authorization

- One scalar server secret: **`CRAYTHRIVE_DEVELOPER_USER_ID`**. It must be
  exactly one Auth UUID. Blank, malformed, wildcard, comma-separated and
  JSON-list configurations deny everyone. There is no role fallback,
  first-user bootstrap, default owner or email-only fallback.
- Optional **`CRAYTHRIVE_DEVELOPER_EMAIL`** is an additional server check of
  the verified, confirmed Auth email. A matching email never overrides a
  UUID mismatch.
- Every non-preflight request is independently checked. The handler extracts
  the bearer token, verifies it through `auth.getUser(token)` and
  `auth.getClaims(token)`, and requires the verified user ID to match both
  the JWT subject and the configured UUID. This verified Auth ID is the
  identity represented by Postgres `auth.uid()`; no identity is accepted
  from a request body, profile, user metadata or localStorage flag.
- Tokens must be unexpired, authenticated user tokens. Anonymous users,
  service-role tokens, missing/invalid tokens and mismatched subjects fail.
- Auth clients are created separately per request with session persistence
  and automatic refresh disabled. Only the built-in Supabase URL and anon
  key are used; this authorization flow needs no service-role key.
- Failed handler authorization returns **403 `{ "authorized": false }`**.
  It never returns the configured UUID/email or provider internals.
  Supabase's enabled platform JWT check may reject invalid/missing JWTs
  earlier with 401; a different signed-in user gets 403 from the handler.
- OPTIONS is a data-free CORS preflight (204), not an operation. CORS is
  not used as the authorization boundary. Responses are `no-store`.

## Entry and verification

The dashboard sidebar logo remains visually unchanged and is now a
keyboard-accessible button. Its tenth activation reads the current session
and invokes `developer-access` with the user's JWT. No UUID/email allowlist
or local developer flag is read or sent. Only server-authorized callers
navigate to `/developer`; that protected route repeats the server check.
Direct URL visits therefore cannot skip authorization.

After authorization, the developer can verify an existing Supabase TOTP
authenticator. If none exists, explicit "Set up authenticator" enrolls a
factor **only for the currently authenticated account**; this is not adding
another developer. An abandoned, unverified factor with this feature's
friendly name can be restarted. Other/verified factors are not removed.
There is no developer list, add-developer form, management page, super-admin
role, or multi-admin system.

OTP codes are verified by Supabase Auth's `challengeAndVerify`. The browser
then asks the Edge Function to verify the newly issued JWT again. QR setup
data is kept in component memory, not in a separate persistent store.
Authentication changes reset the page check; asynchronous results from an
older identity are discarded. Verification errors preserve the flow without
showing provider details.

Backup/Restore require both the same UUID check and **recent verified MFA**:
signed `aal2` plus a timestamped `totp` or `mfa/totp` authentication event
within five minutes. Token refresh time, request fields and browser flags
do not count as OTP verification. The server enforces this on each request;
the page also expires its verified display. A future operation callback is
not reached if either authorization condition fails.

## Server configuration and deployment handoff

The owner completed steps 1–2 and the agent completed step 3 on 2026-10-08.
These steps are retained for reproducibility. Real owner OTP verification
and a second-account live denial test remain to be performed.
After deployment, the owner reported reaching "Verify your identity" and
"No authenticator is configured for this account" on the live website.
This confirms the owner reached the post-authorization setup view; actual
authenticator enrollment and successful OTP verification are still pending.

1. In the intended Supabase project's **Authentication → Users**, locate
   your own existing CrayThrive account and copy its **User UID**. Do not
   create another account or change any profile role.
2. In **Edge Functions → Secrets**, set
   **`CRAYTHRIVE_DEVELOPER_USER_ID`** to that single UUID. Optionally set
   `CRAYTHRIVE_DEVELOPER_EMAIL` to the account's confirmed email.
   Do not paste these values into React code, `VITE_` variables, Vercel public
   configuration, this document or Git. Supabase documents this server
   environment mechanism in [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).
3. Deploy these three reviewed function directories to that same project:

   ```powershell
   supabase functions deploy developer-access --project-ref YOUR_PROJECT_REF
   supabase functions deploy developer-backup --project-ref YOUR_PROJECT_REF
   supabase functions deploy developer-restore --project-ref YOUR_PROJECT_REF
   ```

   Use `supabase/config.toml` as committed. **Keep `verify_jwt = true`** for
   every function; do not use `--no-verify-jwt`. JavaScript entrypoints are
   configured explicitly, following [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration).
4. Publish the web change only when remote function setup is ready. A GitHub
   push/Vercel web deployment alone does not deploy Supabase Edge Functions.
5. Confirm the owner reaches OTP; another existing signed-in account must
   receive 403 from all three handler paths, including direct API requests.
   Confirm owner requests without recent MFA are rejected by Backup/Restore.
   Operations remain disabled with 501 even after OTP until their real
   implementation is integrated and separately tested.

No SQL migration or new roles/tables are required for this authorization
change. No remote secrets, Auth settings, RLS, database rows or backups were
changed. The existing public-env validator already rejects developer
allowlist variables prefixed with `VITE_`; regression tests cover that.

## Exact files changed

- `.gitignore`
- `eslint.config.js`
- `src/App.jsx`
- `src/components/Sidebar.jsx`
- `src/components/DeveloperEntry.jsx` (new)
- `src/pages/DeveloperPage.jsx` (new)
- `src/services/authService.js` (comment only)
- `src/services/developerService.js` (new)
- `src/styles/developer.css` (new)
- `supabase/config.toml` (new)
- `supabase/functions/_shared/developerAuthorization.js` (new)
- `supabase/functions/_shared/developerHandlers.js` (new)
- `supabase/functions/_shared/developerRuntime.js` (new)
- `supabase/functions/developer-access/index.js` (new)
- `supabase/functions/developer-backup/index.js` (new)
- `supabase/functions/developer-restore/index.js` (new)
- `tests/developer-authorization.test.mjs` (new)
- `tests/developer-service.test.mjs` (new)
- `tests/browser/developer.spec.mjs` (new)
- `tests/browser/fixtures.mjs`
- `security/DEVELOPER_MODE.md` (this report, new)

## Validation and remaining limits

The server handler tests exercise an authorized identity, another UUID with
matching email/forged metadata/body flags, malformed/multiple UUID config,
invalid tokens, expired claims, service-role/anonymous callers, recent/stale
OTP, UUID rotation, disabled operation engines and redacted exceptions.
The SDK adapter tests verify that both Auth user and verified claims are
required, with a fresh client per request.

Client and browser tests cover the tenth logo activation, direct URL,
forged localStorage flags, denied OTP starts, authorized OTP and setup,
invalid OTP, server confirmation after verification, revocation before
OTP and layouts at 390/768/1366px. Fixtures use synthetic identities and
mocked backend responses, never the real developer UUID.

- `npm run build`: passed; bundled credential scan reported no findings.
- Client bundle inspection found none of the server-only developer identity
  secret names or authorization/runtime helpers.
- `npm test`: **66 passed, 1 skipped** historical dev-endpoint check.
- `npm run test:browser`: **95 passed, 18 skipped** historical planning-form
  checks; this includes all 9 new Developer Mode browser checks.
- Changed JavaScript files: **0 ESLint errors, 0 warnings**.
- Full ESLint retains the existing **24 errors / 5 warnings** in other files.
- Existing warnings: production bundle exceeds 500 kB; the browser runner's
  NO_COLOR/FORCE_COLOR environment warning remains.
- `git diff --check`: passed.

Supabase CLI 2.120.0 was run through `npx` using an existing saved CLI login.
Remote deployment used server-side bundling (`--use-api`) and named only the
three Developer functions. All three are ACTIVE at version 1 with
`verify_jwt: true`; existing AI Guide and push functions were preserved.
Live OPTIONS requests returned 204 and unauthenticated POST requests returned
401 from the platform JWT gate for each endpoint. No database operation ran.
No new service-role key or management token was placed in the repository.

Local Deno execution, real owner OTP verification, second-account live
authorization denial, and real Backup/Restore execution remain unverified.
Shared request handlers run under Node's Web Request/Response API in unit
tests; browser tests use the production Vite bundle.

Implementation references: [Supabase JWT verification](https://supabase.com/docs/reference/javascript/auth-getclaims),
[Edge authorization layers](https://supabase.com/docs/guides/functions/auth-headers),
[TOTP verification](https://supabase.com/docs/guides/auth/auth-mfa/totp),
and [verified JWT fields](https://supabase.com/docs/guides/auth/jwt-fields).

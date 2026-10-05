# CrayThrive web dashboard

React + Vite SPA using Supabase Auth, Database and Storage.

Copy .env.example to .env.local and supply the actual Supabase project URL and publishable key. A legacy anon key remains supported. VITE_APP_SITE_URL optionally sets the canonical password recovery origin. These values are public browser configuration. Private provider, service-role, database and webhook credentials belong only in a server environment.

The existing local .env was malformed JavaScript rather than dotenv configuration. It was removed from Git tracking and left intact locally. Actual runtime credentials were not fabricated or replaced.

Commands: npm ci; npm run dev; npm run build; npm run lint; npm run test:security; npm run security:scan; npm audit.

The build validates browser environment names/key types and scans dist for private credential signatures. These checks do not replace database authorization or a full secret scanner.

See [the pre-production security audit](security/PRE_PRODUCTION_AUDIT.md) for exact changes, validation, remaining risks and manual Supabase/Vercel steps. No deployment was performed. Live RLS, Storage and the AI backend remain unverified because their schema/source was absent from this workspace.

Pre-release QA: `npm test` runs security and monitoring regressions; `npm run test:browser` runs the production-bundle browser suite against an isolated mock backend. The browser suite uses installed Chrome on this Windows workspace; other machines can set `QA_BROWSER_PATH` or install Chromium with `npx playwright install chromium`. It never uses the real Supabase project. See [the QA report](qa/PRE_RELEASE_QA.md) for results, fixes, remaining ESLint failures and the live checks still required.

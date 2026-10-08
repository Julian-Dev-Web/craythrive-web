# Add Tank implementation and verification

Implemented and checked locally on 2026-10-08. GitHub publication was subsequently requested by the project owner. No SQL was executed; hosted deployment has not been verified.

**Live database and mobile verification remains pending.** The workspace contains no usable Supabase public configuration, exported tanks schema, or mobile Add Tank source. A read-only schema inspection request is pending with the project owner. Mock test results do not prove production RLS or mobile compatibility.

## 1. Exact files changed

Application:

- `src/App.jsx` — protected Add/Edit Tank routes.
- `src/pages/admin/TanksPage.jsx` — Add Tank action and neutral Unpaired indication.
- `src/pages/admin/TankDetailsPage.jsx` — owner-only Edit action, saved planning panel below live conditions, neutral device-free state.
- `src/pages/admin/AddTankPage.jsx` — shared Add/Edit form, validation, submit protection, error recovery.
- `src/components/TankPlanningGuide.jsx` — reusable live/saved planning presentation and sources.
- `src/services/tanksService.js` — fills the previously empty service; authenticated schema inspection and owner-scoped writes to `tanks` only.
- `src/utils/tankPlanningSchema.js` — existing-column mapping, explicit units, schema compatibility checks and field constraints.
- `src/utils/tankStockingGuidance.js` — shared geometry, stocking guidance, input validation and pairing state.
- `src/styles/tankPlanning.css` — responsive form and guide using existing theme tokens.

Verification and handoff:

- `tests/tank-planning.test.mjs`
- `tests/tank-writes.test.mjs`
- `tests/fixtures/tank-schema.mjs`
- `tests/browser/fixtures.mjs`
- `tests/browser/tank-planning.spec.mjs`
- `security/inspect-tanks.sql`
- `security/proposed-tank-planning-columns.sql`
- `security/ADD_TANK_IMPLEMENTATION.md` (this report)

## 2. Actual columns found

No **live** columns were verified. The existing repository's documented mobile contract identifies `tanks`, owner `user_id`, and device `device_uid`. Existing readers support primary-key aliases `id` / `tank_id` / `uuid`, names `name` / `tank_name`, and life stage `type` / `tank_type`. These are repository evidence, not an actual database inspection.

The writer first requests authenticated PostgREST OpenAPI metadata. Before any write it requires one supported primary key, `user_id`, availability of the requested operation (insert for Add, update for Edit), and exactly one existing column per form field:

| Form field | Supported existing equivalents |
| --- | --- |
| Name | `name`, `tank_name` |
| Type | `tank_type`, `type` |
| Length | `length_cm`, `tank_length_cm` |
| Width | `width_cm`, `tank_width_cm` |
| Height | `height_cm`, `tank_height_cm` |
| Planned depth | `normal_water_depth_cm`, `working_water_depth_cm`, `target_water_depth_cm` |
| Population | `crayfish_count`, `population` |
| Shelters | `shelter_count`, `shelters_count`, `number_of_shelters` |
| Notes | `notes` |

Missing, incompatible, or ambiguous columns block saving with a setup message. Unsupported unitless dimension names are never treated as centimeters. Nothing retries weaker owner filters, another table, or a partial insert. PostgREST metadata cannot establish RLS correctness or all check/trigger semantics. OpenAPI must be accessible with the normal authenticated user's JWT; if disabled, confirm the real schema and implement a reviewed static contract rather than exposing privileged metadata.

## 3. Is a migration required?

Unknown until the actual schema is inspected. Old rows are read safely even if planning columns are absent. No defaults/backfill are assumed.

## 4. Proposed SQL

`security/inspect-tanks.sql` is a read-only catalog inspection, ending in rollback. It returns columns/defaults, PK/FK/check constraints, RLS policies, grants, indexes, enums and trigger definitions/signatures; it does not return tank rows or trigger function bodies.

`security/proposed-tank-planning-columns.sql` is a **review-only draft**, deliberately guarded against execution. After inspecting existing equivalents and mobile field units, it can add only missing nullable `length_cm`, `width_cm`, `height_cm`, `normal_water_depth_cm` (numeric), `crayfish_count`, `shelter_count` (bigint), and `notes` (text). Existing equivalent columns are preserved. It creates no table, changes no rows, and does not alter RLS, ownership, type constraints or device requirements.

Do not remove its guard until the actual schema/mobile comparison is complete. Any required device column without a usable default, incompatible type check, ambiguous mapping or unsupported primary key requires a separate reviewed change based on the real schema.

## 5. Routes

- Add: `/admin/tanks/add`
- Edit: `/admin/tanks/:tankId/edit`
- Saved tank: `/admin/tanks/:tankId`

Both form routes use the existing protected dashboard access. Edits read and update by primary key **and** authenticated `user_id`. Type and ownership cannot be edited. Save errors retain form entries. Duplicate submissions while a request is pending are prevented.

## 6. Geometry

- Floor area (m²): `(length_cm / 100) * (width_cm / 100)`.
- Working volume (L): `length_cm * width_cm * normal_water_depth_cm / 1000`.

Only planned depth is used for volume. Sensor `water_depth_cm` and `water_distance_cm` are never written, substituted, or used as planned dimensions. Live safety evaluation is unchanged and independent of stocking guidance.

## 7. Juvenile guidance

Central constants: 5–15 **advanced juveniles** per m². Estimates are `floor(area * 5)` and `floor(area * 15)`, with the low estimate as the conservative beginner starting point. A rounded starting estimate below one shows a small-tank caution rather than recommending zero animals. Count above the beginner estimate produces Warning but does not block saving. Additional shelters never increase the reference density.

This is an adaptation of the [Queensland Government's pond grow-out reference](https://www.business.qld.gov.au/industries/farms-fishing-forestry/fisheries/aquaculture/species/redclaw-crayfish), not a validated small-tank biological limit or guarantee. The supported form types are Juvenile and Breeder only.

## 8. Breeder guidance

The centralized CrayThrive project preference is **1 male + 2 females**. No validated project breeder density was found; no juvenile density, exact capacity, or hard safety limit is applied to breeders. Planned population per m² is descriptive only. More than one suggested group prompts review of floor space, size, individual shelters, filtration and aggression; that group comparison is not a maximum capacity.

Controlled work includes 1M:1F in [Nesa et al. (2023)](https://researchonline.jcu.edu.au/78909/1/Redclaw%20sex-separated%20system-23.pdf), and ratios up to 1M:4F in [Jones (1995)](https://era.dpi.qld.gov.au/id/eprint/11192/). The project preference is not presented as the only valid ratio.

## 9. Validation and statuses

Name and supported type are required. Dimensions and normal depth must be finite and positive; depth cannot exceed height. Population and shelter count must be safe whole numbers >= 0. Blank, negative, NaN, infinite and calculation-overflow inputs are rejected rather than coerced to zero. Existing integer-column and text-length restrictions are respected without rounding.

Stocking guidance uses only Normal/Warning, with icon and text, separate from live water safety. Exceeding guidance is allowed. New tanks require no device field; `is_paired` is false where the existing schema supports it. No device shows neutral Unpaired, and absent sensor data stays No Data. The draft does not silently remove existing device constraints.

## 10. Mobile compatibility and ownership

Writes use the existing `tanks` table and verified `supabase.auth.getUser()` identity in `user_id`; manually supplied owners, devices and measured depths are ignored. No new ownership model or table is introduced. Existing enum casing is preserved. For a text type column, values are lowercase `juvenile` / `breeder` per the supplied contract; this still needs comparison with the actual mobile source and checks.

Both clients sharing the same project and account will access the same rows subject to RLS and client filters. Actual visibility in mobile Dashboard/Tank list, trigger behavior, constraints, and server-enforced ownership have **not** been verified. Browser fixture/schema rows are hypothetical and never sent to production.

## 11. Build and tests

- `npm run build`: PASS, including distribution security scan (zero findings).
- `npm test`: 36 PASS (11 new tests).
- Full `npm run test:browser`: 83 PASS (70 existing + 13 Add/Edit Tank checks).
- Focused Add/Edit browser verification repeated after final presentation/validation adjustments: 13 PASS; both device-free/paired detail checks repeated after the final connection-state adjustment: 2 PASS.
- ESLint: existing baseline 24 errors / 5 warnings, no new findings. Existing errors involve hooks and unused variables in older pages/layouts; lint is not globally passing.
- Vite: existing large-JavaScript-chunk warning remains. Playwright also reports the existing NO_COLOR/FORCE_COLOR environment warning.

Browser coverage includes empty-account creation, persistence after refresh, neutral no-data state, validation, non-blocking overstock warnings, breeder/small-tank guidance, duplicate-submit protection, owner/type/device/sensor preservation on edit, schema aliases/enum casing, blocked unavailable schema/foreign-owner edit, permission failure/retry, and 390/768/1440px light/dark layouts. All backend interactions in these tests are mocked.

## 12. Manual Supabase/mobile follow-up

1. Run the read-only inspector in Supabase SQL Editor; review its schema results without sharing credentials or private rows. Compare the actual mobile Add Tank implementation and client-side tank filters.
2. Adjust mappings to confirmed equivalents if necessary. Review the nullable-column draft only if fields are missing. Confirm optional-device creation against existing constraints/defaults/triggers; do not automatically weaken them.
3. On a staging project with two normal authenticated QA accounts, verify account A can create/edit/read its own tank and account B cannot read/edit A's private tank or insert a row owned by A. Test forged `user_id` through the direct authenticated API as well as the UI, then inspect the real SELECT/INSERT/UPDATE RLS policies. SQL Editor owner privileges and mocked filters do not prove RLS.
4. With the same account in web and mobile, create a device-free web tank and verify it appears on both mobile Dashboard and Tank list; verify the reverse direction, then edit planning data and confirm sensor readings/history/type remain unchanged.
5. GitHub publication was subsequently requested. Applying SQL and verifying the hosted release remain follow-up work; database/mobile verification is still pending.

## Follow-up: generic Add Tank setup error

The hosted screenshot reports the original generic setup guard. That message alone does **not** identify which check failed. The actual database remains unverified; do not assume the nullable-column draft will fix the hosted error without the inspection results.

Local corrections:

- Add no longer requires update availability; Edit no longer requires insert availability.
- Creation-only required defaults/device requirements are not applied to an edit that preserves existing device information. A null default does not satisfy a required omitted field on creation.
- Missing planning fields are listed together using farmer-facing labels.
- Setup failures show a safe support reference and log only that controlled code/status. Schema metadata, tokens, user rows and provider error bodies are not printed.
- Sign-in/configuration failures, unavailable/denied schema access, missing table/fields, unsupported keys/types and unavailable operations have distinct references.

Useful references: `TANK_FIELDS_MISSING` (review existing equivalents/missing planning columns), `TANK_SCHEMA_UNAVAILABLE` (schema request unavailable or invalid), `TANK_SCHEMA_ACCESS_DENIED` (schema request forbidden), `TANK_CREATE_NOT_ALLOWED` / `TANK_EDIT_NOT_ALLOWED` (requested API operation unavailable), `TANK_DEVICE_REQUIRED` (existing required device field prevents device-free creation).

The original release passed 36 unit and 83 full browser tests. The follow-up passes the production build/security scan, 40 unit tests and 15 focused Add/Edit browser tests. ESLint passes for all six changed JavaScript/test files; the full repository remains at the existing 24 errors / 5 warnings. No migration or live database change was executed for this follow-up, and the website's exact blocker still requires real schema/request evidence.

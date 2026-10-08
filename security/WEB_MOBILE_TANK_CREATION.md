# Web Add Tank: mobile behavior alignment

Updated 2026-10-08. Implemented and verified locally. The owner subsequently
authorized GitHub publication; hosted deployment remains unverified.

## 1. Root cause and correction

The preceding web feature required dimensions, planned water depth, shelters
and capacity/population mappings absent from the owner's supplied `public.tanks`
schema. It also blocked creation on an OpenAPI/schema endpoint and server-key
setup. That differs from the supplied mobile AddTankScreen behavior: select
Breeder or Juvenile and insert the shared population counters using Supabase
Auth. The web forms had subsequently been removed at the owner's request.

The new create-only form restores the confirmed mobile screen behavior using
the existing table. No schema discovery or privileged server key is needed by
this flow. Old planning utilities, audit SQL and skipped planning-form tests
are retained as historical material, without a route or import from this form.
The old edit route continues to redirect to the tank list.

## 2. Exact files changed

Application:

- `src/App.jsx`
- `src/pages/admin/AddTankPage.jsx`
- `src/pages/admin/TanksPage.jsx`
- `src/pages/admin/TankDetailsPage.jsx`
- `src/services/tanksService.js`
- `src/utils/tankCreationRules.js` (new)
- `src/styles/tankCreation.css` (new)
- `src/styles/tanks.css`

Verification and documentation:

- `tests/tank-creation.test.mjs` (new)
- `tests/tank-writes.test.mjs`
- `tests/browser/tank-creation.spec.mjs` (new)
- `tests/browser/fixtures.mjs`
- `tests/browser/qa.spec.mjs`
- `security/ADD_TANK_IMPLEMENTATION.md`
- `security/WEB_MOBILE_TANK_CREATION.md` (this report, new)

## 3. Shared fields used

Storage evidence is the owner's supplied SQL export, not a live database
inspection. The insert allowlists only these existing `public.tanks` columns:

| Column | Source |
| --- | --- |
| `user_id` | Verified `supabase.auth.getUser()` identity |
| `tank_name` | Required, trimmed form name |
| `tank_type` | SQL-compatible `Breeder` or `Juvenile` |
| `male_count` | Fixed 1 for breeder, 0 for juvenile |
| `female_count` | Fixed 2 for breeder, 0 for juvenile |
| `juvenile_count` | 0 for breeder; validated form count for juvenile |
| `notes` | Optional trimmed text or null |
| `has_paired_device` | false |
| `status` | `Unpaired` |

`id`, `created_at` and `updated_at` retain database defaults.
`population_label` and `tank_size_label` are nullable in the supplied schema;
their exact mobile values are unknown and are omitted rather than invented.
Web list/details population text uses actual stored numeric counters.

## 4. Tank types

The UI/form keys are `breeder` and `juvenile`, matching the supplied screen
brief. The supplied database CHECK constraint requires title-case stored
values **`Breeder`** and **`Juvenile`**. These are the actual insert values.
The inaccessible mobile `TANK_TYPES` helper constants are not claimed to have
been inspected; live successful mobile rows would have to satisfy that CHECK.

## 5. Breeder payload

Example actual payload produced by the web helper; `AUTH_USER_ID` stands for
the verified user's ID, not a form field:

```json
{
  "user_id": "AUTH_USER_ID",
  "tank_name": "Breeder Tank 1",
  "tank_type": "Breeder",
  "male_count": 1,
  "female_count": 2,
  "juvenile_count": 0,
  "notes": null,
  "has_paired_device": false,
  "status": "Unpaired"
}
```

Total population is 3, derived from counters; no extra total column is added.
No breeder count input is offered, and injected form counters are ignored.

## 6. Juvenile payload

```json
{
  "user_id": "AUTH_USER_ID",
  "tank_name": "Juvenile Tank 1",
  "tank_type": "Juvenile",
  "male_count": 0,
  "female_count": 0,
  "juvenile_count": 15,
  "notes": null,
  "has_paired_device": false,
  "status": "Unpaired"
}
```

Changing the count to 20 changes only `juvenile_count` and its live summary.
Optional entered notes are trimmed before saving in either type.

## 7. Juvenile validation: confirmed and pending

Confirmed from the owner's screen brief: default **15**, guidance
**“15 to 20 crayfish”**, whole numeric values only. The mobile implementation of
`validateTankForm` was not accessible in the web workspace. It is therefore
unknown whether mobile enforces 15–20, positive counts, or another range.

The explicit provisional web rule is a nonblank, nonnegative whole integer
that fits the existing PostgreSQL integer column (0 through 2147483647).
For example, 0, 14 and 21 are accepted; 15–20 is a recommendation, not an
unverified hard constraint. Empty, negative, fractional, nonfinite and
overflow values are rejected. This fallback is not described as verified
mobile parity. Replace it with the actual helper rule when supplied.

## 8. Default tank reference

**Not found.** Neither `src/utils/tankRules.js` nor its
`DEFAULT_TANK_REFERENCE` was available in the accessible web/reference files.
The owner was asked for the helper's local path or code. No tank size,
reference label, or `population_label` format is invented. The web omits the
reference section until the actual mobile value is available.

## 9. SQL and server setup

**No SQL migration is required by the supplied schema. No SQL was executed.**
The existing table stores the confirmed mobile population model. The new
flow uses the existing public Supabase client and preserves RLS; it does not
request a service-role/secret key, call an RPC, create an alternate table, or
retry rejected inserts with different ownership fields. Existing server RLS
and triggers have not been inspected and remain a production verification
dependency. Historical capacity-column SQL is not required for this form.

## 10. Route and successful creation

The Tanks page links to protected **`/admin/tanks/add`**. A valid submission
verifies auth, constructs the allowlisted payload, performs one
`insert(...).select('*').single()`, and checks returned owner, ID, type,
population counters and pairing state. Success returns to `/admin/tanks`,
whose existing mount load refetches the list, and shows a dismissible success
notice. A synchronous submission ref plus disabled controls prevents rapid
duplicate submits. Failed requests preserve entries without automatic retry.

The list and details show stored population counters. New tanks remain
**Unpaired / No Data**, with no fabricated readings or Normal safety status.
The monitoring status/threshold/ammonia/automation algorithms are unchanged.

## 11. Compatibility verification and limits

Unit and mocked browser tests verify exact insert column names/type casing,
verified ownership, fixed breeder counters, juvenile 15/20, validation,
auth/RLS error handling, duplicate submit prevention, list refresh, detail
population and existing mobile-shaped rows. The browser mock rejects unknown
tank columns and lowercase stored type values, reproducing those supplied
schema constraints. Read tests also exclude another user's tank.

These are local tests, not an actual database insert or a mobile device test.
The workspace has no usable live Supabase public configuration or mobile
source. No permanent test rows were created. Actual web-to-mobile visibility,
mobile label rendering, RLS/trigger behavior and exact helper parity remain
unverified. The mobile helper and a real shared-project test are needed to
close those checks. Schema-compatible counters alone do not prove mobile UI
label compatibility if mobile relies on the omitted nullable labels.

## 12. Build, lint and test results

- `npm run build`: passed; bundled credential scan found no credentials.
- `npm test`: 52 passed, 1 skipped historical dev-endpoint test.
- `npm run test:browser`: **86 passed, 18 skipped** historical planning-form
  checks. This includes **14 passing Add Tank checks**, covering creation,
  ownership, validation, errors, double submission and light/dark layouts.
- Full ESLint: existing **24 errors / 5 warnings** remain. Existing issues
  are mainly hooks diagnostics in older pages plus unused variables.
- Other changed JavaScript files: **0 ESLint errors / 0 warnings**.
  For the two modified monitoring pages, comparison against HEAD confirms
  identical rule/severity/message diagnostics after normalizing shifted
  source line numbers: TanksPage 1 error; TankDetailsPage 4 errors/2 warnings.
- Existing build warning: JavaScript bundle exceeds 500 kB.
- Browser runner also reports the existing NO_COLOR/FORCE_COLOR environment
  warning. Neither warning is a test failure.
- Responsive checks cover 390, 768 and 1366px in light and dark themes.
- The owner subsequently requested a commit and GitHub push. No direct
  deployment command was run; hosted deployment remains unverified.

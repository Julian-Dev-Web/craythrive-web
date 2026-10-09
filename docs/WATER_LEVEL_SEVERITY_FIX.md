# Web water-level severity audit — 2026-10-09

The faulty evaluator was `src/utils/thresholdEvaluation.js`, inside
`evaluateReadingSafety()`. It compared raw `waterDepth < active.waterLevelMin`
and unconditionally assigned `severity: "critical"`. Its alert text then rounded
the raw depth to one decimal. Firmware `water_status` was not passed into the
evaluator. This discarded the device's warning tier and could report an apparent
`4.0 cm < 4 cm` comparison.

## Configuration and rounding evidence

A read-only inspection of the linked Supabase database found:

- `threshold_settings.thresholds` JSON and its numeric columns contain only
  `waterLevelMin` / `water_level_min` for water. Saved minima were **4.5 cm** and
  **3.5 cm** at inspection time; the Web default is **4.5 cm**.
- Neither that configuration nor `water_thresholds` has `waterCriticalLow`,
  `waterSafeMin`, `waterSafeMax`, or `waterCriticalHigh`. `water_thresholds` had
  no rows. The Web loader uses the signed-in user's `threshold_settings` row.
- There are no separately configured numeric critical bands for temperature,
  pH, or water clarity either. Reference/literature values are informational;
  this fix does not turn them into operating limits.
- A real sensor row at **2026-10-09 08:08:30.158479 UTC** stored
  `water_depth_cm = 3.99`, `water_level = 3.99`, and
  `water_status = SAFE_IDEAL`. Several other rows also store 3.99. These display
  as **4.0 cm**. Thus rounding can cause the reported contradiction when a
  minimum is 4 cm. The precise row behind the user's original observation was
  not supplied, so this is a verified example, not an assertion that it was
  that exact row. **3.96 was an illustrative possibility, not the observed raw
  value.** The current saved minima differ from the reported 4 cm setting.

## New water logic

1. Resolve depth from `water_depth_cm`, then `water_level`, then the existing
   normalized `waterValue` fallback. Never use `water_distance_cm` as depth.
2. Missing/invalid numeric depth remains **No Data**, even with a status code.
3. Until shared critical bands exist, prefer recognized firmware water codes:

   | Firmware code | UI severity |
   | --- | --- |
   | `SAFE_IDEAL` | Normal |
   | `LOW_WARNING`, `HIGH_WARNING` | Warning |
   | `CRITICAL_LOW`, `CRITICAL_HIGH` | Critical |

   Matching trims whitespace and ignores case, but accepts only those codes.
   Legacy free-form text such as `Safe Ideal` and unknown/error codes do not
   override numeric evaluation.
4. Without a recognized code, compare depth and saved minimum at the same
   **0.1 cm display precision**. Below minimum is **Warning**; at or above it is
   **Normal**. No numeric critical or upper-water boundary is invented.
5. Firmware alerts explicitly say the monitoring device reports low/high water.
   They do not claim that the device used the Web's saved minimum. Numeric
   fallback alerts use the same one-decimal numbers as the card. Sensor Readings'
   latest water card now uses the shared one-decimal label too.
6. Warnings contribute to issues and make `isSafe` false. Overall severity is
   Critical if any parameter is critical; otherwise Warning if any warns;
   otherwise Normal when data exists. Missing data remains neutral.

Raw values and raw database statuses remain unchanged. All UI severities still
come from `evaluateReadingSafety()`. Its callers now pass the relevant original
firmware metadata when normalizing or recomputing current summaries. History,
Tank Details, Tanks, Sensor Readings, Dashboard, Reports, CSV, and monitoring AI
context use the same evaluation. Numeric fallback responds to saved setting
changes after refresh without another upload. A recognized water firmware code
continues to win over the Web minimum, as requested.

## Temperature, pH, and clarity audit

These also classified every value outside a saved acceptable range as Critical.
Live records demonstrate distinct firmware tiers:

| Parameter | Observed warning codes | Observed critical code |
| --- | --- | --- |
| Temperature | `COLD_WARNING`, `HOT_WARNING` | `CRITICAL_COLD` |
| pH | `LOW_ACIDIC`, `HIGH_ALKALINE_WARNING` | `CRITICAL_ACIDIC` |
| Water clarity | `SLIGHTLY_CLOUDY`, `DIRTY` | `CRITICAL_DIRTY` |

The evaluator now preserves these known warning tiers **outside the saved
range**. Temperature and pH warning codes must match the direction of the
violation. Within the saved range, these three parameters remain Normal;
saved settings still control their acceptable range. Missing/unrecognized codes
retain the existing numeric Critical policy outside that range. No new numeric
bands or inferred cutoffs were added. Full numeric three-tier evaluation remains
an architecture gap until the Web/device share explicit severity boundaries.

## Scope and validation

No database writes, threshold migrations, actuator firmware edits, control-rule
changes, pushes, or deployments were performed.

Unit regressions cover all five water codes, unknown/missing metadata, missing
depth, unchanged raw values, field priority, rounding, saved minima of 3.5/4.5,
other parameter warnings, and summary/export/context consistency. The requested
4.6/4.5/4.4/4.0/3.5/3.4/3.3 example passes when the supplied firmware codes encode
the illustrated 3.4 critical cutoff. **3.4 is not configured as a Web boundary**;
without firmware metadata, 3.3 remains Warning rather than inventing Critical.

Browser regressions check the parameter badge, color class, icon, overall
status, latest summaries, and reading history across all five monitoring pages.
They also verify threshold refresh with an unchanged 3.99 cm reading.

Full unit suite: **97 passed, 1 existing retired-feature skip**. Browser monitoring,
ammonia, and general QA checks (excluding the unrelated responsive-layout loop):
**56 passed**. The monitoring unit file has **21 passing tests**.

`npm run build` passes, including the distribution security scan (no findings).
The existing bundle-size warning remains (approximately 584 kB JS, limit 500 kB).
Full ESLint retains 24 existing errors and 5 warnings. Comparing the three edited
pages against HEAD confirms their lint diagnostics are unchanged; the modified
utilities and tests pass targeted ESLint.

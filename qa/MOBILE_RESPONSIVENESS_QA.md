# Mobile responsiveness and report exports

Date: 2026-10-05. Workspace changes only; no deployment, push, migration, or live database write.

**READY for manual phone-browser testing.** This is a frontend readiness result, not production deployment clearance. Real Chrome tests use the isolated production bundle and synthetic Supabase fixtures described in [the pre-release QA report](PRE_RELEASE_QA.md). Actual iOS Safari/Android browsers and live backend data still require manual testing.

## 1. Exact files changed in this follow-up

- `src/pages/admin/ReportsPage.jsx`
- `src/styles/reports.css`
- `src/styles/dashboard.css`
- `src/utils/exportPrintUtils.js`
- `tests/browser/mobile-reports.spec.mjs`
- `qa/MOBILE_RESPONSIVENESS_QA.md`
- `qa/PRE_RELEASE_QA.md` — link to this follow-up and update the combined-export limitation.

Earlier uncommitted monitoring, security, and QA changes were retained. The temporary PDF inspection package was installed only in the ignored `.security-pdf-tools` folder; application dependencies were unchanged by this follow-up.

## 2. Mobile problems found

Long unbroken tank/product names caused page-level overflow in Dashboard, Tanks, Tank Details, Readings, and Reports. The initial long-name test found 235 px of excess width on Dashboard at 390 px. Reports used an implicit grid column, clipped activity titles, and a fixed-height selected tank button that could not display long names completely. Some report metric values also used ellipsis.

The shared content area now permits long words to wrap. Reports uses `minmax(0, 1fr)`, bounded dropdowns, expandable selected text, full-width mobile controls, and wrapped activity/metric text. No page-level `overflow: hidden` workaround was added. Existing intentional table scrolling and normal desktop grids remain.

## 3. Reports fixes

Refresh, dates, tank/condition filters, CSV and Print remain visible and usable on phones. Report controls and menu options have at least 44 px touch targets. Summary, metric and donut cards stack on phones; tablet summaries retain two columns. Activity and ammonia rows retain their stacked mobile layout and display full names/timestamps.

The native date-input color scheme now follows the chosen dashboard theme; screenshot inspection caught and corrected a dark-mode calendar icon that was almost invisible.

An export scope selector supports **Current Report** (default) or **Tanks + Marketplace**. Combined exports preserve separate section labels and the selected tank/date/condition filters for monitoring. Marketplace sections use the selected date range. The selected tank remains the one chosen on the Tank Report tab.

The Print Report button opens a dedicated report and the browser print dialog. Its preview also has a Print / Save PDF button for retrying. PDF is the browser's Save as PDF destination, not a pretend PDF download.

## 4. CSV findings/fixes

Actual phone-emulated Chrome downloads were read back and parsed as CSV, including quoted multiline fields. Checked all-tanks, selected tank, marketplace and combined filenames; union headers; complete water/ammonia/alert/listing/order rows; blank inapplicable cells; commas, quotes and newlines; current safety labels; independent scan dates; `text/csv;charset=utf-8;` MIME type.

CSV remains viewport-independent and preserves every data column. Record separators use CRLF. Field newlines are preserved and quoted; embedded quotes are doubled. Existing spreadsheet formula protection remains, including preserving ordinary signed numbers. Blob URLs are now revoked after 60 seconds instead of immediately, giving phone browsers time to start a download.

## 5. Print/PDF fixes

The old landscape output used the complete sparse CSV column union, tiny fonts and guessed manual page budgets. It now uses A4 portrait with 12 mm margins, 9–10 pt body/table text, a clean white layout, report/scope/generated-date metadata, and browser pagination using actual row heights.

Water readings use seven columns: Date, Tank, Temperature, pH, Water Clarity, Water Level, Overall. Each parameter keeps its evaluated condition below its value. Ammonia uses its own four-column table: Date, Tank, Ammonia, Condition. Marketplace listings and orders have separate compact tables. Alerts and other wide records use readable field blocks without discarding fields.

Table headers repeat on subsequent pages. Rows/cards avoid splitting when practical. Status words and symbols remain legible without color. Screen preview tables become stacked cards on phones; print CSS restores the portrait tables regardless of the originating viewport/theme. Page margin counters/footer are used where the browser supports them. Removing the content footer from print eliminated a footer-only extra page found during actual PDF inspection.

The popup opens synchronously from the user's click. Auto-print waits for document load, font readiness and completed layout frames. Popup blocking produces an actionable message; the preview remains open for retrying.

## 6. Ammonia export result and status correctness

Ammonia is present in Reports/mobile UI, CSV and generated PDF. Scan rows keep their own timestamps, tank association and evaluated conditions. Historical water rows keep ammonia blank; a scan is never copied onto unrelated water history. No scans produces **No Scan** in print rather than a fabricated reading.

Existing threshold evaluation remains authoritative. Primary monitoring labels are **Normal / Warning / Critical**; missing values remain neutral. No thresholds, numeric readings or raw stored statuses were changed by this pass. Tested 0.6 cm with **Critical** in UI, CSV and PDF. Historical water overall condition evaluates that water record; separate scans retain their own condition. Current summary safety can combine the independently timestamped latest records, as before.

## 7–9. Phone, tablet and desktop results

Tested all six requested sizes in light and dark themes:

| Viewport | Result |
| --- | --- |
| 360×800 | No unintended page overflow; report controls and long names fit |
| 390×844 | No unintended page overflow; CSV/Print usable; screenshots inspected |
| 412×915 | No unintended page overflow; report controls and long names fit |
| 768×1024 | Tablet layout and controls fit; screenshots inspected |
| 1366×768 | Desktop route/layout regression checks pass |
| 1440×900 | Desktop route/layout checks pass; screenshots inspected |

The new long-name audits visit Dashboard, Tanks, Tank Details, Readings, Reports, Marketplace, Product Details, Seller Profile, Orders and Settings. Threshold settings are tested through the routed Settings page; the separate `ThresholdSettingsPage.jsx` has no standalone route. The existing browser suite additionally covers authentication, alerts, listing forms, navigation, threshold saves, missing readings and other regressions.

## 10. Checks

- `npm run build`: PASS; built-output secret scan has zero findings. Final JS bundle is approximately 535.70 kB (146.40 kB gzip).
- `npm test`: PASS, 19 tests.
- `npm run test:browser`: PASS, 63 tests, zero failures/skips (3.2 minutes). The final native date-input theme adjustment was followed by two additional passing 390 px light/dark long-name audits.
- `npm run lint`: FAIL, the same 24 existing errors and 5 warnings. New browser tests and the export utility have zero findings. Reports retains its two existing `set-state-in-effect` errors. No rules disabled. A transient lint scan raced Playwright's cleanup of `test-results`; rerunning lint after browser completion produced the normal baseline findings.
- PDF inspection: PASS. Actual Chromium-generated PDFs were rendered and checked using [Mozilla PDF.js](https://github.com/mozilla/pdf.js/tree/master/examples/node). All seven documents have A4 portrait dimensions, text inside safe horizontal margins and no nearly blank pages. Rendered samples were visually inspected for readability/overlap. Water table headers repeat on later pages; separate ammonia dates/status text are preserved.

| Actual PDF fixture | Pages |
| --- | --- |
| Phone export with water and ammonia | 1 |
| All tanks, long name and alert | 2 |
| Selected long-named tank with ammonia | 2 |
| Selected long-named tank without ammonia | 1 |
| Marketplace | 1 |
| Combined monitoring/marketplace with ammonia and alert | 2 |
| 80 water readings plus two separate ammonia scans | 5 |

Screenshots, PDFs, actual CSV and machine-readable check output use ignored `.security-*` paths. They contain only synthetic fixture data. Example artifacts: `.security-mobile-report.csv`, `.security-mobile-report.pdf`, `.security-print-multipage.pdf`, `.security-mobile-controls-390-light.png`, and `.security-pdf-inspection.json`.

## 11. Mobile/browser limitations

Physical Android Chrome, Samsung Internet and iOS Safari were not available here. Browser/OS settings determine whether a CSV downloads, opens a preview, or requires Share → Save to Files. The app cannot force those OS flows. Browser popup settings and availability/naming of the print/PDF destination also vary. Page counters depend on browser support; report data/status text does not. Use the Reports **Print Report** button to open the dedicated complete export, then choose the native print/PDF destination.

Browser tests intercept backend traffic; live Supabase behavior and device data were not verified. The existing Vite >500 kB chunk warning remains. Existing ESLint failures remain a separate release gate. No deployment was performed.

## 12. Manual phone-browser checklist

1. Open Reports on a real phone in both themes; select All Tanks, then a long-named tank; adjust dates/conditions and refresh.
2. Download CSV for the current report and Tanks + Marketplace. Open the saved file and check row counts, the 0.6 cm Critical example, and scan timestamps against real data.
3. Open Print Report and use Print / Save PDF. Check all-tanks, selected tank, marketplace and combined exports; repeat with no scans and many records.
4. Check native popup/download/Share behavior and the saved A4 output on Android/iOS.
5. Visit the remaining monitoring/marketplace/order/settings pages and confirm names, controls and text remain readable without page-level sideways scrolling.

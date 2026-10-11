# Monitoring release status

2026-10-12. This Web release does not complete all seven cross-platform fixes.

| Fix | Current status | Remaining work |
| --- | --- | --- |
| #1 Philippine time | Web implementation and authenticated server-time RPC implemented | Mobile/firmware integration and deployed cross-platform checks |
| #2 Dynamic safe ranges | Web cards use effective tank thresholds | Actual Mobile card integration |
| #3 Configurable severity | Audit/proposal only | Approval, configured critical boundaries, implementation and compatibility validation |
| #4 Recommendations | Web panel and deterministic recommendations implemented | Fix #3 dependency, Mobile integration and live AI-provider verification |
| #5 | No task supplied in the available request history | Confirm its requirements before claiming completion |
| #6 Activity history | Web recorded-event history implemented with partial-history notice | Review/deploy activity SQL, address existing access-policy gaps, add missing backend events and integrate Mobile |
| #7 Sensor consistency | Web canonical readings, freshness and refresh synchronization implemented | Actual Mobile integration and simultaneous Web/Mobile/device acceptance |

The Expo application source is absent from this workspace. Portable shared
utilities and prepared adapters are not a completed Mobile integration.

Threshold inheritance remains selected tank override, then the authenticated
user's legacy row, then existing application defaults. No critical biological
boundaries were invented. Pump, feeder and automation interlocks are unchanged.

Pre-push regression checks caught and corrected two integration issues: the new
activity view lost the existing pump wording, and a late Dashboard snapshot
could change the recommendation panel's tank after an explicit selection.
Pump wording now preserves the execution-evidence checks, omits drain runtime,
and uses recorded refill runtime rather than requested duration. Raw records
are unchanged. An unconfirmed action remains unconfirmed.

No database changes are deployed by this GitHub push. The server-time migration
was deployed earlier. The pump wording migration remains prepared only; the
activity SQL remains a review draft under `docs/sql`. GitHub hosting deployment
and the live website must be checked separately after the push.

Build passes and the distribution credential scan has no findings. Full ESLint
still reports the documented 22 existing errors and 3 warnings. The existing
main-bundle size warning remains. The repository/history security scan flags
synthetic bearer strings in existing developer-service tests; inspection
confirmed those values are locally defined mock tokens, not credentials.

Final verification: 190 unit/integration tests passed, one retired test skipped;
65 distinct browser checks passed (64 in the combined run plus the new explicit
tank-selection regression). These checks cover time, safe ranges, recommendations,
reading synchronization, activity history, threshold Apply and pump wording.

See the individual audit documents for implementation scope, test coverage and
pending acceptance details. Mock browser tests are not production hardware or
cross-platform acceptance tests.

# Example release-readiness report

This is the shape of report a non-engineer should be able to read in two minutes. The
generated version for the current code is `artifacts/quality-report.md`.

---

## Recommendation: NOT READY

**Release:** Benefits Eligibility API — candidate `2026.11.16`
**Prepared by:** Quality Engineering
**Decision owner:** Engineering lead + product

### Why

- Two critical risks are open: applicant data can cross agency boundaries, and full Social
  Security numbers appear in API responses and in the audit timeline.
- Eligibility can be wrong for households paid every two weeks and for Alaska/Hawaii
  households. These are silent wrong answers, not crashes.
- The assistant that customers see by default follows instructions embedded in user
  messages and invents a dollar amount.
- 15 automated checks that describe required behavior are failing.

These are not "test coverage" concerns. Each one can cause a denied benefit, a privacy
breach, or misleading advice.

### What we verified

| Area | Evidence | Result |
| --- | --- | --- |
| Screening, applications, access control basics | 44 API/security/contract/integration checks | Pass |
| Critical applicant journeys (3 browsers) | 12 Playwright checks | Pass |
| Assistant behavior on the hardened prompt | 13 golden cases | 13/13 |
| Rules implementation vs independent oracle | Python unit suite | Pass for covered cases |
| Response time under a light load | 120 requests, concurrency 8 | p95 53 ms, 0 errors |

### What we did not verify

- Payments or benefit amounts: the product does not calculate them.
- Real vendor behavior, rate limits, schema drift and outages beyond the simulator.
- Peak traffic, long-running memory and database behavior at scale.
- Screen-reader journeys beyond automated checks; no manual audit this cycle.
- Every state's policy; the fixture covers representative expansion/non-expansion states.

### What would change the recommendation

1. Mask PII at the API and event boundaries; add payload scans to CI.
2. Enforce object-level authorization on every read, with a cross-tenant test matrix.
3. Fix income annualization and state guidelines; make the differential suite blocking.
4. Move the shipping prompt to the hardened version and enforce guardrails.
5. Re-run the full gate with no known-defect skips.

### Residual risk accepted at this time

None. The release is blocked until the five items above are addressed.

---

## What "READY" looks like

- All blocking suites pass on the release commit in the full browser matrix.
- No open critical/high risk without a named owner and time-bounded waiver.
- The shipping prompt passes the eval gate; prompt/model changes are versioned.
- Performance is inside budget for the expected launch workload.
- Accessibility has both automated and manual evidence.
- The report names residual risk and who accepted it.

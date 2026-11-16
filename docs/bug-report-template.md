# Bug report template

Copy this into an issue. Optimize for the person who has to fix it: reproducible, scoped,
and explicit about user impact.

```markdown
## Title
[Area] Short, specific statement of the wrong behavior

## Severity
Critical / High / Medium / Low — and why (who is harmed, how likely, how detectable)

## Environment
- Commit/build:
- Tenant(s) / state(s):
- Role / auth:
- Browser or client (if UI):
- Clock/timezone (if time-sensitive):

## Steps to reproduce
1.
2.
3.

## Expected
What should happen, with the policy or requirement reference.

## Actual
What happened. Include the smallest payload and the response/status.

## Evidence
- Failing probe/test name:
- Request/response or screenshot:
- Timeline events / vendor state:
- Logs or trace IDs (no PII):

## Scope and blast radius
Which programs, states, tenants, roles or data classes are affected? Is it silent or loud?

## Suspected area (optional)
File/function or hypothesis. Say "unknown" if you have not confirmed it.

## Fix acceptance criteria
- [ ] The failing behavior has a test that fails before the fix and passes after.
- [ ] Regression cases cover the boundary that caused it.
- [ ] No raw PII is added to responses, events or logs.
- [ ] Baseline suites remain green.
```

## Example: DEFECT-07

**Title:** [Async] A vendor timeout after processing creates a duplicate verification

**Severity:** High — duplicate verification records can lead to duplicate approvals and make
the audit trail wrong. Not user-visible immediately, which makes it worse.

**Environment:** agency-a, local simulator, commit as of 2026-11-16.

**Steps:**
1. `POST /internal/vendor/config {"failAfterRecord":1}`
2. Create a screening and an application for applicant-a.
3. Wait for `vendor.status = verified`.
4. `GET /internal/vendor/state`

**Expected:** one verification for the application; retry reuses the idempotency key.

**Actual:** two verification records (`vrf_00001`, `vrf_00002`) for one application.

**Evidence:** `tests/probes/async.probes.test.ts`; vendor state shows two records, timeline
shows one success event (which hides the duplicate).

**Blast radius:** every application whose vendor call times out after the vendor has
completed work; more likely during vendor incidents.

**Suspected area:** worker retry loop builds `${application.id}:${attempt}` as the
idempotency key.

**Acceptance criteria:**
- [ ] Retry uses a stable key for the logical verification.
- [ ] A timeout-after-processing produces one vendor record and one success event.
- [ ] An always-down vendor still fails after a bounded number of attempts.
- [ ] Test asserts both vendor state and timeline.

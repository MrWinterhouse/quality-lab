# Answer key and fix guide

Spoilers. Read after you have reproduced and triaged each probe.

Every defect has: the failing check, the user impact, the root cause, the smallest fix, and
the regression test that should survive the fix. Paths are relative to the repo root.

---

## DEFECT-01 — Biweekly pay uses 24 periods

**Probe:** `tests/probes/policy.probes.test.ts` → annual income / Medicaid status.
**Impact:** A household paid every two weeks is undercounted by 7.7%, so a borderline
household can be told it is eligible when it is over the limit — or, in other programs,
denied a benefit it qualifies for.
**Root cause:** `product/server/lib/policy.mjs`, `annualizeIncome`: `biweekly` returns
`amount * 24` (treating it as semimonthly).
**Fix:** `return amount * 26;`
**Regression:** Table-driven test over hourly, weekly, biweekly, semimonthly, monthly and
annual sources, including `hoursPerWeek`; keep the boundary case that crosses 138% FPL.
**The lesson:** "I caught an annualization error because I tested the unit of the
input, not just the monthly total."

---

## DEFECT-02 — Alaska and Hawaii guidelines ignored

**Probe:** Alaska single adult at $1,834/month, expected Medicaid eligible.
**Impact:** False ineligibility in two states (or false eligibility depending on which side
of the threshold), with a higher dollar impact because the guidelines differ by 25%/70%.
**Root cause:** `fplAnnual` computes `stateMultiplier = 1` and ignores `state`.
**Fix:**

```js
const multiplier = state === 'AK' ? 1.25 : state === 'HI' ? 1.70 : 1;
return Math.round(base * multiplier);
```

**Regression:** State matrix (contiguous, AK, HI) at each threshold; keep the FPL table in a
single fixture so a future update changes one place.
**Note:** The Python oracle had the same gap in its expansion list; the differential test
exposed that the fixture itself was wrong. Oracles need tests too.

---

## DEFECT-03 — Invalid household shapes accepted

**Probe:** zero-person household and `householdSize` ≠ `members.length`.
**Impact:** Nonsensical or misleading determinations; downstream jobs and vendors receive
data that cannot be reconciled; possible divide-by-zero-style errors if the rules evolve.
**Root cause:** `validateHousehold` checks the type of `householdSize` but not its range or
consistency with `members`.
**Fix:**

```js
if (!Number.isInteger(input.householdSize) || input.householdSize < 1) {
  errors.push('householdSize_out_of_range');
}
if (Array.isArray(input.members) && input.householdSize !== input.members.length) {
  errors.push('householdSize_member_mismatch');
}
```

**Regression:** 0, negative, non-integer, 1-with-0-members, 4-with-1-member, valid 1.
**Design question:** Is `householdSize` redundant if members are required? If so, derive it
and remove the contradiction instead of validating two sources of truth.

---

## DEFECT-04 — Tenant configuration leaks across agencies

**Probe:** request agency-a config, then agency-b config; B receives A's brand and programs.
**Impact:** Critical. An agency can see another agency's product configuration; deadline and
prompt settings can also bleed, causing wrong applicant-facing behavior.
**Root cause:** `product/server/app.mjs` caches one config object globally:

```js
let cachedTenantConfig = null;
function tenantConfig(tenantId) {
  if (!cachedTenantConfig) cachedTenantConfig = store.tenants[tenantId];
  return cachedTenantConfig;
}
```

**Fix:** cache per tenant key, or just read the immutable map:

```js
function tenantConfig(tenantId) {
  const config = store.tenants[tenantId];
  if (!config) throw httpError(404, 'unknown_tenant');
  return config;
}
```

**Regression:** Two tenants, both request orders, plus a parallel request test. Assert
enabled programs, deadline, timezone, prompt version and brand.
**The lesson:** "A cache key that omits tenant is a data-isolation bug, not a
performance bug."

---

## DEFECT-05 — Screening detail lacks object-level authorization

**Probe:** applicant B reads applicant A's screening by id.
**Impact:** Critical privacy breach; an applicant can enumerate other people's household
composition, income and immigration status.
**Root cause:** `GET /api/screenings/:id` authenticates the caller but never checks ownership
or tenant.
**Fix:**

```js
if (user.role === 'applicant' && screening.ownerId !== user.id) {
  throw httpError(403, 'forbidden');
}
if (user.role !== 'applicant') requireSameTenant(user, screening.tenantId);
```

**Regression:** authorization matrix (anonymous, owner, other applicant same tenant, other
tenant, caseworker same/different tenant, admin). Add a second object type (applications)
so the pattern is proven twice.
**Design question:** 403 vs 404. If ids are guessable, 404 avoids confirming existence; be
consistent and document the choice.

---

## DEFECT-06 — Raw SSNs in responses and events

**Probe:** create an application with `ssn: 123-45-6789`; response and timeline contain it.
**Impact:** Critical regulatory and trust exposure; event streams and support tooling often
have broader access than the application database.
**Root cause:** `serializeApplication` spreads `applicant` untouched, and
`store.createApplication` writes the full applicant into the `application.submitted` event.
**Fix:** mask on read with `maskSsn`, and redact before writing events:

```js
applicant: { ...application.applicant, ssn: maskSsn(application.applicant.ssn) }
```

```js
addEvent(application, 'application.submitted', { applicant: redactSsn(applicant) }, 'applicant');
```

**Regression:** response, detail, events, logs. Add a generic test that scans serialized
payloads for `\d{3}-\d{2}-\d{4}` so new fields cannot reintroduce the leak.
**The lesson:** "Masking in the UI is not data protection; the API and the event log
are the boundary."

---

## DEFECT-07 — Retry creates duplicate vendor verifications

**Probe:** `failAfterRecord: 1` (vendor processes then times out); wait for verified; vendor
state contains two records.
**Impact:** Duplicate verifications and potential duplicate approvals/charges; reconciliation
cost; confusing audit trail.
**Root cause:** the worker builds a new key per attempt:

```js
const idempotencyKey = `${application.id}:${attempt}`;
```

**Fix:** use a stable key for the logical operation:

```js
const idempotencyKey = application.id;
```

The vendor returns the existing record for a duplicate key, and the worker records a single
`vendor.verified` event.
**Regression:** timeout-after-processing, duplicate delivery, concurrent submissions. Assert
one vendor record, bounded attempts, one success event.
**The lesson:** "Idempotency belongs to the business operation, not the HTTP attempt."

---

## DEFECT-08 — Signed webhooks can be replayed

**Probe:** sign a payload with a timestamp one hour old; the endpoint returns 200.
**Impact:** An attacker who captures a valid callback can replay it to change application
state; signature verification alone does not establish freshness.
**Root cause:** `POST /api/webhooks/vendor` verifies the HMAC but never checks the timestamp.
**Fix:**

```js
const ageMs = Math.abs(Date.now() - Number(timestamp) * 1000);
if (!Number.isFinite(ageMs) || ageMs > 300_000) {
  throw httpError(401, 'stale_signature');
}
```

Keep the constant-time comparison, and consider a replay cache keyed by signature or event
id for in-window duplicates.
**Regression:** fresh accepted, stale rejected, future-dated rejected, tampered body
rejected, wrong tenant rejected, valid signature replayed twice.
**Note:** Test the clock boundary (299s vs 301s), not just "old".

---

## DEFECT-09 — Approval without evidence

**Probe:** approve with no `income_proof` and with a failed vendor verification.
**Impact:** Improper approvals, audit findings, benefits paid without required evidence.
**Root cause:** the decision handler checks role and current status but not the
preconditions for an approval.
**Fix:**

```js
const hasIncomeProof = application.documents.some((doc) => doc.type === 'income_proof');
if (body.decision === 'approved' && (!hasIncomeProof || application.vendor.status !== 'verified')) {
  throw httpError(409, 'missing_requirements');
}
```

**Regression:** the full transition matrix, including denial without documents, approval
with mismatched vendor hash, and approval after a duplicate document upload.
**Design question:** Should requirements live in the route, a policy object, or the domain
model? Put them where every caller must pass through them; test the domain rule directly.

---

## DEFECT-10 — Deadline is computed in UTC

**Probe:** submission at 2026-11-16T02:00Z (Nov 15 in Los Angeles), 10-day window, expected
Nov 25; API returns Nov 26.
**Impact:** Applicants lose or gain a day in their document window; the error appears only
for submissions near local midnight, so it can survive casual testing for a long time.
**Root cause:** `computeDeadline` takes `getUTCFullYear/Month/Date` and constructs a UTC end
of day, ignoring the tenant timezone.
**Fix:** use the local date and convert the wall-clock end of day back to an instant:

```js
const local = partsInZone(submittedAt, timeZone);
const target = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
const y = target.getUTCFullYear(), m = target.getUTCMonth() + 1, d = target.getUTCDate();
const endOfDay = zonedWallTimeToUtc(y, m, d, 23, 59, 59, 999, timeZone);
return { deadline: endOfDay.toISOString(), deadlineDate: `${y}-${pad(m)}-${pad(d)}` };
```

**Regression:** both tenant timezones, near-midnight submissions, month/year boundaries, and
DST transition dates. Test the displayed local date and the underlying instant.
**The lesson:** "A deadline is a local calendar concept; only the storage is an
instant."

---

## DEFECT-11 — Shipping prompt is vulnerable, guardrails are advisory

**Probe:** default tenant prompt follows an injection, states a guarantee and invents $973;
the hardened prompt passes the same cases.
**Impact:** Misleading benefits advice, potential legal exposure, loss of trust; injection
can be delivered by any user message.
**Root cause:** agency-a's `assistantPromptVersion` is `2026-02-a`, the vulnerable version,
and `respond()` only enforces guardrail violations for the hardened version.
**Fix:**
1. Move the shipping default to `2026-03-b` (or harden the older prompt).
2. Enforce guardrails for **every** version: if violations exist, replace the reply and set
   `blocked: true`.
3. Keep adversarial cases in the golden dataset, and gate prompt/model changes on the eval
   suite, not on a manual read-through.
**Regression:** injection variants ("ignore previous", "reveal your rules", role-play),
unsupported amounts, eligibility without a screening, missing citations, PII echo.
**The lesson:** "Prompt changes are model changes. They need regression tests and a
rollback path, not just a review."

---

## DEFECT-12 — Accessibility blockers

**Probe:** axe serious/critical violations: `label`, `color-contrast`, `button-name`.
**Impact:** Screen-reader and low-vision applicants cannot reliably complete the screener;
the chat is not discoverable by name.
**Root cause:**
- `#householdSize` is visually labeled with a `<p>`, not associated.
- `.hint` is `#9aa0a6` on white (2.64:1).
- `#chatToggle` contains only an `aria-hidden` SVG.

**Fix:**
```html
<label for="householdSize">Household size</label>
<input id="householdSize" ... />
```
```css
.hint { color: #5a6672; } /* ≥ 4.5:1 on white */
```
```html
<button id="chatToggle" aria-label="Open benefits assistant" ...>
```
**Regression:** axe at serious/critical, keyboard tab order, focus return when the assistant
closes, Escape behavior, and a screen-reader smoke test.
**Design question:** The assistant is a non-modal panel. Decide whether it should be a
dialog; if yes, implement focus trapping and return, and test it. If no, make the toggle
state and reading order obvious.

---

## DEFECT-13 — API disagrees with the Python oracle

**Probe:** differential run over three households.
**Impact:** Either implementation could be wrong; disagreement means at least one path
produces a legally wrong answer.
**Root cause:** DEFECT-01 and DEFECT-02.
**Fix:** fix both; keep the oracle independent (do not import production code) and add a
nightly generated-household differential run.
**Regression:** boundary-focused generated cases with a fixed seed; report the first
divergence with the household payload.
**Note:** If you fix the product by copying the oracle, you lose the independent signal. The
oracle should be maintained from the policy specification.

---

## FLAKY-01 — Fixed sleep races the worker

**Bad test:** `tests/flaky/timing.flaky.test.ts` sleeps 15 ms and asserts the vendor status.
**Why it is flaky:** the worker is asynchronous and the assertion depends on scheduling,
CPU load and test concurrency. Retrying hides the race and slows the suite.
**Fix:** poll a condition with a bounded timeout:

```ts
await waitForApplication(app, id, (application) => application.vendor.status === 'verified');
```

**Better:** expose a deterministic hook (drain the queue) or assert on the event timeline
after the worker signals completion. If you must wait, wait for a condition, never for a
duration.
**The lesson:** "A flaky test is a signal about the system or the test, not a reason
to add retries."

---

## Verification after all fixes

```bash
npm run typecheck
npm run test:baseline
npm run test:e2e
npm run evals -- --gate-shipping
npm run test:probes        # should be 14/14 passing
npm run test:e2e:probes    # should pass
npm run load
npm run report -- --gate   # READY
```

If you fixed everything, the probe suites become regression suites: move them into the
baseline suite rather than leaving them as a separate "known defects" job.

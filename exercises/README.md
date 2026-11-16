# Exercises

Fourteen concrete tasks. Each produces an artifact you can reuse in an interview or on the
job. Do them in order if you are new to the codebase; otherwise pick by weakness.

The product has known defects. Probes describe intended behavior and fail until fixed. The
answer key is in `docs/answer-key.md`.

---

## 1. Map the system and the existing coverage

**Skill:** learning unfamiliar business logic; coverage reasoning.
**Do:** Read `docs/system-tour.md`, run every suite, and inspect what each one asserts. Draw
the request path and the async path. List three user harms that no test covers.
**Deliverable:** one-page coverage map with a "not covered" column.
**Done when:** you can explain, without notes, what green means and what it does not.
**Hint:** counts are less interesting than boundaries. Look for what is never asserted
(tenant B, DST, illegal transitions, PII in events).

## 2. Reproduce and write three bug reports

**Skill:** triage; clear communication.
**Do:** Pick DEFECT-01, -05 and -07. Reproduce each with an HTTP client or a small script,
not by running the probe. Write reports using `docs/bug-report-template.md`.
**Deliverable:** three reports with impact, steps, expected/actual and evidence.
**Done when:** an engineer could fix each without asking you a question.
**Hint:** include the smallest payload and the exact status/body. State whether the failure
is silent.

## 3. Fix a rules defect test-first

**Skill:** strong test code; domain correctness.
**Do:** Fix DEFECT-01. Before changing product code, write a failing table-driven test that
covers every income frequency and a boundary at 138% FPL.
**Deliverable:** test + fix + probe green.
**Done when:** `npm run test:probes` has one fewer failure and the baseline is still green.
**Hint:** `tests/fixtures/households.ts` has builders; use them instead of literals.

## 4. Build the authorization matrix

**Skill:** security testing; object-level authorization.
**Do:** Fix DEFECT-04 and DEFECT-05. Then parameterize a matrix over anonymous, applicant A,
applicant B, caseworker A/B and admin for screenings and applications.
**Deliverable:** a test table that makes the expected status for every cell explicit.
**Done when:** adding a new endpoint has an obvious place to add its row.
**Hint:** test both tenants and both request orders; cache bugs hide in order.

## 5. Run a differential campaign

**Skill:** independent oracles; generated data.
**Do:** Use `python-oracle/` and the household builders. Generate 200 seeded households
around thresholds and compare program statuses. Report the first divergence with its payload.
**Deliverable:** a differential test (nightly or on demand) + a note on oracle independence.
**Done when:** you can explain why copying production logic into the oracle destroys the
signal.
**Hint:** keep the seed fixed in CI; print the household on failure.

## 6. Extend the contract

**Skill:** API/contract testing.
**Do:** Add the document-upload error response (or a new field) to `quality/openapi.json`,
add a provider test, and update the consumer contract if the web app depends on it.
**Deliverable:** schema + provider test + a note on what schema validation cannot catch.
**Done when:** a breaking change to the response fails the suite with a useful message.
**Hint:** validate error envelopes too, not just happy paths.

## 7. Break the async workflow

**Skill:** failure injection; idempotency; state machines.
**Do:** Fix DEFECT-07 and DEFECT-09. Add tests for: timeout after processing, always-down
vendor, duplicate webhook, mismatched household hash, approval without evidence.
**Deliverable:** a failure matrix table and tests for each row.
**Done when:** every failure leaves a defensible state and a truthful timeline.
**Hint:** assert vendor state and application state, not just the HTTP response.

## 8. Build test data and seeding

**Skill:** fixtures, environment seeding, complex data.
**Do:** Extend `tests/fixtures/households.ts` with pregnancy, immigration status, AK/HI,
hourly pay and zero income. Add a seeding helper for "application awaiting income proof".
**Deliverable:** builders used by at least three suites; no copy-pasted households.
**Done when:** a new scenario is one named function call, not a 40-line object.
**Hint:** default every field; only the dimension under test should vary.

## 9. Automate tenant configuration

**Skill:** configurable behavior; matrix testing.
**Do:** Fix DEFECT-04. Add a tenant matrix covering brand, programs, deadline days, timezone
and prompt version. Include both request orders and a parallel request.
**Deliverable:** parameterized API tests + one E2E branding/program test per tenant.
**Done when:** a third tenant can be added by configuration and the matrix covers it.
**Hint:** avoid asserting exact copy in many places; assert the contract and one
representative value.

## 10. Accessibility: automated plus human

**Skill:** a11y beyond a linter.
**Do:** Fix DEFECT-12. Then keyboard-test the journey: tab order, visible focus, opening and
closing the assistant, Escape, focus return. Decide whether the assistant should be a modal
dialog and implement the behavior you choose.
**Deliverable:** axe test + keyboard test + a short note on what automation misses.
**Done when:** the journey works without a mouse and the probe passes.
**Hint:** `aria-expanded` and focus return are part of the behavior; test them.

## 11. Grow the eval suite

**Skill:** LLM evaluation; guardrails; regression policy.
**Do:** Add five golden cases: a jailbreak variant, out-of-scope request, citation-required
answer, PII echo attempt, and a no-amount case. Write an LLM-as-judge rubric for tone and
groundedness, including calibration and drift checks.
**Deliverable:** expanded `tests/evals/golden.json` + rubric + regression policy.
**Done when:** flipping the shipping prompt to the vulnerable version fails the gate with
specific case names.
**Hint:** prefer programmatic assertions; use a judge only for what cannot be asserted.

## 12. Performance and resilience

**Skill:** load testing; thresholds that mean something.
**Do:** Run `npm run load`. Increase concurrency until p95 degrades, then record the knee.
Measure the same endpoint while the vendor is failing. Propose thresholds tied to user impact.
**Deliverable:** a one-page performance note: workload model, budget, bottleneck, risk.
**Done when:** you can say what workload the numbers represent and what they do not cover.
**Hint:** a p95 from 120 requests is a smoke signal, not a capacity plan.

## 13. Build the CI signal

**Skill:** CI plumbing; flake management; feedback speed.
**Do:** Read `.github/workflows/quality.yml`. Add a job or split an over-broad one. Run the
flaky test 20 times, classify the failure, rewrite it deterministically, and write a
quarantine policy.
**Deliverable:** workflow change + flaky-test postmortem.
**Done when:** the pipeline tells a reviewer what broke and where, and retries are not used
as a fix.
**Hint:** artifacts and failure messages are part of the product; make them useful.

## 14. Make the release call

**Skill:** reporting; prioritization; influence.
**Do:** Fix every defect until `npm run verify:release` passes. Then write a release memo for
a non-engineer: verified, not verified, residual risk, recommendation, rollback. Present it
to a friend and ask them to restate the decision.
**Deliverable:** green gate + one-page memo + feedback notes.
**Done when:** a non-engineer can explain the recommendation and what would change it.
**Hint:** "all tests pass" is not a recommendation. Say what risk remains and who owns it.

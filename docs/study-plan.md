# Study plan

Two to three focused hours a day. Each day produces an artifact you could show in an
interview or reuse on the job. Do not just read: run, break, fix, write.

## Before day 1

```bash
npm install
npx playwright install chromium firefox webkit
npm run test:baseline
npm run test:e2e
npm run test:probes
npm run report
```

Read the generated `artifacts/quality-report.md`. Sit with the fact that the baseline is
green and the release verdict is still **NOT READY**. That distinction is the job.

---

## Week 1 — see the system and build the core habits

### Day 1: Map the product and the existing coverage
- Read `docs/system-tour.md`; complete one screening and one application in the UI.
- Run each suite and record counts, runtime and what it actually asserts.
- **Deliverable:** one-page system/coverage map. Name three things no test covers.

### Day 2: Reproduce and report
- Pick DEFECT-01, -03 and -06. Reproduce each through the API (not only by running probes).
- Write three bug reports with `docs/bug-report-template.md`: impact, steps, expected,
  actual, evidence, suspected area. No fix yet.
- **Deliverable:** three reports a product manager could prioritize.

### Day 3: Fix rules test-first
- Fix DEFECT-01 and add a table-driven test covering hourly, weekly, biweekly, semimonthly,
  monthly and annual pay.
- Fix DEFECT-03 and test the boundaries: 0, 1, mismatch, non-integer, missing members.
- Re-run `npm run test:probes`.
- **Deliverable:** two probes green, baseline still green, one new decision-table test.

### Day 4: Authorization, tenancy and regulated data
- Read `tests/security/baseline.test.ts`. Threat-model the API in five minutes: who can call
  what, with which tenant, owning which record?
- Fix DEFECT-04 (config cache) and DEFECT-05 (screening ownership).
- Write down why a 404 vs 403 choice matters for enumeration.
- **Deliverable:** tenant-isolation matrix (applicant A/B, caseworker A/B, admin, anonymous).

### Day 5: Async and external dependencies
- Draw the sequence: submit → worker → vendor → retry → timeline.
- Fix DEFECT-07 (idempotency key). Prove it with `failAfterRecord:1`.
- Add a test for "vendor always down": status stays safe, one failure event, bounded attempts.
- **Deliverable:** sequence diagram plus one new resilience test.

### Day 6: Contracts and boundaries
- Open `quality/openapi.json`; find one endpoint whose response is not fully covered.
- Add a schema to the contract and a provider test for an error path.
- Read the consumer contract. Explain to yourself why consumer and provider checks catch
  different failures.
- **Deliverable:** one new contract test plus a note on what schema validation cannot catch.

### Day 7: Web, accessibility and configuration
- Run the axe probe; fix DEFECT-12 (label, contrast, button name).
- Keyboard-test the screener and the assistant (tab order, focus after open/close, Escape).
- Compare agency-a and agency-b: branding, programs, deadlines, prompt. Write the
  configuration matrix you would automate.
- **Deliverable:** fixed a11y probe, one keyboard test, tenant matrix.

---

## Week 2 — depth, AI, performance, and the release conversation

### Day 8: Test data and fixtures
- Read `tests/helpers/app.ts` and `tests/fixtures/`. Extend the builder with pregnancy,
  immigration status, Alaska/Hawaii, hourly pay, and no-income cases.
- Add a seeding helper that creates "application awaiting income proof".
- **Deliverable:** builders used by at least three tests; no copy-pasted households.

### Day 9: AI evaluation design
- Run `npm run evals`; compare hardened vs shipping.
- Add five golden cases: a jailbreak variant, an out-of-scope request, a citation-required
  question, a PII echo attempt, and a "no amount" case.
- Write a rubric for an LLM-as-judge grader, including how you would calibrate it against
  human labels and how you would catch judge drift.
- **Deliverable:** expanded dataset, rubric, and a one-paragraph regression policy for prompt
  and model changes.

### Day 10: Performance and failure behavior
- Run `npm run load`. Raise concurrency until p95 degrades; record the knee.
- Measure the same endpoint while the vendor is failing. Decide whether the current
  thresholds are meaningful.
- **Deliverable:** a short performance note: workload model, thresholds, bottleneck, risk.

### Day 11: CI, flakiness and signals
- Read `.github/workflows/quality.yml`. Add a job or split one that is too broad.
- Run the flaky test 20 times and classify the failure (race, environment, ordering, data).
- Rewrite it as a deterministic wait, then explain why retries are not a fix.
- **Deliverable:** CI sketch plus a flaky-test postmortem.

### Day 12: Drive the release gate green
- Fix the remaining defects one at a time: 02, 08, 09, 10, 11, 13.
- For each: test first, smallest fix, re-run baseline and probes.
- `npm run verify:release` must pass with no skips.
- **Deliverable:** green gate, and a diff small enough to review.

### Day 13: Write for non-engineers
- Rewrite `docs/quality-strategy.md` in your own words for this product.
- Produce a release memo for a hypothetical launch: what is verified, what is not, what you
  recommend, what would change your mind.
- **Deliverable:** two documents, no jargon without a definition.

### Day 14: Interview rehearsal
- Use `docs/interview-prep.md`. Answer four prompts aloud in 5 minutes each.
- Prepare three STAR stories: introducing quality practice, catching a high-impact defect,
  disagreeing about release readiness.
- Ask yourself Mirza's question: how would you know the January 2027 Medicaid changes did
  not break eligibility for 20 million people?
- **Deliverable:** recorded 30/60/90 plan and six questions to ask them.

---

## Two-day track

**Day A (4 hours):** quickstart, system tour, baseline, reproduce DEFECT-01/05/07, write
three bug reports, fix DEFECT-01.
**Day B (4 hours):** fix DEFECT-04, -09, -10; run the a11y probe and fix it; expand the eval
set by three cases; generate the report and write a one-page readiness memo.

You will not fix everything, but you will have touched rules, security, async, UX, AI and
reporting — the shape of the role.

---

## Habits to practice deliberately

- **Risk first.** Before writing a test, say what user harm it prevents.
- **One behavior per test.** Names describe behavior, not implementation.
- **Boundaries.** Exactly at, one unit below, one unit above every threshold.
- **Determinism.** No fixed sleeps; control clocks and dependencies.
- **Evidence.** Every claim in a report links to a command, artifact or probe.
- **Small fixes.** A failing test should make the fix obvious.
- **Say what you did not test.** That sentence is what separates a useful QE from a green
  checkmark.

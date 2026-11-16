# Quality strategy — Benefits Eligibility Platform

This is a model document, not a claim about Mirza's actual internals. Rewrite it in your
own words, keep the structure, and change anything that does not fit what you learn in
interviews.

## 1. Purpose

We need a fast, evidence-backed answer to "is this ready to ship?" for a product where:

- eligibility errors can deny or delay benefits people are entitled to;
- the domain is defined by federal and state policy that changes on known and unknown dates;
- customer data is sensitive and access is regulated;
- the same software is configured differently for every agency and health plan;
- some outputs come from non-deterministic models.

Green tests are not the goal. **Correctness in the dimensions that carry risk** is the goal.

## 2. What "quality" means here

1. **Policy correctness** — the right household gets the right answer, at the right
   boundary, in every supported state and configuration.
2. **Data integrity** — nothing is lost, duplicated, or silently mutated across service and
   vendor boundaries; the audit trail tells the truth.
3. **Tenant isolation** — an agency sees its configuration, data, branding and deadlines,
   and nothing else.
4. **Data protection** — minimum necessary PII, masked at rest and in transit through logs,
   events, fixtures and support tooling.
5. **Resilience** — slow, wrong or unavailable dependencies degrade safely and recover.
6. **Accessibility** — applicants can complete the journey with assistive technology.
7. **AI trustworthiness** — the assistant is grounded, cites policy, refuses out-of-scope
   requests, and never invents eligibility or amounts.
8. **Operability** — a release decision is visible, understandable and reproducible.

## 3. Risk model

Score likelihood × impact, then choose test depth. Example register (see
`quality/risk-register.json`):

| Risk | Impact | Signals | Primary mitigations |
| --- | --- | --- | --- |
| Wrong eligibility near a threshold | Denial of entitled benefits; regulatory exposure | Boundary tests, decision tables, differential oracle, golden policy fixtures | Policy versioning, approval tests, state matrix |
| Cross-tenant data/config leakage | Critical privacy and contractual breach | Authorization matrix, IDOR probes, cache tests | Deny-by-default authz, tenant-scoped queries, contract tests |
| PII in logs/events/responses | Regulatory breach, trust loss | Response/log/event scans, masking tests | Redact at write, mask at read, data-classification tests |
| Vendor timeout/retry duplicates verification | Incorrect approvals, duplicate records | Idempotency tests, failure injection, timeline assertions | Stable idempotency keys, bounded retries, reconciliation |
| Approval without required evidence | Improper payment, audit finding | State-machine tests, decision guard tests | Explicit transition guards, invariant tests |
| Deadline off by a day | Missed document window, coverage loss | Timezone/DST matrix, clock control | Local-date math, property tests around DST |
| Prompt injection / hallucinated amounts | Misleading benefits advice, legal risk | Golden dataset, adversarial cases, guardrail checks, prompt regression | Grounded retrieval, refusal policy, eval gate, human review |
| Configuration-specific breakage | One agency broken while others pass | Tenant matrix in API and E2E | Config contract, seeded tenants, canary per tenant |
| Accessibility barrier | Applicants cannot apply | axe in CI, keyboard and screen-reader checks | Design-system components, manual audit per journey |
| Policy change on a fixed date (e.g. Jan 2027) | Mass eligibility errors | Effective-date tests, policy version pinning | Dual-run old/new rules, reconciliation, staged rollout |

## 4. Test portfolio

Risk-based, not a purity contest. Roughly:

| Layer | Scope | Cadence | Signal |
| --- | --- | --- | --- |
| Unit / decision tables | FPL math, annualization, thresholds, state rules | Every commit | Precise, fast, cheap |
| Property / differential | Rule invariants vs independent oracle and generated households | Every commit or nightly | Finds boundary classes humans miss |
| API | Validation, authz, status codes, state transitions | Every commit | Contract of the service |
| Contract (consumer + provider) | Request/response schemas, error envelopes, backwards compatibility | Every commit | Integration drift before deploy |
| Integration | API + worker + vendor + store; retries, webhooks, hash mismatch | Every commit | Seams and async behavior |
| E2E | Applicant journeys across browsers; tenant variants | Every PR, full matrix pre-release | User-visible truth |
| Accessibility | axe on key pages; keyboard and screen-reader scripts | Every PR + manual per release | Usable by assistive tech |
| AI evals | Golden dataset, adversarial cases, prompt/model versions | Every prompt/model change + nightly | Behavioral regression |
| Performance | Load smoke every PR; deeper profiles pre-release | PR + release | Latency/error budgets |
| Security | Authz matrix, PII scans, dependency and secret scanning | PR + scheduled | Exploitable classes |
| Exploratory | Time-boxed sessions on new risk areas | Weekly / per feature | Unknown unknowns |

**Coverage philosophy:** track *risk covered*, not line coverage. A 92% coverage number with
no boundary cases for biweekly income is worse than 60% coverage concentrated on money and
authorization paths.

## 5. Rules and decision engines

- **Decision tables** per program × state × household shape. Every row is a test; every
  threshold has exactly-at, below, above.
- **Golden policy fixtures** checked into the repo, reviewed like code, versioned by policy
  effective date.
- **Differential testing** against a second implementation (here: the Python oracle). It
  catches shared assumptions and arithmetic drift. Keep the oracle independent; do not
  import the production implementation into it.
- **Property tests** for invariants: adding a dollar never turns an eligible household
  ineligible at the same threshold; household size never lowers the FPL; annualization is
  monotonic.
- **Effective-date tests** with a controlled clock: before, on, and after a rule change, plus
  grace-period behavior.
- **Explainability**: every result carries a reason code and the threshold it compared
  against. Test the explanation, not just the boolean.

## 6. APIs, contracts and integrations

- OpenAPI is the provider contract; validate real responses in tests, including errors.
- Consumer contracts capture what the web app and downstream services actually need.
  Breaking changes require a version bump and a migration plan.
- Contract tests do not replace integration tests: schemas cannot express "the vendor's
  `verified` flag is meaningless without a household hash match."
- For external dependencies, test four states: fast/success, slow, down, and **wrong**
  (malformed, stale, mismatched).
- Use a vendor simulator with controllable failure modes; keep one nightly run against a
  vendor sandbox if one exists.
- Record and assert idempotency keys, retry counts and resulting records.

## 7. Async workflows

- Model the workflow as a state machine. Test every legal transition and every illegal one.
- Assert on the **timeline** (append-only events) and on the **final durable state**, not on
  internal function calls.
- Inject failures at each step: before processing, after processing but before response,
  during webhook delivery, duplicate delivery.
- Control time. Avoid sleeps; poll for observable conditions with bounded timeouts.
- Define reconciliation: what detects and repairs a stuck application or duplicate vendor
  record?
- Require signed webhooks with timestamp freshness, replay protection and constant-time
  comparison; test with a captured-and-replayed request.

## 8. Web, tenants and accessibility

- Journey tests for the critical paths: screen → apply → upload → decision → status.
- Browser matrix in CI (Chromium, Firefox, WebKit) and a device/responsive sample.
- Tenant configuration matrix: branding, enabled programs, deadlines, timezone, assistant
  prompt, feature flags. At minimum two tenants in every shared test run, in both orders, to
  catch cache poisoning.
- Accessibility: axe violations at serious/critical block the PR; keyboard path (including
  focus return when closing the assistant); one screen-reader pass per release on the
  primary journey; zoom/reflow at 200%.
- Visual regression only for stable, high-value surfaces; otherwise it becomes noise.

## 9. AI and conversational experiences

Treat prompts and models as versioned dependencies.

- **Golden dataset** of representative and adversarial conversations, with expected
  properties (must cite, must refuse, must not include PII, must not invent amounts).
- **Programmatic graders** first (citations present, forbidden strings, scope, refusals).
  **LLM-as-judge** only for qualities that cannot be asserted, with a rubric, a held-out
  calibration set, and periodic agreement checks against humans. Record judge model and
  prompt version; a judge change is a test change.
- **Prompt regression gate**: no prompt/model change ships without running the suite;
  compare pass rate and per-case diffs, not just a total.
- **Guardrails in depth**: input classification (injection, out-of-scope), retrieval
  grounding, output validation (amounts, guarantees, PII), and refusal behavior. Test the
  guardrail itself, including false positives.
- **Online monitoring**: refusal rate, citation rate, escalation rate, user-reported wrong
  answers, latency and cost. Offline evals never cover the long tail.
- **Human review** for high-stakes answers (eligibility determinations) until evidence
  supports automation.

## 10. Security and regulated data

- Threat model per release: assets, actors, trust boundaries, abuse cases.
- Authorization matrix in tests: anonymous, applicant A/B, caseworker A/B, admin, cross-
  tenant. Include object-level checks, not just route-level roles.
- Deny by default; scope every query by tenant and owner; return 404 when confirming
  existence would leak.
- PII minimisation: collect only what is needed, mask at the edge, redact before events and
  logs, never put production data in fixtures.
- Test data: synthetic by default; if production-like data is unavoidable, use a controlled
  environment with access approval, field-level masking, retention limits and audit.
- Secrets never in code, fixtures, browser bundles or test reports. Rotate vendor secrets.
- Dependency, container and secret scanning in CI; treat critical findings as release
  blockers.
- Test the audit trail: who accessed what, when, and whether support tooling obeys the same
  rules.

## 11. Environments, data and reproducibility

- Local: deterministic in-memory stack, controllable clock, scripted vendor failures.
- Preview per PR: seeded tenant configuration, synthetic data, auth in test mode.
- Staging: production-like topology, masked data, real vendor sandboxes where possible.
- Production: canary, feature flags, observability, rollback. No test-only backdoors.
- Seed scripts are versioned and idempotent. A test that depends on manual setup is a future
  flake.
- Every failure artifact includes the app commit, test commit, environment, seed and
  request/trace IDs.

## 12. Reporting and metrics

The release report answers three questions in plain language:

1. What did we verify, and how?
2. What is **not** verified, and what risk does that carry?
3. What do we recommend, and what would change the recommendation?

Useful metrics:

- escaped defects by severity and discovery stage;
- percentage of high-risk areas with automated coverage (not line coverage);
- flake rate and time to signal (commit → trustworthy result);
- mean time to triage a failing suite;
- eval pass rate by prompt/model version, plus refusal/citation rates;
- accessibility violations and manual audit findings;
- vendor failure recovery time;
- release-readiness lead time.

Avoid vanity metrics: test count, raw coverage percentage, pass rate without scope.

## 13. Release criteria

A release is ready when:

- all blocking suites pass on the release commit, in the full browser matrix;
- no open critical/high risk lacks an explicit, signed acceptance;
- eval gates pass for the shipping prompt version;
- performance is inside the agreed budget for the expected workload;
- security checks pass and no new PII exposure exists;
- rollback is tested or demonstrably safe;
- the readiness report names residual risk and the owner who accepted it.

Waivers are explicit, time-bounded, and recorded in the report. "Known issue" without an
owner is not a waiver.

## 14. Introducing and sustaining the practice

- Start where the pain is: one high-risk journey, one flaky suite, one release decision.
- Pair with engineers on tests for their own changes; review test code like product code.
- Make the fast suite fast enough to run locally; make the slow suite trustworthy.
- Quarantine flaky tests with an owner and a deadline; never normalize retries.
- Publish a weekly signal: what broke, what was caught, what escaped, what changed.
- Define "done" together: behavior specified, tests at the right level, observability,
  accessibility, and a rollback story.
- Bring implementation and support teams into acceptance testing during development, not at
  the end. Their scenarios become E2E tests.

## 15. First 90 days (draft)

**Days 1–30:** map systems and risks; get the baseline suite trustworthy and fast; fix the
highest-risk authorization and PII issues; establish a release-readiness template; meet the
delivery teams and watch real acceptance sessions.

**Days 31–60:** build the rules test strategy (decision tables, differential oracle,
effective-date tests); make contract and async coverage real; stand up the eval gate for the
assistant; add the tenant matrix to CI.

**Days 61–90:** publish quality reporting that non-engineers use; run a release readiness
review; reduce flake and time-to-signal; define engineer-owned testing expectations and
coach teams; propose the next quarter's risk-based roadmap.

## 16. Anti-patterns to avoid

- Chasing coverage percentage instead of risk.
- E2E tests for every rule; slow, flaky, and hard to diagnose.
- Retrying flaky tests instead of fixing them.
- Testing implementation details that make refactors painful.
- Treating schema validation as integration testing.
- Using production data in fixtures.
- Judging AI quality by a handful of happy-path prompts.
- Reporting "all green" without saying what was not tested.

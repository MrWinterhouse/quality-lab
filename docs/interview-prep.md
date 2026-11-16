# Interview preparation

The role is "first dedicated Quality Engineer" at a company whose product decides whether
people get benefits. Expect questions about judgment, ambiguity, influence, and technical
depth across rules, async systems, web, security and AI. They will care less about whether
you know a specific tool and more about whether you can make quality visible and
trustworthy from a low baseline.

## What they are likely evaluating

1. **Can you define a strategy from risk, not from a template?**
2. **Can you build automation other engineers respect?** Strong code, deterministic tests,
   good failure messages.
3. **Can you test things that are hard to test?** Rules, async, vendors, AI, tenant
   configuration.
4. **Can you communicate a release decision to non-engineers?**
5. **Can you influence without authority and work across teams?**
6. **Do you handle sensitive data and security as engineering constraints, not afterthoughts?**
7. **Are you pragmatic about coverage and time?**

## STAR stories to prepare (write your own facts)

For each: situation, what you did, measurable result, what you would do differently.

1. **Stood up a practice from nothing.** What did you start with, what did you ignore, how did
   you get the first team to adopt it?
2. **Caught a high-impact defect before release.** How did you find it, how did you prove
   impact, what changed afterward?
3. **Disagreed about release readiness.** How did you present evidence, who decided, what was
   the outcome?
4. **Made a flaky suite trustworthy.** Diagnosis, fix, policy change, before/after signal.
5. **Introduced quality into a team that resisted it.** What was the resistance, what
   compromise worked, how did you measure adoption?
6. **Handled a policy/requirements ambiguity.** How did you expose it, who did you involve,
   how did you encode the decision in tests?
7. **Improved security or data handling.** Threat, change, test, compliance impact.
8. **Built reporting non-engineers used.** What did they do differently because of it?

Keep each to 90 seconds. Have one metric per story (escaped defects, time to signal, flake
rate, release lead time, adoption).

## Technical prompts and strong answer outlines

### 1. "How would you test eligibility rules across 200+ programs?"

- Partition: program × state × household shape × income type × immigration status ×
  effective date.
- Unit decision tables for each rule; boundary values at exactly, below and above every
  threshold.
- Independent oracle / differential testing for arithmetic; property tests for invariants.
- Golden policy fixtures reviewed like code, versioned by effective date.
- Effective-date tests with a controlled clock; dual-run old/new rules during changes.
- Explainability assertions (reason codes, thresholds), not just booleans.
- Operational monitoring for result-distribution shifts after policy releases.
- Prioritize by benefit impact and volume; not every program needs the same depth.

### 2. "How would you test the async vendor integration?"

- Model the state machine and test legal and illegal transitions.
- Failure matrix: fast success, slow, down, timeout after processing, malformed response,
  wrong household, duplicate delivery.
- Idempotency: stable key for the logical operation, assert one record and one audit event.
- Bounded retries with backoff; assert attempt count and terminal state.
- Timeline/outbox assertions; reconciliation job for stuck records.
- Clock control and deterministic hooks instead of sleeps.
- Webhooks: HMAC, timestamp freshness, replay cache, tenant binding, hash mismatch.
- Observability: alert on age of pending verifications and duplicate rate.

### 3. "How would you test multi-tenant configuration?"

- Contract for the config shape; required keys and defaults.
- Matrix of tenants × programs × timezones × prompt versions × feature flags.
- Both request orders and parallel requests to catch cache keying bugs.
- Authorization: config and data are tenant-scoped at the query level.
- E2E branding/program visibility per tenant.
- Safe rollout: per-tenant canary and kill switch.
- Regression: adding a tenant should not change existing tenants' behavior.

### 4. "How would you build an eval program for an LLM feature?"

- Define behaviors and harms; turn each into a case with an assertion.
- Golden dataset: representative, boundary, adversarial, out-of-scope, PII, injection.
- Programmatic graders first (citation present, forbidden strings, refusal, schema).
- LLM-as-judge only where needed: explicit rubric, calibration set, human agreement,
  judge-version pinning, drift checks.
- Version prompts and models; gate changes on pass rate and per-case diffs; keep rollback.
- Guardrails tested directly, including false positives.
- Online monitoring: refusal rate, citation rate, escalation, user reports, latency, cost.
- Human review for high-stakes determinations; evals are evidence, not proof.

### 5. "It's release eve. The suite is red and one test is flaky. What do you do?"

- Triage by user harm and likelihood, not by test count.
- Determine whether red is product, test, environment or data; reproduce on the release
  commit.
- Quarantine the flaky test with an owner and a deadline; never "fix" with retries.
- Run the highest-risk suites and a focused exploratory session on the changed area.
- Produce a written recommendation: verified, not verified, residual risk, rollback plan.
- Escalate the decision to the accountable owner with evidence, not opinion.

### 6. "How do you approach API and contract testing?"

- OpenAPI as provider contract; validate success and error responses against real behavior.
- Consumer contracts for what clients actually depend on.
- Backwards compatibility: additive changes, versioning, deprecation.
- Contract tests do not prove semantics; pair with integration tests for invariants
  (ownership, hashes, idempotency).
- Negative tests: validation, authz, unknown ids, oversized bodies, malformed JSON.
- Run on every PR; publish a compatibility report for consumers.

### 7. "How do you handle sensitive data in a regulated environment?"

- Data classification and minimization; collect only what is needed.
- Mask at read, redact at write (events/logs), never log payloads wholesale.
- Synthetic fixtures by default; production-like data only with approval, masking,
  retention and audit.
- Authorization matrix incl. object-level and tenant-level checks; deny by default.
- Secrets in a managed store; rotate; scan dependencies and commits.
- Test the audit trail and support tooling, not just the customer app.
- Make PII leakage a blocking test class, not a checklist item.

### 8. "How do you report quality to non-engineers?"

- Lead with the decision and what it means for users.
- Separate "verified" from "not verified"; quantify residual risk.
- Link every claim to evidence (suite, probe, artifact).
- Avoid coverage percentages and tool jargon.
- Name the owner and expiry of any accepted risk.
- Keep it to one page; offer detail on request.

### 9. "How do you measure quality without vanity metrics?"

- Escaped defects by severity and discovery stage.
- Risk coverage: which high-risk behaviors have trustworthy automated checks.
- Flake rate, time to signal, triage time, suite runtime.
- Eval pass/refusal/citation rates by prompt/model.
- Vendor recovery time, stuck-workflow age.
- Release lead time and post-release incident rate.
- Pair metrics with a narrative; a number without scope is noise.

### 10. "What would your first 90 days look like?"

- Weeks 1–2: listen, map systems and risks, run the existing tests, talk to delivery and
  implementation teams, find the release decision path.
- Days 15–30: make the highest-risk path trustworthy (authz, PII, rules); establish a
  baseline suite and a one-page readiness report; fix one painful flake.
- Days 31–60: rules decision tables + differential oracle; contract and async coverage;
  tenant matrix; CI signal.
- Days 61–90: eval gate for AI, performance budget, engineer-owned testing expectations,
  coaching, and a risk-based roadmap for the next quarter.
- Success: teams ask for the signal before shipping, and non-engineers can explain what is
  and is not verified.

## Mirza-specific preparation

- **Domain:** 200+ programs across 50 states, including Medicaid, SNAP, WIC and childcare.
  "Apply once" means data crosses program boundaries — test the seams, not just each form.
- **The January 2027 Medicaid changes:** roughly 20 million adults affected. Think
  effective-date testing, dual-run/reconciliation, state-by-state configuration, regression
  fixtures, and how you would detect a mass eligibility error quickly.
- **Customers:** agencies, health plans, health systems, employers, colleges, unions. Each is
  a tenant with different configuration and reporting needs.
- **Stakes:** a false negative can cost someone coverage; a false positive can create
  improper payments and audit exposure. Both matter, and they need different tests.
- **Regulated access:** least privilege, auditability, masked data, environment controls.
- **AI:** conversational experiences where non-determinism is expected. Show that you can
  make evaluation a repeatable engineering practice.

## Questions to ask them

1. How do releases work today, and who makes the ship/no-ship call?
2. What is the most expensive defect you have shipped in the last year?
3. Which parts of the system are hardest to test, and why?
4. What does "done" mean on a delivery team today?
5. How do implementation teams run acceptance testing with customers?
6. What access will I have to production-like data, and what controls apply?
7. How are prompts and models versioned and rolled back?
8. What would success look like at 3, 6 and 12 months for this role?
9. How do engineering, product and policy teams resolve ambiguous requirements?
10. What is on-call like for the services I would cover?

## A 90-second "why me" outline

- I have built test automation from a low baseline and made it something engineers trust.
- I test at the level where risk lives: decision tables for rules, contracts and failure
  injection for integrations, evals for model behavior.
- I make quality legible: a one-page readiness decision with evidence and explicit gaps.
- I have worked in regulated/sensitive-data environments and treat PII and authorization as
  product requirements.
- I am comfortable being the first QE: I prioritize, build the foundation, and coach teams
  rather than waiting for a framework to be handed to me.

## Live/take-home exercise tips

- Ask clarifying questions about users, scale, policy ambiguity and what "correct" means.
- State your risk model before writing tests.
- Automate the highest-value path first, then explore manually for the weird cases.
- Show failure output and a bug report, not just a passing test.
- Leave a short note: what you covered, what you skipped, what you would do next.
- If you find a defect, say the user impact in one sentence.

## Answers to avoid

- "I would test everything" or "100% coverage".
- Tool name-dropping without trade-offs.
- Treating flakiness as normal and retries as a fix.
- Testing only through the UI.
- Ignoring data protection because "it's a test environment".
- Claiming an LLM is "tested" because a few prompts looked fine.
- Reporting "all green" without naming what was not tested.

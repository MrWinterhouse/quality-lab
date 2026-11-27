# Benefits Eligibility Quality Lab

**Live portfolio:** <https://mrwinterhouse.github.io/quality-lab/> — built from `site/` and published by the `quality` workflow on every push to `main`. Preview it locally by opening `site/index.html` (or `npx --yes serve site`); report links resolve only in the published build.

A small, deliberately imperfect **public-benefits eligibility product** plus the test
infrastructure around it: rules that must be correct, vendors that fail after doing the
work, tenants that must stay isolated, an assistant that must not invent a dollar amount,
and a release decision a non-engineer can act on.

It is a worked example of building quality into a system where being wrong is quiet.
Everything runs offline, the seeded defects are documented rather than hidden, and the
release gate returns **NOT READY** with the reasons attached. Names, agencies and data are
fictional.

- **Baseline suites are green.** They show the patterns (API, contract, integration,
  E2E, accessibility, evals, load, reporting).
- **15 probe checks are red by design.** They describe correct behavior the product does
  not yet have. Find them, triage them, write bug reports, fix them, and the release gate
  turns green.
- **Everything runs offline.** No API keys, no accounts, no cloud dependencies.

---

## Quickstart

```bash
npm install
npx playwright install chromium firefox webkit

npm run typecheck
npm run test:baseline        # 44 node:test checks, green
npm run test:e2e             # 12 checks across Chromium, Firefox, WebKit
npm run evals -- --gate      # hardened prompt 13/13
npm run load                 # p95 smoke against two endpoints
npm run test:python          # 7 Python oracle checks
npm run test:chatbot         # hiring assistant golden dataset, 71/71
```

See the defects:

```bash
npm run test:probes          # 14 node:test probes, red by design
npm run test:e2e:probes      # accessibility probe, red by design
npm run evals -- --gate-shipping   # shipping prompt 10/13, red by design
npm run report               # writes artifacts/quality-report.md
```

Run the product:

```bash
npm run dev                  # http://127.0.0.1:4310
```

The demo UI signs in as `applicant-a` by default. Use `?as=applicant-b` for the second
agency, or call the API with a bearer token.

---

## How to work through it

Read it as a worked example, not a course:

1. **Map before you test.** Read `docs/system-tour.md`, start the app, and complete a
   screening and an application. Draw the boundaries: browser → API → rules → vendor →
   event timeline → reporting.
2. **Run the green baseline.** Understand what it does and does not prove. Green is not
   the same as ready.
3. **Triage one red probe.** Reproduce it, reduce it, identify the root cause, and write
   a bug report another engineer can act on (`docs/bug-report-template.md`).
4. **Fix it test-first.** Add or strengthen a test, then change the smallest amount of
   product code. Re-run the probe and the baseline.
5. **Repeat until `npm run verify:release` is green.** That command is the intended
   release gate: typecheck, baseline, every browser, evals, probes, load and report.
6. **Write the artifacts a release needs.** A test strategy, a release-readiness report a
non-engineer can act on, and a coverage map that names what is *not* verified.

Fourteen tasks with concrete deliverables: `exercises/README.md`.
Supporting material: `docs/quality-strategy.md` (the strategy), `docs/system-tour.md`
(mapping the system), `docs/answer-key.md` (root causes and fixes for every seeded defect).

---

## What the product does

| Capability | Behavior |
| --- | --- |
| Eligibility screening | Medicaid, SNAP, WIC and CHIP for a household in any US state |
| Applications | Submit, upload documents, caseworker review, approve or deny |
| Async verification | An in-process worker calls a simulated income vendor, retries, records events |
| Multi-tenant configuration | Two agencies with different branding, programs, deadlines and timezones |
| AI assistant | Deterministic, offline assistant with prompt versions, guardrails and evals |
| Reporting | Admin readiness endpoint and generated markdown report |

It is a simplified model, **not** legal, policy or benefits advice. Rules are fixtures for
testing practice, not authoritative program rules.

---

## What the lab covers

| Capability | Where to see it |
| --- | --- |
| End-to-end journeys, smoke suite, integration coverage | `tests/e2e/`, `tests/integration/`, `docs/quality-strategy.md` |
| Web across browsers/devices, accessibility, configurable behavior | `playwright.config.ts` (3 browsers), `tests/probes/e2e/`, tenant config |
| APIs, events, external systems, contract testing, bad dependencies | `tests/contract/`, `tests/integration/workflow.test.ts`, vendor simulator |
| AI evals, golden data, prompt regression, guardrails | `tests/evals/`, `scripts/run-evals.mjs`, `product/server/lib/assistant.mjs` |
| Portfolio hiring assistant, golden dataset, page test, figure drift check, published report | `site/chat/`, `tests/chatbot/golden.json`, `scripts/chatbot-evals.mjs`, `scripts/check-chat-page.mjs`, `scripts/check-chatbot-figures.mjs`, `site/chat/coverage.json` — page at `site/chat.html`, with a per-answer test panel |
| Acceptance testing with implementation teams | `docs/quality-strategy.md` + exercises 2 and 14 |
| Reporting for non-engineers | `scripts/report.mjs`, `docs/readiness-report.md` |
| Raising the bar on engineer-owned tests | exercises 4–9, `docs/answer-key.md` |
| Test data, fixtures, environment seeding | `tests/helpers/`, `tests/fixtures/` (exercise 8) |
| Security and regulated data | `tests/security/`, defect probes 05/06/08 |
| Rules/decision engines | `product/server/lib/policy.mjs`, the Python oracle, exercise 5 |
| Performance and flakiness | `scripts/load.mjs`, `tests/flaky/`, exercise 12 |
| CI plumbing | `.github/workflows/quality.yml`, exercise 13 |

---

## What is intentionally broken

The probe names are visible on purpose; the root causes and fixes are in the answer key.

| ID | Area | Symptom |
| --- | --- | --- |
| DEFECT-01 | Income rules | Biweekly pay is annualized with 24 periods instead of 26 |
| DEFECT-02 | Income rules | Alaska/Hawaii poverty guidelines are not applied |
| DEFECT-03 | Validation | Zero-person household and size/member mismatch are accepted |
| DEFECT-04 | Tenancy | Tenant config is cached globally across agencies |
| DEFECT-05 | Authorization | Any applicant can read another applicant's screening by id |
| DEFECT-06 | Data protection | Raw SSNs appear in responses and timeline events |
| DEFECT-07 | Async | Retry after a timeout creates a duplicate vendor verification |
| DEFECT-08 | Webhooks | No timestamp freshness check, so signed requests can be replayed |
| DEFECT-09 | Workflow | Approval is possible without proof of income or vendor verification |
| DEFECT-10 | Deadlines | Deadline dates are computed in UTC, not the agency's timezone |
| DEFECT-11 | AI | Shipping prompt follows injection, guarantees eligibility, invents amounts |
| DEFECT-12 | Accessibility | Unlabeled input, low-contrast hint, unnamed chat button |
| DEFECT-13 | Differential | API results disagree with the independent Python oracle |
| FLAKY-01 | Test quality | A fixed `sleep(15)` test races the worker |

Known coverage gaps (not bugs) are listed in `quality/known-gaps.json` and included in the
generated report.

---

## Repo map

```text
product/
  server/
    app.mjs               HTTP routing, auth, workflow, worker
    server.mjs            local entry point
    lib/policy.mjs        FPL table, income annualization, eligibility rules
    lib/deadline.mjs      timezone-aware deadline math
    lib/store.mjs         tenants, demo users, in-memory persistence
    lib/vendor.mjs        flaky external vendor with idempotency
    lib/assistant.mjs     deterministic assistant, guardrails, prompt versions
    lib/readiness.mjs     combines risk register + artifacts into a verdict
    lib/pii.mjs           masking/redaction helpers
  web/                    accessible-by-default demo UI with seeded defects
tests/
  api/ security/ contract/ integration/ evals/
  e2e/                    Playwright journeys (3 browser projects)
  probes/                 failing checks that encode intended behavior
  probes/e2e/             axe accessibility probe
  fixtures/               household builders and deterministic generators
  helpers/                app lifecycle, API client, schema validation
  flaky/                  one deliberately bad test for triage practice
python-oracle/            independent rules implementation + unittest suite
quality/
  openapi.json            provider contract
  consumer-contract.json  consumer expectations
  risk-register.json      release risks
  known-gaps.json         what the suites do not cover
scripts/                  test runner, evals, load, report, site checks
site/                     static portfolio published to GitHub Pages
docs/                     strategy, system tour, answer key, study plan
artifacts/                generated reports and JUnit/Playwright output (gitignored)
```

---

## Demo access

| Bearer token / `X-Demo-User` | Role | Tenant |
| --- | --- | --- |
| `tok_applicant_a` / `applicant-a` | applicant | agency-a (Northstar, CA) |
| `tok_applicant_b` / `applicant-b` | applicant | agency-b (Riverbend, NY) |
| `tok_caseworker_a` / `caseworker-a` | caseworker | agency-a |
| `tok_caseworker_b` / `caseworker-b` | caseworker | agency-b |
| `tok_admin_a` / `admin-a` | admin | agency-a |

The `X-Demo-User` header is a development convenience and is disabled when
`NODE_ENV=production`. Vendor secrets in `lib/store.mjs` are fixed development fixtures.
`/internal/*` endpoints (`clock`, `vendor/config`, `vendor/state`, `reset`) are test controls,
enabled by default and disabled with `ENABLE_TEST_HOOKS=0`.

Do not deploy this app, point it at real data, or reuse its secrets. It stores everything
in memory and deliberately contains security defects for practice.

---

## Commands

| Command | What it runs |
| --- | --- |
| `npm run dev` | Server on port 4310 |
| `npm run typecheck` | TypeScript checks for tests and configs |
| `npm run test:baseline` | API, security, contract, integration, eval-harness suites |
| `npm run test:api` / `:security` / `:contract` / `:integration` / `:evals` | One suite |
| `npm run test:e2e` | Playwright, all configured browsers |
| `npm run test:probes` | Defect probes (red until fixed) |
| `npm run test:e2e:probes` | Accessibility probe (red until fixed) |
| `npm run evals` | Assistant evals for both prompt versions |
| `npm run test:python` | Python oracle unit tests |
| `npm run load` | Dependency-free load smoke with p95/error thresholds |
| `npm run test:flaky` | The deliberately flaky test |
| `npm run report` | `artifacts/quality-report.md` + `summary.json` |
| `npm run test:chatbot` | Hiring assistant golden dataset against `site/chat/engine.js`; `--write-coverage` regenerates `site/chat/coverage.json`, and a stale copy fails the run |
| `npm run check:chatbot-figures` | Fails when a figure in `site/chat/knowledge.json` or in the `site/chat.html` and `site/index.html` copy, or in the case-study prose, disagrees with the generated summary, the report, or the fixtures behind the case-study answers: `policy.mjs` pay periods, tenant deadlines, the case-study pages, the axe viewports (needs `npm run report` first; CI runs it `--strict` on every pull request and again before publishing) |
| `npm run check:site` | Accessibility (axe WCAG 2.1 A/AA) and HTML structure checks for `site/` |
| `npm run verify:baseline` | Typecheck + baseline + Chromium E2E + hardened evals |
| `npm run verify:release` | The full gate; green only when every defect is fixed |

CI (`.github/workflows/quality.yml`) runs the baseline, all three browsers in a matrix, the
Python oracle, evals, load, the site's own accessibility and HTML checks, and a
release-readiness job that records the open defects in its job summary instead of failing the
build. The `quality-report` job also runs the assistant's figure check strictly on every pull request, so stale numbers fail review instead of merging and only failing at publish. On `main` it also publishes the portfolio and these reports to GitHub Pages.

---

## Verified locally on this machine

- `npm run typecheck`, `npm run test:baseline` (44/44), `npm run test:e2e` (12/12 across
  Chromium, Firefox, WebKit), `npm run test:python` (7/7), `npm run evals -- --gate`
  (13/13 hardened), `npm run load` (p95 ≈ 53 ms, 0 errors).
- `npm run test:probes` fails 14/14 and `npm run test:e2e:probes` fails with three
  accessibility violations, as intended.
- `npm run report` produces **NOT READY**, citing five open high/critical risks, the
  shipping-prompt regressions, and 15 failing probes.

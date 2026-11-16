# System tour

Read this before you write or fix a test. The point is to know where correctness lives.

## Request path

```text
browser (product/web)
  │  X-Demo-User (dev) or Authorization: Bearer <token>
  ▼
product/server/app.mjs
  ├─ authenticate / role / tenant checks
  ├─ policy.mjs ──► eligibility results (tenant filters)
  ├─ store.mjs ───► screenings, applications, timeline events, documents
  ├─ deadline.mjs ► deadlineDate in the agency's timezone
  ├─ vendor.mjs ──► outbound verification with retries + idempotency key
  ├─ assistant.mjs ► deterministic reply + citations + guardrails
  └─ readiness.mjs ► risk register + artifacts → ready / not_ready / not_verified
```

## Core objects

**Screening** — a household snapshot and per-program result. Statuses are
`likely_eligible`, `likely_ineligible`, or `need_more_info`. It is owned by an applicant and
a tenant.

**Application** — created from a screening. Statuses:
`submitted → documents_pending → under_review → approved | denied`.
An application stores its own household hash so later changes to the screening cannot
silently alter what the vendor verified.

**Timeline event** — append-only audit record (`application.submitted`, `vendor.verified`,
`document.received`, `application.under_review`, `application.approved`, …). This is the
observable seam for async assertions.

**Tenant** — agency-a and agency-b differ in branding, enabled programs, document window,
timezone, assistant prompt and vendor secret. The UI changes with the signed-in user; the
API must not.

**Vendor verification** — the worker calls the simulator up to three times. Success moves
`application.vendor.status` to `verified`; exhaustion moves it to `failed`. The vendor keys
records by idempotency key, which is why retry identity matters.

**Assistant** — deterministic offline model with two prompt versions. `2026-02-a` is the
shipping default for agency-a and is vulnerable. `2026-03-b` is the hardened reference used
by the eval gate. Guardrails are evaluated on every response but only enforced on the
hardened version.

## Boundaries worth testing

| Boundary | Failure to look for |
| --- | --- |
| Browser → API | Missing labels, tenant branding, optimistic UI states |
| API → rules | Boundary percentages, frequency annualization, state guidelines, missing income |
| API → store | Ownership, tenant isolation, immutability of snapshots |
| Worker → vendor | Retry storms, duplicate records, lost updates, timeout classification |
| Vendor → webhook | Signature, timestamp freshness, household-hash mismatch |
| Caseworker → decision | Required documents, verification state, legal transitions |
| Assistant → user | Hallucinated amounts, guarantees, prompt injection, citations, PII echo |
| Suite → report | Are gaps and failures visible to non-engineers without jargon? |

## Demo data

The UI builds a two-adult household plus children. The API accepts explicit members, which
is where you should test ages, pregnancy, immigration status, income frequencies, and state
guidelines. Use `tests/fixtures/households.ts` builders rather than copying payloads.

## Time and determinism

The server supports a test clock:

```bash
curl -X POST http://127.0.0.1:4310/internal/clock \
  -H 'content-type: application/json' \
  -d '{"iso":"2026-11-16T02:00:00.000Z"}'
```

Vendor failures can be scripted:

```bash
curl -X POST http://127.0.0.1:4310/internal/vendor/config \
  -H 'content-type: application/json' \
  -d '{"failAfterRecord":1}'      # simulate a timeout after the vendor did the work
curl http://127.0.0.1:4310/internal/vendor/state
```

Prefer event/timeline polling over fixed sleeps. `tests/helpers/app.ts` has
`waitForApplication` for that.

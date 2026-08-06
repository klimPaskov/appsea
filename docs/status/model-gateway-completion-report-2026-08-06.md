# Model gateway boundary tranche — 2026-08-06

Status: repository tranche complete; AppSea is still not production-ready.

## Outcome

AppSea now has a provider-neutral model gateway boundary for future complaint
analysis. The worker calls the boundary inside the production-analysis
activity, after reading policy-validated rows, and carries only a bounded
`model-gateway-v1` summary into the production artifact. Deterministic and
human-corrected complaint analysis remains authoritative; gateway suggestions
cannot change clustering, scoring, reports, or plans.

The boundary fixes the system-owned instruction context, carries workspace
identity for tenant-scoped egress/audit binding, requires an explicit
`untrusted-data` segment, allowlists route/prompt/model versions, normalizes and
redacts secret/PII-like input, refuses instruction-like content, enforces input
and output budgets, uses a bounded process-local idempotency cache, validates
structured output, and records only hashes, findings, counters, and cost. The external provider path
is disabled and fails closed, even when a collection policy is approved.

## Implementation

- `packages/contracts/src/index.ts` adds request/result/snapshot schemas for
  trust-tagged segments, budgets, provenance, safety findings, and
  non-authoritative suggestions. Production inputs/artifacts reject forged
  approved/fixture-only model metadata and require one request per retained
  complaint when a snapshot is present.
- `packages/model-gateway/` adds the allowlisted deterministic fallback,
  external-disabled provider, redaction and safety preflight, bounded local
  replay cache, homogeneous-batch checks, structured-result validation, and
  bounded summary. Model-use approval is deliberately absent from caller
  request metadata; production policy state is supplied by the worker's
  gateway context.
- `apps/worker/src/production-analysis-input.ts` runs the gateway in the
  activity process without placing complaint text in Temporal input/history or
  worker events. `packages/research/src/index.ts` makes fallback/refusal gaps
  visible in production artifacts.

## Validation

- `pnpm --filter @appsea/contracts test` — 117 passed.
- `pnpm --filter @appsea/model-gateway test` — 9 passed.
- `pnpm --filter @appsea/model-gateway typecheck` — passed.
- `pnpm --filter @appsea/research test` — 22 passed.
- `pnpm --filter @appsea/worker typecheck` — passed.
- `pnpm verify` — 60 Turbo tasks passed; fixture, plan, analysis, quality,
  local web smoke, release static checks, and repository checks passed.
- `pnpm security:audit` — no known production vulnerabilities.
- `pnpm verify:local-stack` and `pnpm verify:worker:recovery` passed.
- `pnpm verify:persistence` — 60 PostgreSQL integration tests passed. A fresh
  disposable-volume run first hit a timing-sensitive alert retry assertion;
  the immediate rerun passed without code changes.

## Remaining gaps and simplifications

No real model provider or credential was enabled. The source-policy contract
does not yet declare reviewed model-use/training permissions, so production
metadata is explicitly `external-not-approved`. File content-type/malware
scanning, provider DPA/retention/egress controls, durable model cost ledger
settlement, semantic model evaluation/calibration, and model-backed analysis
remain external or future reviewed work. No public source was activated and no
fixture or owner-import output is presented as public market research.

# Deep-research gate tranche report — 2026-08-05

## Outcome

Implemented a fail-closed deep-research readiness boundary for private
production opportunities. The app now stores a compact, append-only gate
review, derives current source/evidence/competitor provenance from PostgreSQL,
exposes owner/editor transitions through an authenticated same-origin API, and
shows gate status and blockers on the private competitors route. The public
leaderboard is unchanged.

This tranche does not activate CFPB, Stack Exchange, or any other external
source. No synthetic fixture content is presented as market research.

## Changed surfaces

- `packages/contracts`: versioned gate/checklist/status schemas, transition
  input, private detail read field, and lifecycle promotion rule.
- `packages/research`: pure deterministic gate evaluator with explicit blockers
  for missing confirmed contrary evidence, substitute coverage, review state,
  test-only transport, and incomplete checklist provenance.
- `packages/db`: migration `0101_deep_research_gate.sql`, forced-RLS table,
  append-only audit/outbox trigger, content-addressed artifact loading,
  snapshot-staleness read validation, and authenticated repository.
- `apps/web`: private GET/PATCH gate API, production read wiring, MCP/detail
  read exposure, and a competitors-page gate diagnostic with owner withdrawal.
- Tests: contract, research evaluator, route, migration, and existing package
  regression suites.

## Validation

- `pnpm --filter @appsea/contracts test` — passed (105 tests).
- `pnpm --filter @appsea/research test` — passed (19 tests).
- `pnpm --filter @appsea/db test` — passed (158 tests).
- `pnpm --filter @appsea/web test` — passed (193 tests).
- Contract, research, db, and web typechecks — passed.
- `pnpm build` — passed across all 14 packages, including the new gate API route.
- `pnpm worker:fixture`, `pnpm plan:sample`, `pnpm analysis:sample`, and
  `pnpm research:quality` — passed with synthetic/test-only disclosures.
- `pnpm smoke:web`, `pnpm security:audit`, `pnpm memory:check`,
  `pnpm repo:check --docs-only`, and `pnpm test:backup-restore` — passed.
- `pnpm verify:persistence:fresh` — attempted and blocked before migrations by
  the unavailable Docker Desktop Linux engine pipe.

Docker-backed fresh/upgrade PostgreSQL integration and backup/restore proof
remain blocked in this environment because Docker Desktop's Linux engine pipe
is unavailable. Hosted source-policy approval, provider provisioning, and
deployment operations remain open.

## Simplifications and remaining gaps

- The gate stores reviewed checklist attestations and compact provenance; it
  does not yet run a broader competitor/contrary search workflow or estimate
  unique authors automatically.
- Report and coding-plan packages remain candidate outputs until the gate is
  passed and their existing approval states are independently satisfied.
- The current production artifact still carries a visible competitor/contrary
  coverage gap. A valid gate may acknowledge that gap but never hides it.

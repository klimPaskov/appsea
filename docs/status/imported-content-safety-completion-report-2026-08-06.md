# Imported-content safety tranche — 2026-08-06

Status: repository tranche complete; AppSea is still not production-ready.

## Outcome

The fixture and tenant-private `manual-owner-import-v2` paths now apply a
bounded deterministic safety projection during complaint analysis. Text that
resembles an instruction to override prompts, extract secrets, target
repository controls, or invoke tools is retained as evidence with its
provenance, but receives `manipulationRisk` and `policyFlags` and is classified
as requiring human review. Private collection and opportunity evidence pages
show the review marker. Production artifacts add a visible coverage gap for
flagged observations.

The boundary is deliberately additive. Existing `ComplaintAnalysis` JSONB
fields already store `manipulationRisk` and `policyFlags`, so no PostgreSQL
migration was required and legacy snapshots remain readable. Imported text is
never executed, copied into code/skills/instructions/permissions/repository
memory, or used as a model prompt. This is not a malware scanner, semantic
prompt-injection proof, live model gateway, or source approval.

## Implementation

- `packages/research/src/index.ts` — bumped the analysis version to
  `complaint-analysis-v0.2.0`, added deterministic safety assessment signals,
  review-gated analysis defaults, and production coverage-gap reporting.
- `packages/connectors/src/manual-import.ts` — added the explicit untrusted
  content warning to owner-import metadata.
- `apps/web/src/app/workspace/[workspaceId]/research/[runId]/page.tsx` and
  `apps/web/src/app/workspace/[workspaceId]/opportunities/[slug]/evidence/page.tsx`
  — render the private review marker without changing the sparse leaderboard.
- Adversarial research and connector tests prove text retention, deterministic
  signals, review metadata, and coverage-gap behavior.

## Validation

- `pnpm --filter @appsea/research test` — 22 passed.
- `pnpm --filter @appsea/connectors test` — 38 passed.
- `pnpm --filter @appsea/contracts test` — 112 passed.
- `pnpm --filter @appsea/web test` — 220 passed.
- `pnpm --filter @appsea/db test` — 182 passed.
- `pnpm --filter @appsea/workflows test -- --runInBand` — 31 passed.
- `pnpm --filter @appsea/worker test` — 143 passed.
- Changed-package typechecks pass for database, research, connectors, and web.
- `pnpm security:audit` — no known production vulnerabilities.
- `pnpm verify` — 56 Turbo tasks passed, including build, fixture/plan/analysis
  generation, research-quality, web smoke, release-static checks, and repository
  validation.
- `pnpm verify:local-stack` — real loopback PostgreSQL/Temporal/MinIO readiness,
  owner intake, durable collection, production-shaped analysis, private
  report/plan readback, and cleanup passed.
- `pnpm ui:capture` and `pnpm ui:capture:private` — public and authenticated
  desktop/responsive captures passed the runtime, title/main, and overflow
  audits; the private run produced 36 captures under
  `artifacts/ui-reference-loop/2026-08-06/`.

## Remaining gaps and simplifications

No third-party source was enabled and no public market coverage is claimed.
The detector is intentionally bounded and deterministic; human review,
provider policy approval, model-gateway isolation, file-malware controls,
hosted PostgreSQL/Temporal/object-storage operations, alert ownership, and
signed desktop release evidence remain open production gates.

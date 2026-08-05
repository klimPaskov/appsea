# Production research maturity gate completion report

- Date: 2026-08-05
- Status: implemented and locally validated
- Scope: prevent production seed/complaint analysis from claiming `researched`

## Outcome

Production analysis now persists and reads as `candidate` until an explicit
deep-research gate is recorded. The shared read resolver fails closed when a
legacy non-synthetic row says `researched` but the gate, source-backed
competitive evidence, or coverage proof is absent. Synthetic fixture rows are
unchanged and remain labelled as fixture data.

## Changed surfaces

- `packages/contracts`: extracted the lifecycle-state schema and added the
  fail-closed read resolver with positive/negative tests.
- `packages/db`: production analysis writes `candidate`; legacy rows are
  repaired by migration `0100_research_maturity_gate.sql`; authenticated reads
  apply the resolver.
- `apps/web`: private production opportunity mapping applies the resolver and
  MCP fixtures no longer claim a non-synthetic opportunity is researched.
- Documentation and memory record that competitor/contrary research remains
  seed-only until the future reviewed deep-research package exists.

## Validation

- `pnpm --filter @appsea/contracts test` passed (104 tests).
- `pnpm --filter @appsea/contracts typecheck` passed.
- `pnpm --filter @appsea/db test` passed (158 tests).
- `pnpm --filter @appsea/db typecheck` passed.
- `pnpm --filter @appsea/web typecheck` passed.
- `pnpm verify` passed (all 56 Turbo tasks, fixture/plan/analysis samples,
  research-quality gate, web smoke, release static checks, and repo checks).
- `pnpm security:audit` passed with no known production vulnerabilities.
- Docker-backed fresh/upgrade persistence proof still requires Docker Desktop;
  the repository already records the unavailable local Linux engine as an
  environment blocker.

## Simplifications and remaining gaps

This tranche does not implement the deep-research package or activate a public
connector. The resolver intentionally requires an explicit future gate signal;
it does not infer one from complaint volume, reviewed seeds, fixture data,
models, or source availability. Independent legal/privacy/security approval,
provider deployment, and operational recovery proof remain open.

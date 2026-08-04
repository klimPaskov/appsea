# Balanced opportunity scoring v1 tranche

Date: 2026-08-04

## Delivered

- Added a versioned, additive `opportunity-score-v1.0.0` contract with five
  positive dimensions, six bounded risk penalties, confidence components,
  uncertainty margin, ranking score, evidence snapshot, coverage/freshness,
  reviewed inputs, and component explanations.
- Preserved legacy v0.2 fixtures and historical score semantics. The legacy
  `score` field remains the raw-score compatibility value.
- Added `calculateOpportunityScoreV1` and deterministic replay/tamper checks.
  Production research selects v1 only when a reviewed seed provides the
  balanced input envelope; otherwise it retains v0.2 and records a gap.
- Reports now use v1 confidence/ranking semantics and explain raw versus
  risk-adjusted versus ranking values.
- Migration `0096_opportunity_score_v1_envelope.sql` adds nullable, checked
  queryable fields and a private ranking index. Production persistence stores
  the full v1 envelope in the immutable explanation JSON as well.
- Private opportunity summaries hydrate v1 metrics and order by ranking when
  present. The public leaderboard remains its sparse synthetic fixture route.
- The loopback private-stack smoke now submits a reviewed v1 seed and asserts
  the v1 snapshot survives owner import, durable analysis, PostgreSQL-backed
  readback, and private pages.
- Follow-up provenance hardening is recorded in
  [`score-factor-provenance-completion-report-2026-08-04.md`](score-factor-provenance-completion-report-2026-08-04.md):
  each v1 factor now carries a source-evidence or reviewed-seed binding, with
  retained-evidence validation at production analysis boundaries.

## Proof

- `pnpm --filter @appsea/scoring lint typecheck test`
- `pnpm --filter @appsea/research lint typecheck test`
- `pnpm --filter @appsea/reports lint typecheck test`
- `pnpm --filter @appsea/db lint test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm verify`
- `pnpm repo:check --docs-only`
- `pnpm verify:local-stack`

All completed successfully locally, including the fresh PostgreSQL backup/
restore drill through migration `0096`. Hosted persistence and provider backup/
HA evidence remain deployment-dependent.

## Explicit limits

This tranche does not activate CFPB, Stack Exchange, or any public source; it
does not provide calibration benchmarks, additional score profiles, provider
backup/HA evidence, destructive purge, or ChatGPT Sites/OAuth hosting. Reviewed
seed values are inputs for deterministic replay, not market research.

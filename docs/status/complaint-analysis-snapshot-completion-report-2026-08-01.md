# Complaint-analysis snapshot completion report — 2026-08-01

## Outcome

The fixture and production-shaped research artifacts now carry one validated,
deterministic complaint-analysis snapshot per retained complaint. PostgreSQL
migration `0053_complaint_analysis_snapshots.sql` persists the snapshot beside
the complaint observation and upgrades historical run snapshots from existing
derived columns without changing source evidence.

Private collection/evidence pages and generated reports expose classification
type, severity, confidence, and unresolved entity dimensions. Products,
companies, and features are resolved only from retained source fields. The
snapshot deliberately leaves substitutes and competitors unresolved until a
separate reviewed research stage supplies permitted evidence.

## Changed surfaces

- `packages/contracts`: strict complaint-analysis/entity-resolution contracts,
  artifact coverage invariants, evidence/report read-model fields.
- `packages/research`: deterministic rule-based classification and entity
  resolution with versioned derivation metadata.
- `packages/db`: migration `0053`, fixture/collection persistence, historical
  snapshot upgrade, review-state propagation, and private read mapping.
- `packages/reports`: analysis summaries in evidence-backed reports and plan
  packages.
- `apps/web`: private evidence and collection views show analysis confidence,
  severity, and unresolved dimensions.
- `schemas/`: portable JSON Schema for the derived analysis snapshot.

## Validation

- `pnpm --filter @appsea/contracts test` — 66 passed.
- `pnpm --filter @appsea/research test` — 7 passed.
- `pnpm --filter @appsea/reports test` — 8 passed.
- `pnpm --filter @appsea/db test` — 88 passed.
- `pnpm --filter @appsea/workflows test` — 27 passed.
- affected package typechecks and lint passed.
- `pnpm format:check` passed.
- `pnpm verify` passed, including fixture worker, report/plan samples, web
  smoke, and repository validation.
- `pnpm verify:persistence` was attempted and is blocked before migration
  execution because the Docker Desktop Linux engine pipe is unavailable.
- Docker-backed PostgreSQL integration remains unavailable because the Docker
  Desktop Linux engine pipe is not running; migration execution and RLS proof
  still require that environment.

## Simplifications and remaining gaps

- The classifier is deterministic rules, not a model gateway or a claim of
  market-quality classification.
- Entity resolution uses source-field labels only; aliases, domains, unique
  authors, translation, and contextual disambiguation remain open.
- Competitor and substitute arrays remain empty with explicit unresolved types;
  no synthetic market research was introduced.
- Review transitions update analysis review state, but field-level editor
  correction and downstream re-analysis remain separate work.

# Opportunity seed review tranche

Date: 2026-07-26

## Outcome

Production analysis no longer accepts a caller-supplied opportunity-seed
envelope at its authenticated start boundary. A workspace editor or owner
creates an immutable, validated seed review; an editor can mark it reviewed and
an owner can approve it. Analysis start resolves the approved record and the
production persistence repository checks the same stored version and content
hash before creating projections.

## Changed surfaces

- `packages/contracts`: strict seed-review create, approval, state, and read
  contracts; `seedReviewId` replaces inline seed content in analysis start.
- `packages/db/migrations/0033_opportunity_seed_reviews.sql`: workspace RLS,
  immutable-content trigger, ordered approval transitions, and identifier/hash
  audit/outbox receipts.
- `packages/db/src/opportunity-seed-review-repository.ts`: authenticated create,
  list/read, approved-read, and approval-transition repository methods.
- `packages/db/src/production-analysis-repository.ts`: approved seed
  hash/version lineage check in the same transaction as collection and policy
  lineage checks.
- `packages/db/src/migrations.ts`: migration-directory resolution no longer
  asks the Next bundler to import a SQL directory dynamically.
- `apps/web`: private seed-review list/read/create/transition APIs, the
  `/workspace/:workspaceId/seed-reviews` page, and analysis-start resolution of
  approved seed IDs.

## Surface audit

| Surface                   | Status and proof                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and persistence | Complete for this tranche: strict seed inputs, migrations `0033` and `0034`, forced RLS, least-privilege grants, immutable content and decision metadata, repository lineage checks, and a durable approved-seed analysis handoff queue. |
| Analysis boundary         | Complete for this tranche: callers submit only `seedReviewId`; the server and persistence transaction resolve the approved version/hash.                                                                                                 |
| Private website           | Complete for this tranche: authenticated list/read/create/transition APIs and a focused seed-review workspace page; the public leaderboard remains unchanged.                                                                            |
| Security and privacy      | Complete for this tranche: same-origin mutations, membership/RLS authorization, bounded request bodies, hostile-text validation, and identifier/hash-only receipts.                                                                      |
| Runtime and deployment    | Open: Docker-backed PostgreSQL/Temporal proof, live source approval, cloud object purge, scheduling, and deployment security are not available here.                                                                                     |

## Exact next actions

1. Start PostgreSQL 18 and Temporal integration services, then run the full
   repository and migration/activity suites.
2. Complete legal/privacy/security approval before activating the CFPB policy.
3. Replace the narrow JSON editor with field-level revisions and comparison,
   then add aggregate recomputation and deployed handoff scheduling/alerting.
4. Provision production database, Temporal, object storage, monitoring, cost
   limits, backup/object purge, and identity-provider operations.

## Scope simplifications

This tranche intentionally stores immutable seed revisions as validated JSON
and exposes a narrow approval page. It does not infer seed fields from
complaints, allow inline caller seed payloads, activate a connector, or claim
production deployment readiness.

## Validation

- Direct TypeScript checks passed for `packages/contracts`, `packages/db`, and
  `apps/web`.
- Direct ESLint and Prettier checks passed for the changed TypeScript/CSS
  surfaces.
- Vitest passed the focused 11-file suite (97 tests), and the broader changed
  package/web suite passed 25 files (133 tests), including strict inputs,
  authentication/origin checks, bounded request bodies, approval actions, and
  approved-seed analysis composition.
- The reference renderer generated deterministic desktop/mobile SVG sources for
  the seed-review route. Raster export remains an environment-dependent step.
- The PostgreSQL integration test now covers immutable content, review and
  owner approval transitions, approved reads, and negative direct updates.
  It was not executable in this environment because Docker Desktop's Linux
  engine pipe is unavailable.
- A direct Next production-build probe reaches the remaining incomplete local
  dependency tree: `protobufjs` is present in the pnpm store metadata but its
  package directory is missing. The alternate webpack probe is blocked by
  sandbox process permissions; this is not a source-level validation pass.

## Remaining gaps

The JSON-backed seed editor is intentionally a narrow first UI; richer field
editing and revision comparison remain open. Production database/Temporal
provisioning, live connector approval, cloud object storage/purge, aggregate
recomputation, deployed handoff scheduling/alerting, identity-provider review,
and deployment security are still blockers for the overall AppSea production
goal.
The actual browser capture/compare loop for this private page is also pending;
this environment generated only the deterministic SVG source because
`cairosvg` and a running production-like web server are absent.

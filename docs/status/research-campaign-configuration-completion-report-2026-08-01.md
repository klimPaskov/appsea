# Research campaign configuration completion report — 2026-08-01

## Outcome

AppSea now has an authenticated private campaign configuration slice. A
workspace owner or editor can persist a validated research campaign draft,
inspect source-policy readiness, and list/read campaigns without activating a
source or presenting fixture values as market research.

## Implementation

- `packages/contracts/src/index.ts` defines the strict `campaign-v1`
  configuration, bounded USD budget, source readiness, and campaign read
  models. A legacy union keeps existing fixture and workflow rows readable.
- `packages/db/src/research-campaign-repository.ts` provides authenticated,
  workspace-scoped create/list/read operations over the existing
  `research_campaigns` JSONB columns. It validates source IDs, prevents
  fixture/non-fixture mixing, checks approved-purpose compatibility, and
  writes identifier-only audit/outbox receipts. Source readiness derives from
  registry lifecycle, reviewed policy state, and expiry; the immutable draft
  payload's `enabled` flag is not treated as activation.
- `apps/web/src/app/api/workspaces/[workspaceId]/campaigns/` exposes private
  list/create/read routes. The private campaigns page and form show policy
  state, coverage notes, synthetic status, and the immutable configuration
  snapshot.
- No SQL migration was required: the existing table already stores the
  additive JSONB configuration/budget shape. The new contract is enforced at
  the application boundary while legacy rows remain readable.

## Validation

- Contracts: tests, typecheck, and lint pass.
- Database: all package tests, typecheck, and lint pass, including repository
  tests for private drafts, unknown sources, audit/outbox receipts, and legacy
  reads.
- Web: all package tests, typecheck, and lint pass, including private route
  authorization and strict-body tests.
- Full repository verification remains the required final gate for this
  tranche. Docker-backed PostgreSQL proof is environment-dependent.

## Deliberate limits and remaining gaps

- Campaigns are draft-only in this slice. There is no campaign edit/delete,
  run/queue endpoint, pagination, or scheduled refresh execution.
- The known CFPB connector remains disabled/pending external legal, privacy,
  and security approval. A pending policy may be configured so its gap is
  visible, but no source request can start from this UI.
- Source policy is rechecked by the later workflow; campaign creation is not a
  substitute for workflow admission, quotas, deletion handling, or provenance
  persistence.
- The campaigns form uses the known registry identifier as a starter value;
  a dedicated source-registry picker and operator approval UI remain future
  work.

# ADR 0006: Use PostgreSQL repositories with versioned SQL migrations

- Status: accepted
- Date: 2026-07-11
- Owner: main coding agent

## Decision

PostgreSQL is AppSea's product system of record. The first production persistence
boundary uses:

- PostgreSQL 18 as the supported local and deployment baseline
- the small `pg` client behind `packages/db` repository interfaces
- ordered, forward-only SQL migrations with stored SHA-256 checksums
- explicit transactions and parameterized queries
- `snake_case` database names and `camelCase` TypeScript service contracts
- stable text identifiers that preserve existing fixture and source-native IDs
- a required `workspace_id` on every workspace-owned record
- PostgreSQL row-level security as defense in depth, with repository transactions
  setting the workspace context
- immutable source-policy, evidence, score, report, and plan versions; corrections
  create new versions or policy-required tombstones
- normalized relational columns for ownership, provenance, lifecycle, uniqueness,
  and querying, with JSONB limited to validated structured payloads and metadata
- a transactional outbox for events that must reach workflows or indexes

The existing fixture contracts remain intact. A validated fixture persistence
adapter maps them into the production schema so the regression baseline is not
silently weakened. Production source envelopes and richer API contracts will be
introduced as additive versioned contracts before a live connector is enabled.

Temporal will own durable workflow execution history in the workflow tranche.
PostgreSQL stores product records, workflow read state, idempotency receipts,
checkpoints, audit events, cost ledgers, and outbox events; it will not become a
second ad-hoc job queue.

## Reason

AppSea requires transactional provenance, replay protection, tenant isolation,
deletion propagation, deterministic score snapshots, and auditable report/plan
lineage. A thin client and explicit SQL keep those rules visible while avoiding
an ORM-specific model beside the existing Zod and JSON Schema contracts.

Forward-only checksummed migrations make deployed history inspectable. Real
PostgreSQL integration tests are required because SQLite or mocks cannot prove
row-level security, constraints, JSONB behavior, or transactional semantics.

## Consequence

- Schema changes require an additive migration and migration-impact note.
- Repository calls for workspace-owned data must run in a transaction with an
  explicit workspace context.
- Identical idempotent replay is a no-op; reuse of an immutable identifier with
  different content is a visible conflict.
- Large raw evidence and exported package blobs move to versioned object storage;
  PostgreSQL keeps references and hashes. The small synthetic fixture package may
  be stored inline only as a test artifact and must remain labeled synthetic.
- Public leaderboard data will eventually use a separate published projection;
  private workspace evidence is never inferred to be public.
- Down migrations are not executed automatically in production. Recovery uses a
  reviewed forward repair or restore procedure.

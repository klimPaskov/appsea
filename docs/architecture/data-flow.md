# Data flow

1. An authorized client submits a bounded, hashed workflow request; the web
   boundary binds the authenticated user as the requesting principal, then
   migration `0038` verifies the active private non-fixture workspace and
   atomically admits or rejects the start using a workspace-scoped rate bucket
   and active-job/reservation count. A replayed digest is returned without a
   second reservation.
2. Temporal records the durable execution and schedules validated activities.
3. An approved connector emits bounded observations with source metadata; raw
   provider payloads stop at the connector boundary.
4. The source registry gate checks the active policy version, purpose, quota,
   display mode, and deletion obligations.
5. Contracts validate shape and required provenance.
6. A production collection checkpoint persists non-synthetic source items,
   redacted evidence, unreviewed complaint observations, coverage gaps, and
   deletion tombstone events idempotently before downstream research begins.
7. Workspace editors and owners review active complaint observations through
   the private collection surface. Migration `0032` permits only
   `unreviewed` -> `confirmed`/`rejected` and `confirmed` -> `rejected`
   transitions; review receipts contain identifiers only.
8. The production-shaped analysis checkpoint normalizes and deduplicates the
   validated payload while preserving source-native identifiers, evidence and
   source-item identity, the approved policy review hash, and display policy.
9. Clustering groups observations by product and problem category; each
   membership points back to a retained complaint ID.
10. Workspace seed reviews persist product, competitor, contrary-evidence, and
    score assumptions as immutable content-hashed records. Editors review them
    and owners approve them before analysis may reference the seed ID.
11. Reviewed competitor and contrary-evidence seed values are attached without
    inferring missing market coverage from complaint text.
12. Scoring calculates a versioned score only from explicit reviewed factors.
13. A distinct post-collection analysis run rechecks the completed collection,
    approved policy review/hash, and every active complaint/evidence/source-item
    mapping before clustering, reviewed competitor/contrary-signal attachment,
    and deterministic scoring.
14. When collection input names an approved seed, migration `0034` enqueues a
    deterministic post-collection handoff in the same completion transaction.
    A skip-locked worker reconstructs the input after complaint review and
    starts the idempotent analysis workflow; no source acquisition occurs in
    this handoff.
15. The analysis repository stores a redacted `workflow-artifact`, validated
    report JSON, and coding-agent plan through the content-addressed
    `packages/object-store` seam; PostgreSQL stores compact snapshots, hashes,
    references, and policy/evidence/output lineage.
16. A workspace transaction persists immutable production projections,
    output IDs, audit/outbox receipts, and active availability state. Source
    deletion propagation invalidates the analysis run while retaining lineage
    for authorized object purge; migration `0037` queues a deletion-triggered
    active-evidence repair with its source tombstone and reviewed seed lineage.
    The worker dispatches that job only after the seed is approved, while
    migration `0036` permits reactivation only after the new active output is
    linked.
17. Checkpoints, budget counters, and fixed failure records make progress inspectable and retry-safe.
18. An outbox event records accepted run completion without making delivery part of the database transaction.
19. The durable report package path converts a validated persisted artifact into
    a strict evidence-backed report and schema-checked coding-agent files;
    PostgreSQL versions the report, links it to the plan, and records the
    content-addressed object references.
20. Private workspace reviewers move report and plan versions through separate guarded review lifecycles; only approved, schema-validated object-backed read models can cross their export boundaries, and plan approval requires a ready package plus an approved linked report.
21. The website reads the accepted opportunity projection, evidence/source
    coverage, report, and plan through shared contracts; production analyses
    have an authenticated run read route and active-output mapping for private
    opportunity pages. The public leaderboard remains fixture-only.

Every workspace table uses forced row-level security. Authentication must authorize a workspace before application code sets the transaction-local workspace context. Source policy state remains global and cannot be changed directly by the runtime role.

Temporal owns retries, recovery, cancellation, and workflow history. Activities own side effects. PostgreSQL owns state, invariants, checkpoints, output lineage, and one-time ledgers; it is not used as an improvised job queue. Workflow inputs and failures are deliberately sanitized so imported evidence and caller secrets cannot become durable instructions or logs.

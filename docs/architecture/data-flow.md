# Data flow

Campaign configuration is a separate private step before this execution
sequence. An authenticated owner/editor writes a strict `campaign-v1` draft
through the workspace repository after resolving source IDs and displaying
policy readiness. The write records only identifiers in audit/outbox metadata;
it does not start Temporal or activate a connector. Existing fixture/workflow
campaign JSON remains readable, while new workflow admission rechecks the
current policy, purpose, quota, deletion obligations, and budget.

Starting from the private campaign page, the authenticated campaign-run route
reconstructs the production request from the persisted campaign and resolved
source read model. It accepts no caller-supplied source, query, purpose,
display mode, limit, or budget. The current slice requires one non-synthetic
source, checks policy readiness/purpose/display mode and optional approved seed
review, then commits the existing digest-only admission before contacting
Temporal. A multi-source campaign remains a visible validation gap rather than
an implicit fan-out.

The private campaign page and run-history API read the existing production
workflow projection through an authenticated workspace transaction. History is
bounded to the latest 100 rows and maps only operational state, checkpoint,
source/policy identifiers, counters, and timestamps. The status page links a
completed run to the existing collection evidence read; hashes, actor details,
and source payloads remain outside the read model.

1. An authorized client submits a bounded, hashed workflow request; the web
   boundary binds the authenticated user as the requesting principal, then
   migration `0038` verifies the active private non-fixture workspace and
   atomically admits or rejects the start using a workspace-scoped rate bucket
   and active-job/reservation count. A replayed digest is returned without a
   second reservation.
2. Temporal records the durable execution and schedules validated activities.
3. The worker acquires a digest-only collection lease bound to an approved
   source-policy review. The lease records one server-observed collection time
   that retries replay; it contains no source text or personal data.
4. An approved connector emits bounded observations with source metadata; raw
   provider payloads stop at the connector boundary.
5. The source registry gate checks the active policy version, purpose, quota,
   display mode, and deletion obligations.
6. Contracts validate shape and required provenance.
7. The worker rechecks lease expiry and policy approval immediately before
   persistence; an inactive lease becomes terminal and requires reconciliation.
8. A production collection checkpoint persists non-synthetic source items,
   redacted evidence, unreviewed complaint observations, deterministic
   classification/entity-resolution snapshots, coverage gaps, and
   deletion tombstone events idempotently before downstream research begins.
   After a completed deletion, an authenticated editor or owner may explicitly
   branch into a one-record tombstone-bound collection. The exact source-native
   identifier travels through the workflow and persistence transaction; the
   deleted row remains historical, and maintenance or quota recovery cannot
   invoke this branch automatically.
9. Workspace editors and owners review active complaint observations through
   the private collection surface. Migration `0032` permits only
   `unreviewed` -> `confirmed`/`rejected` and `confirmed` -> `rejected`
   transitions; review receipts contain identifiers only.
10. The production-shaped analysis checkpoint normalizes and deduplicates the
    validated payload, computes one versioned complaint-analysis snapshot per
    retained complaint, and preserves source-native identifiers, evidence and
    source-item identity, the approved policy review hash, and display policy.
11. Clustering groups observations by product and problem category; each
    membership points back to a retained complaint ID. Classification and
    entity confidence remain visible beside the cluster and unresolved
    competitor/substitute types are not treated as negative evidence.
12. Workspace seed reviews persist product, competitor, contrary-evidence, and
    score assumptions as immutable content-hashed records. Editors review them
    and owners approve them before analysis may reference the seed ID.
13. Reviewed competitor and contrary-evidence seed values are attached without
    inferring missing market coverage from complaint text. The private
    opportunity read model records whether competitive research is unresolved,
    reviewed-seed-only, or source-backed; source-backed status requires
    permitted source IDs, retained evidence IDs, and an observation time.
14. Scoring calculates a versioned score only from explicit reviewed factors.
15. A distinct post-collection analysis run rechecks the completed collection,
    approved policy review/hash, and every active complaint/evidence/source-item
    mapping before clustering, reviewed competitor/contrary-signal attachment,
    and deterministic scoring.
16. When collection input names an approved seed, migration `0034` enqueues a
    deterministic post-collection handoff in the same completion transaction.
    A skip-locked worker reconstructs the input after complaint review and
    starts the idempotent analysis workflow; no source acquisition occurs in
    this handoff.
17. The analysis repository stores a redacted `workflow-artifact`, validated
    report JSON, and coding-agent plan through the content-addressed
    `packages/object-store` seam; PostgreSQL stores compact snapshots, hashes,
    references, and policy/evidence/output lineage.
18. A workspace transaction persists immutable production projections,
    output IDs, audit/outbox receipts, and active availability state. Source
    deletion propagation invalidates the analysis run while retaining lineage
    for authorized object purge; migration `0037` queues a deletion-triggered
    active-evidence repair with its source tombstone and reviewed seed lineage.
    The worker dispatches that job only after the seed is approved, while
    migration `0036` permits reactivation only after the new active output is
    linked.
19. Checkpoints, budget counters, and fixed failure records make progress inspectable and retry-safe. If a source quota reservation settles before a production result, migration `0049` creates a bounded reconciliation case instead of permitting a blind retry.
20. Workspace members can inspect open quota-reconciliation cases privately; only the standalone maintenance role can resolve one after verifying the exact completed run or recording an explicit no-result decision. Resolution never refunds quota or starts a new source request.
21. An outbox event records accepted run completion without making delivery part of the database transaction.
22. The durable report package path converts a validated persisted artifact into
    a strict evidence-backed report and schema-checked coding-agent files;
    PostgreSQL versions the report, links it to the plan, and records the
    content-addressed object references.
23. Private workspace reviewers move report and plan versions through separate guarded review lifecycles; only approved, schema-validated object-backed read models can cross their export boundaries, and plan approval requires a ready package plus an approved linked report.
24. The website reads the accepted opportunity projection, evidence/source
    coverage, report, and plan through shared contracts; production analyses
    have an authenticated run read route and active-output mapping for private
    opportunity pages. Production analysis read models also carry the current
    report/plan approval states from their governance projections so private
    pages do not display stale inferred defaults. The public leaderboard remains
    fixture-only.

Every workspace table uses forced row-level security. Authentication must authorize a workspace before application code sets the transaction-local workspace context. Source policy state remains global and cannot be changed directly by the runtime role.

Temporal owns retries, recovery, cancellation, and workflow history. Activities own side effects. PostgreSQL owns state, invariants, checkpoints, output lineage, and one-time ledgers; it is not used as an improvised job queue. Workflow inputs and failures are deliberately sanitized so imported evidence and caller secrets cannot become durable instructions or logs.

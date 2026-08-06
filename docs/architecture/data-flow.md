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
display mode, limit, or budget. A one-source request checks policy
readiness/purpose/display mode and optional approved seed review, then commits
the existing digest-only admission before contacting Temporal. For two to
sixteen configured non-fixture sources, migration `0068` instead creates one
idempotent parent orchestration plus one durable child per source. The
lease-backed maintenance worker claims children independently, rechecks policy,
admits and starts the existing one-source workflow, and reconciles the durable
workflow projection into child, parent, and campaign state. A policy denial is
visible on that child; it is never inferred as absence of complaints.

The private campaign page and run-history API read the existing production
workflow projection through an authenticated workspace transaction. History is
cursor-paginated with a bounded limit and stable request-time/identifier
ordering; each page maps only operational state, checkpoint, source/policy
identifiers, counters, and timestamps. The status page links a completed run
to the existing collection evidence read; hashes, actor details, and source
payloads remain outside the read model.

After collection, the same page offers an explicit reviewed-analysis handoff
for owner/editor members. The browser submits only a new analysis identifier,
the completed collection identifier, an approved seed-review identifier, a
timestamp, and an idempotency key. The authenticated route rechecks the
workspace, collection, seed approval, policy lineage, and analysis admission
before starting `production-analysis-v2`. The analysis-status API/page maps
Temporal or the durable PostgreSQL projection to state, checkpoint, bounded
attempts, bounded attempt history, availability, failure summary, and timestamps; workflow hashes,
object references, and source payloads are never part of this read contract.
The worker forwards the Temporal activity attempt only as execution metadata;
migration `0055` stores the highest observed value with a database monotonicity
guard and `0056` stores server-clock start/finish/duration and stage heartbeat
rows, while the research input hash remains unchanged for idempotent replay.
The optional workflow identifier is validated against the workspace prefix
before either status source is queried.

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
   The `manual-owner-import` connector is the owner-authorized exception (current
   policy `manual-owner-import-v2`; v1 is historical): an
   authenticated owner first stages normalized, PII-scrubbed CSV/JSON rows in
   PostgreSQL, and the workflow carries only the staged `manualImportBatchId`.
   No imported URL is fetched and no raw upload bytes enter Temporal history.
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
   For an owner import, batch consumption is committed in this same
   persistence transaction. Owner deletion clears staged payloads and creates
   source tombstones before the existing deletion propagation worker redacts
   downstream evidence and outputs.
9. Workspace editors and owners review active complaint observations through
   the private collection surface. Migration `0032` permits only
   `unreviewed` -> `confirmed`/`rejected` and `confirmed` -> `rejected`
   transitions; review receipts contain identifiers only.
   9a. After a recent password step-up, an editor or owner may submit a strict
   field-redaction request for one run-bound evidence record. Migration `0067`
   checks the complaint/run/evidence binding, records a durable receipt, and
   masks only the selected current projection fields. Source identity, hashes,
   capture time, policy lineage, and immutable analysis history remain intact;
   raw-object deletion still follows the source-policy path.
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
    inferring missing market coverage from complaint text. A separate
    `competitor_research_observations` row may attach one bounded claim only to
    an existing competitor relationship and an existing source item/evidence
    pair. Migration `0059` requires an approved `competitor-research` purpose,
    active provenance, and an editor/owner review transition. The private
    opportunity read model records whether competitive research is unresolved,
    reviewed-seed-only, or source-backed; source-backed status requires a
    confirmed non-synthetic observation, permitted source/evidence IDs, and an
    observation time. Migration `0101` adds an append-only deep-research gate
    review that derives current observation/source/evidence IDs and a snapshot
    hash, records owner/editor checklist decisions, and returns `stale` when
    the bound analysis or retained evidence changes.
    Migration `0104` adds an append-only analysis lineage projection for
    confirmed, non-synthetic, evidence-linked owner-import observations. The
    worker reconstructs the exact snapshot from current collection,
    relationship, policy, and evidence joins; review, deletion, policy, or
    collection drift excludes the row and remains a visible coverage gap.
14. Scoring calculates a versioned score only from explicit reviewed factors.
15. A distinct post-collection analysis run rechecks the completed collection,
    approved policy review/hash, and every active complaint/evidence/source-item
    mapping before clustering, reviewed competitor/contrary-signal attachment,
    the exact competitive observation snapshot, and deterministic scoring.
16. When collection input names an approved seed, migration `0034` enqueues a
    deterministic post-collection handoff in the same completion transaction.
    A skip-locked worker reconstructs the input after complaint review and
    starts the idempotent analysis workflow; no source acquisition occurs in
    this handoff.
17. The analysis repository stores a redacted `workflow-artifact`, validated
    report JSON, and coding-agent plan through the content-addressed
    `packages/object-store` seam; PostgreSQL stores compact snapshots, hashes,
    references, and policy/evidence/competitive-observation/output lineage.
    The report and plan keep this snapshot tenant-private and do not change
    seed-owned score factors.
18. A workspace transaction persists immutable production projections,
    output IDs, audit/outbox receipts, and active availability state. Source
    deletion propagation invalidates the analysis run while retaining lineage
    for authorized object purge; migrations `0037` and `0062` queue
    deletion- or correction-triggered active-evidence repairs with their
    immutable trigger and reviewed seed lineage. The worker dispatches those
    jobs only after the seed is approved, while migration `0036` permits
    reactivation only after the new active output is linked.
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
    pages do not display stale inferred defaults. Production opportunity state
    resolves to `candidate` until the explicit deep-research gate proves
    source-backed competitive coverage and the current owner-reviewed gate is
    passed; coverage gaps remain visible after promotion and the public
    leaderboard remains fixture-only.
25. Source-policy maintenance rechecks each completed production analysis
    against its immutable policy lineage and the current source/policy review.
    A non-collectible output is marked `expired` in a bounded, fenced pass,
    without purging its retained objects or rewriting lineage. The pass repairs
    active opportunity pointers to the newest still-collectible output, or
    invalidates the opportunity when none remains, and records identifier-only
    audit/outbox receipts. Private analysis, opportunity, report, plan, and
    export reads apply the same current-policy gate before maintenance catches
    up. Later source deletion remains the separate destructive path that moves
    retained expired outputs to `invalidated` and enqueues object purge.

Every workspace table uses forced row-level security. Authentication must authorize a workspace before application code sets the transaction-local workspace context. Source policy state remains global and cannot be changed directly by the runtime role.

Temporal owns retries, recovery, cancellation, and workflow history. Activities own side effects. PostgreSQL owns state, invariants, checkpoints, output lineage, and one-time ledgers; it is not used as an improvised job queue. Workflow inputs and failures are deliberately sanitized so imported evidence and caller secrets cannot become durable instructions or logs.

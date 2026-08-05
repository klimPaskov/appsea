# Production-shaped analysis composition

The analysis boundary turns a validated collection payload into an inspectable
artifact, deterministic score, evidence-backed report, and coding-agent
package. The durable production path is separate from source activation and
the sparse public leaderboard: PostgreSQL owns lineage and projections,
content-addressed storage owns large blobs, and Temporal retries the bounded
post-collection activity.

Run the test-only CFPB-shaped sample with:

```powershell
pnpm analysis:sample
```

The command writes `artifacts/analysis-sample/` atomically:

- `analysis-artifact.json` contains policy, query, source-native identifiers,
  redaction state, observations, clusters, the explicit opportunity seed, and
  visible coverage gaps.
- `report.json` separates observations, deterministic score inference,
  recommendation, warnings, and `testOnly: true` transport metadata.
- `plan/` contains the six deterministic coding-agent package files.
- `manifest.json` records the generated artifact identity and file hashes.

The sample uses an approved-shaped, non-fixture policy snapshot only as an
in-memory contract test. It does not call CFPB, register or activate a source,
write PostgreSQL, start Temporal, or support market conclusions.

Production analysis inputs must come from a policy-validated collection
payload. They must preserve the request query and display mode, use redacted
non-synthetic complaints, and reference an approved workspace seed review with
explicit competitor, contrary-evidence, and score-factor values. The pipeline
never infers willingness to pay, feasibility, competitive gap, or contrary
evidence from complaint text. Seed creation and approval are available at
`/workspace/:workspaceId/seed-reviews`; an editor marks a record reviewed and
an owner approves it. The seed contract requires the complete six-file plan
manifest (`README.md`, `01-product-brief.md`, `02-mvp-scope.md`,
`03-architecture.md`, `04-task-graph.json`, and `05-validation.md`) so
deterministic package generation fails closed at review input rather than
after a durable worker starts.

### Confirmed competitive observations

The private Competitors route accepts owner/editor observations from the
reviewed `manual-owner-import-v2` policy. A claim remains unreviewed until an
editor or owner confirms it. After confirmation, start the existing reviewed
production analysis explicitly for the collection run; the worker reads the
workspace-bound snapshot immediately before persistence. It includes only
confirmed, non-synthetic observations whose source item, evidence, competitor
relation, current policy purpose, and collection lineage are all active. The
snapshot retains observation/evidence hashes, source identifiers, claim type,
representation mode, and coverage gaps.

When a policy permits only `metadata-only` or `aggregate-only` representation,
the persisted artifact, report, and plan replace the competitive claim text
with the policy-withheld marker while retaining identifiers and hashes.

The next report and six-file plan include this snapshot in a tenant-private
competitive-evidence section. It does not alter deterministic score factors,
does not claim broad market coverage, and does not auto-rerun when a claim is
reviewed. Rejected, deleted, stale, unrelated, or policy-mismatched rows are
excluded and recorded as gaps; finalization fails closed if the worker payload
differs from the current database snapshot. Migration `0104` preserves the
consumed lineage for audit and replay. Field redaction masks the competitive
claim and locator through the same analysis-run evidence redaction projection.

## Durable production path

`PostgresProductionAnalysisRepository.persist` accepts only a
`productionAnalysisPersistenceInputSchema` payload with a distinct analysis
run ID, approved policy review hash, approved reviewed opportunity seed, and
explicit complaint/evidence/source-item mappings. It requires an active private
non-fixture workspace and a completed production collection run. The
repository rechecks policy, approved seed content hash/version, and active evidence lineage in the same transaction,
then writes three content-addressed objects:

- `workflow-artifact`: redacted production artifact snapshot;
- `report-json`: validated evidence/inference/recommendation report;
- `plan-package`: validated coding-agent package.

PostgreSQL stores only the compact analysis snapshot, full object references
on the analysis run, a URI marker on `report_versions`, output IDs, hashes,
coverage gaps, warnings, and lineage rows. Replays use the
workspace/idempotency key and immutable content hash; a completed run returns
its existing references without duplicating projections. Source deletion
propagation marks active analysis runs `invalidated`, and private reads refuse
invalidated runs or deleted/missing objects.

The Temporal `productionAnalysisWorkflow` and worker activity use a hashed
idempotency digest rather than the caller's raw key. The worker requires
`APPSEA_OBJECT_STORE_ROOT`; the filesystem adapter is suitable for local/CI
proof only. A production deployment must replace it with an encrypted,
versioned S3-compatible adapter and verify lifecycle/backup deletion.

New starts use `production-analysis-v2`. The Temporal input contains only the
workspace, collection, analysis, seed-review, digest, and timestamp identifiers.
The activity reconstructs the policy-validated artifact from workspace-bound
database rows immediately before persistence. This is a deliberate history
boundary: complaint text, evidence, report data, and plan files do not cross
Temporal. A rollout must keep workers that understand the prior v1 history
shape until all v1 executions are drained or an approved retention plan is in
place; v1 is not a valid new-start contract.

The activity timestamp is the server-observed Temporal time and is the only
clock used for the artifact, report, plan, and retention anchors. The caller's
`requestedAt` remains idempotency metadata; the repository rejects materially
future timestamps as a defense-in-depth check.

When a production collection was started with an approved
`analysisSeedReviewId`, migration `0034` queues a durable analysis handoff in
the collection completion transaction. The worker dispatcher reconstructs the
same policy-validated, complaint-review-gated input and starts this workflow
with a deterministic analysis run identity. A handoff is not a source
connector: it performs no external acquisition and cannot bypass source policy,
redaction, or complaint review. If evidence is not yet confirmed or corrected, the
handoff remains queued for bounded retry; if Temporal is unavailable, a later
claim safely retries the same idempotent start.

The authenticated read route is:

`GET /api/workspaces/:workspaceId/analysis/:analysisRunId`

The private collection page provides the reviewed owner/editor handoff. It
lists only approved seed reviews, starts the existing admission route, and
links to the safe status view:

`GET /api/workspaces/:workspaceId/analysis/:analysisRunId/status`

`/workspace/:workspaceId/research/analysis/:analysisRunId` reads Temporal first
when a validated workspace-bound workflow ID is present and falls back to the
PostgreSQL status projection. It is a progress/readiness surface, not an
artifact export: hashes, object references, source payloads, and seed content
are intentionally absent. A completed status can link to the private
opportunity package, whose report and plan approval gates still apply.

## Activity-attempt telemetry

Migration `0055_production_analysis_attempt_telemetry.sql` adds
`production_analysis_runs.activity_attempts`, bounded to ten and guarded so
the value cannot decrease. The worker reads the Temporal activity attempt and
passes it separately from the validated persistence input. The repository
updates the projection with `GREATEST`, including idempotent replays and
completion/failure transitions; the attempt is not included in the input hash.
Private PostgreSQL fallback status therefore reports observed attempts for
queued, running, and completed runs without exposing workflow payloads.
Migration `0056` adds at most ten per-attempt rows with server-clock timing,
stage heartbeats, duration, and fixed failure codes. The web boundary merges
that history into a successful Temporal read when available; it remains a
safe private projection. Signed alert delivery covers bounded outcomes; endpoint
operation and production scheduler ownership remain separate operational
controls.

Private opportunity pages prefer the latest active production analysis for a
slug and otherwise retain the fixture read path. The public leaderboard remains
fixture-only and never displays production rows.

## Correcting derived complaint analysis

An owner or editor can correct a complaint's derived interpretation from the
private production evidence view. The UI uses field-level controls, while the
request remains a strict object validated by `complaintAnalysisCorrectionSchema`;
source text, source identifiers, capture/publish times, policy metadata,
redaction state, provenance, and the stored evidence basis for entity claims
are not editable.

The repository rebuilds and validates the complete analysis snapshot, then
calls `appsea.apply_complaint_analysis_correction` in the authenticated
workspace transaction. Migration `0061` records an immutable correction row
with actor and prior/next snapshot hashes, changes review state to `corrected`,
and emits identifier/hash-only audit and outbox receipts. Active production
analysis runs linked to the complaint are invalidated. Opportunity projections
that no longer have another active completed analysis are invalidated and their
current score/plan pointers are cleared. Private report/plan reads filter out
outputs linked only to invalidated analysis runs.

The correction endpoint is idempotent for the same correction ID and hashes;
conflicting reuse is rejected. Evidence deletion and rejected complaints fail
closed. The next reviewed analysis input carries the persisted corrected
snapshot, so the report does not silently reclassify the source text. Migration
`0062_correction_recompute_jobs.sql` adds a deferred database trigger that
queues one deterministic repair request for each affected invalidated
opportunity. The existing worker dispatcher reconstructs active evidence and
starts the same identifier-only analysis workflow. An approved immutable seed
is still required; a missing or withdrawn seed leaves the request blocked for
operator inspection rather than bypassing review. Cloud object deletion,
deployment scheduling, and alert endpoint operation remain operational
follow-ups.

## Bounded recomputation alert inspection

The existing deletion- and correction-triggered repair queue can be inspected
without claiming or dispatching work:

```powershell
$env:APPSEA_RECOMPUTE_ALERT_MAX_WORKSPACES = '1000'
$env:APPSEA_RECOMPUTE_ALERT_MAX_JOBS_PER_WORKSPACE = '100'
$env:APPSEA_RECOMPUTE_ALERT_AFTER_SECONDS = '900'
pnpm worker:production:analysis:recompute:alert
```

The command enumerates active workspace identifiers through `DATABASE_URL`
(`appsea_service`) and calls the narrow
`appsea.list_production_analysis_recompute_alerts` projection through
`APPSEA_MAINTENANCE_DATABASE_URL` (`appsea_maintenance`). A maintenance
scheduler lease is acquired before reads and asserted throughout the scan. The
projection returns only state, attempt count, and timestamps; output and
metrics contain bounded job/failure/block/stale counts, age, alert state, and a
truncation flag, never repair identifiers, failure summaries, source content,
or lineage.

Route `production_analysis_recompute_alert` to incident response when a job is
failed, blocked, or has exceeded the age threshold. Treat
`production_analysis_recompute_alert_incomplete` or `truncated: true` as
unknown coverage, not clear. `production_analysis_recompute_clear` means a
complete bounded scan observed no failed, blocked, or aged repair. It does not
retry, resolve, start Temporal, recollect source data, or change retention;
alert/incomplete/failure outcomes use the signed delivery boundary, while
deployment owns scheduler supervision, endpoint operation, and operator
response.

## Object storage boundary

`@appsea/object-store` now provides the reviewed storage seam used by production
artifact, report, and plan persistence. `InMemoryObjectStore` is deterministic
test storage; `FileObjectStore` is a local/CI content-addressed adapter that
writes immutable blobs plus validated metadata sidecars. `report-object.ts` and
`plan-object.ts` validate and canonicalize their respective payloads before
storage. Both adapters enforce:

- workspace-bound opaque references (`appsea-object://...`)
- SHA-256 content identity and bounded object size
- immutable replay and conflict detection
- tombstone-before-read deletion handling
- retention-expiry or explicit deletion/closure authorization before purge

Production analysis provenance is also explicit at the contract boundary:
every complaint carries its evidence and source-item IDs plus an evidence
content hash, policy snapshots carry the approved policy version/content hash
and review ID, and the analysis run ID is distinct from the collection run ID.
Opportunity/score/competitor assumptions remain inside a reviewed seed envelope.

Competitor feature comparisons follow the same boundary. The normalized
competitor row may carry a bounded feature matrix with an explicit evidence
basis and notes. Production seed reviews accept only `reviewed-seed` entries;
fixture entries remain synthetic, and `source-observation`/`mixed` entries must
reference retained competitive observation identifiers. The public and private
competitor routes render this normalized matrix without raw provider payloads.
Populate source-backed entries only after a competitor-purpose source policy
has been independently approved and the corresponding observations have passed
editor/owner review.

The filesystem adapter is not a production deployment. Production still needs
an encrypted, versioned S3-compatible implementation, lifecycle rules, backup
deletion verification, and a fresh Docker-backed migration/read/deletion test.

`packages/reports/src/plan-object.ts` validates, deterministically encodes, and
decodes a `PlanPackage` before it crosses the object-store seam. The companion
`report-object.ts` helper uses the `report-json` object kind for validated
reports. Both helpers are covered by replay tests. The private report routes
hydrate validated object-backed reports before applying report approval and
approved-export governance. Plan packages use a separate editor/owner approval
boundary and the private routes
`PATCH /api/workspaces/:workspaceId/plans/:planPackageId` and
`GET /api/workspaces/:workspaceId/plans/:planPackageId/export`; approval requires
a ready package and an approved linked report when one exists.

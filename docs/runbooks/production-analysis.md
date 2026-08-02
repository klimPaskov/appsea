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
an owner approves it.

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
redaction, or complaint confirmation. If evidence is not yet confirmed, the
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

Private opportunity pages prefer the latest active production analysis for a
slug and otherwise retain the fixture read path. The public leaderboard remains
fixture-only and never displays production rows.

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

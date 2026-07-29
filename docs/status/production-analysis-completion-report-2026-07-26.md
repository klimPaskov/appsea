# Production-shaped analysis checkpoint completion report

- Date: 2026-07-26
- Scope: reviewed collection payload composition, durable PostgreSQL analysis
  persistence, content-addressed report/plan/artifact storage, deletion
  invalidation, private reads, bounded Temporal activity boundaries, private
  plan-package approval/export governance, and complaint curation before
  downstream analysis
- Status: production-shaped persistence slice implemented; live source approval,
  cloud object storage, and deployment proof remain open

## Implemented

- `packages/contracts/src/index.ts` defines production analysis input, seed,
  transport, artifact, and report metadata contracts. Production inputs now
  require an immutable policy-version/content-hash/review reference, a
  separately identified analysis run, evidence/source-item IDs and content
  hashes on every complaint, and an explicitly reviewed opportunity-seed
  envelope resolved from an approved workspace seed-review identifier. They
  still require an enabled, approved, non-fixture source policy
  and redacted, non-synthetic complaints; offline transport is legal only with
  `testOnly`.
- `packages/research/src/index.ts` performs deterministic normalization,
  deduplication, clustering, and code-owned score calculation from explicit
  reviewed factor values. Complaint text cannot silently infer or alter score
  factors.
- `packages/reports/src/index.ts` generates production-shaped evidence reports
  with query provenance and restricted-mode excerpt handling, plus a generic
  six-file coding-plan template. `plan-object.ts` validates and deterministically
  encodes/decodes plan packages through the object-store seam, while
  `report-object.ts` does the same for validated report JSON. Production report
  observations use the retained evidence ID rather than the complaint ID. The
  existing Inbox Relay package remains fixture-only.
- `apps/worker/src/analysis-sample.ts` writes a reproducible CFPB-shaped sample
  artifact, report, plan, and hash manifest under `artifacts/analysis-sample`.
  The sample is visibly `testOnly` and uses no network or connector activation.
- `packages/object-store` adds content-addressed object references, immutable
  replay, workspace isolation, tombstone reads, retention-aware purge, and
  deterministic in-memory/filesystem adapters used by the production analysis
  repository for artifact, report, and plan blobs. It does not claim a
  production cloud deployment.
- `packages/db/migrations/0030_production_analysis_lineage.sql` adds the
  RLS-protected analysis-run projection, policy/evidence/output lineage tables,
  report object references, completed-collection gates, policy/evidence/output
  lineage triggers, immutable terminal transitions, and invalidation metadata.
- `packages/db/src/production-analysis-repository.ts` persists a reviewed,
  non-test analysis idempotently: it rechecks collection/policy/evidence
  lineage, stores redacted artifacts plus validated report/plan objects, writes
  deterministic cluster/opportunity/competitor/score/report/plan projections,
  and commits one analysis output snapshot with audit/outbox receipts.
- Source deletion propagation now invalidates active production analysis runs;
  private analysis reads reject invalidated or missing output objects. The web
  exposes an authenticated analysis read route (with auth/not-found/active
  route tests) and maps the latest production analysis into private opportunity
  overview, evidence, report, and plan pages through a migration-free DB
  subpath that is safe for Next.js server bundling.
- `packages/workflows` and `apps/worker` now include a post-collection
  `productionAnalysisWorkflow` whose activity delegates to the idempotent
  repository. Raw idempotency keys stay outside workflow history and the worker
  requires an explicit object-store root.
- The private report approval/export repository path now accepts the reviewed
  object-store adapter, hydrates and validates `report-json` payloads before
  returning them, and keeps the existing role/approval governance.
- Migration `0031_plan_approval_governance.sql` and the private plan repository
  path now enforce editor/owner review transitions, ready/report-approved gates,
  audit/outbox receipts, object-backed plan hydration, and approved plan JSON
  export. The plan page links to the private export route.
- Migration `0032_complaint_review_governance.sql` adds an RLS-safe,
  editor/owner-only complaint-review transition guard. The private collection
  page and PATCH route expose confirm/reject actions, and the evidence read
  model carries `complaintId` plus `reviewState` without exposing review text
  to audit or outbox payloads.
- Migration `0033_opportunity_seed_reviews.sql` adds immutable workspace seed
  content, editor/owner review transitions, and identifier/hash audit/outbox
  receipts. The private seed-review page and APIs create, list, read, review,
  approve, and withdraw records; analysis start and persistence both verify the
  approved stored seed hash and version.
- Migration `0034_production_analysis_handoffs.sql` adds an explicit approved-
  seed-bound handoff queue. Collection completion enqueues a deterministic row
  transactionally; the durable worker claims stale-recoverable rows and starts
  analysis only after reconstructing active policy/evidence lineage.
- The private `POST /api/workspaces/:workspaceId/research/production/:runId/analysis`
  route reconstructs the persisted collection request and approved policy
  snapshot, admits only active confirmed excerpt evidence, builds a
  `persisted-collection` artifact with the reviewed seed, and starts the
  existing idempotent Temporal analysis workflow. Collections without the
  optional seed reference retain the explicit manual-start path.
- The production-analysis activity emits bounded success/failure events with
  workflow ID and Temporal attempt only; complaint text, raw payloads, and
  database/storage details never enter worker logs.

## Validation

- Contract, research, reports, database, workflows, web, and worker suites
  pass, including deterministic replay, cluster coverage, provenance,
  test-only disclosure, private route authorization, and generic plan
  validation.
- `pnpm analysis:sample` produces three complaints, three clusters, and score
  `7.8`, with deterministic file hashes in `manifest.json`.
- The root `pnpm verify` command passed earlier on 2026-07-26 with
  `pnpm analysis:sample` included: all workspace package tasks, fixture/plan
  generation, the analysis sample, web smoke, and repository validation. The
  later plan-governance edits were rechecked with the focused and one-worker
  suites below because this managed environment cannot reliably spawn the
  default package workers.
- Targeted object-backed plan repository and private plan-route tests pass; the
  full package lint/typecheck checks and one-worker Vitest suites pass after the
  governance migrations. The broader direct one-worker slice passed 96 tests,
  including complaint-review, seed-review, and analysis-start routes. The PostgreSQL integration
  suite still requires `APPSEA_TEST_DATABASE_URL`; the Docker-backed gates are
  unavailable because the local Docker Desktop Linux engine pipe is not
  running. A fresh Next build attempt is likewise blocked by the environment's
  `spawn EPERM`; the web package typecheck remains green.

## Simplifications and remaining gaps

- No source connector was activated. PostgreSQL/Temporal/object-store wiring is
  implemented behind reviewed contracts, but Docker-backed execution and a
  production cloud object-store deployment are not proven in this environment.
- Competitors, contrary evidence, score factors, and plan paths are explicit
  reviewed input. They are not inferred by a model or presented as market
  facts; the current production plan generator intentionally supports the six
  reviewed template paths only.
- The remaining release work is cloud object-store encryption/versioning and
  lifecycle/backup purge, live connector approval, production Temporal
  provisioning, deployed handoff scheduling/alerting, aggregate recomputation,
  richer observability/cost reconciliation, richer seed revision UX, and
  fresh Docker integration proof. Docker-backed integration remains unavailable
  when the Docker Desktop Linux engine is not running.

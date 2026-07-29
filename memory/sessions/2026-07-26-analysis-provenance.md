# Session handoff: production analysis provenance hardening

- Date: 2026-07-26
- Scope: additive contract hardening followed by durable production-analysis
  persistence/workflow wiring; no live source activation

## Outcome

- `packages/contracts/src/index.ts` now requires production analysis policy
  snapshots with source/policy version, content hash, and approval review ID;
  reviewed opportunity-seed envelopes; distinct analysis-run IDs; and explicit
  evidence/source-item IDs and hashes on retained complaints.
- `packages/research/src/index.ts` preserves the production complaint metadata
  through deterministic deduplication and artifact generation.
- `packages/reports/src/index.ts` maps production report observations to the
  retained evidence ID and exports report JSON through the `report-json`
  object-store kind. Plan packages continue through `plan-object.ts`.
- The offline CFPB-shaped sample and focused fixtures were updated to use the
  reviewed provenance envelopes. They remain test-only and in-memory.
- Migration `0030_production_analysis_lineage.sql` adds RLS-protected analysis
  runs, policy/evidence/output lineage, report object references, terminal
  guards, completed-collection/policy/evidence/output triggers, and source
  deletion invalidation metadata.
- `PostgresProductionAnalysisRepository` persists redacted artifact/report/plan
  objects and deterministic cluster/opportunity/competitor/score/report/plan
  projections with content-hash/idempotency replay. Private analysis reads use
  workspace authorization and reject invalidated or missing objects.
- Temporal/workers now expose a post-collection `productionAnalysisWorkflow`
  and idempotent object-backed activity; raw idempotency keys stay out of
  workflow history.
- The web DB import uses the dedicated `@appsea/db/production-analysis`
  subpath so Next/Turbopack does not bundle migration-directory discovery;
  the authenticated analysis route has authorization, active-read, and
  not-found tests. Retention expiry is clamped to object creation time so an
  already-expired policy cannot create an invalid object reference.
- The analysis worker activity emits bounded completion/failure events with
  only workflow ID, state, and Temporal attempt metadata.
- Private overview/API routes now use the production-aware context helper, and
  report approval/export joins the analysis output lineage to hydrate the full
  `report-json` object; the compact `report_versions.structured_object_ref`
  remains only a URI marker.
- Migration `0031_plan_approval_governance.sql` adds a separate editor/owner
  plan approval boundary with ready/report-approved gates and audit/outbox
  receipts. Private plan reads hydrate the full `plan-package` object, and the
  authenticated plan export route requires owner approval.
- Migration `0034_production_analysis_handoffs.sql` adds an opt-in,
  approved-seed-bound handoff queue. Collection completion enqueues a
  deterministic row transactionally; `apps/worker/src/production-analysis-handoff.ts`
  reconstructs active policy/evidence lineage, waits through bounded complaint
  review retries, and starts the idempotent analysis workflow with stale-claim
  recovery. The explicit private analysis route remains the manual fallback.
- The private production collection read model/API now hydrates the bounded
  `analysisHandoff` status (or `null` for manual collections) from the same
  workspace-scoped database boundary. The status omits raw idempotency keys and
  source payloads; contract, repository, and route tests cover started, null,
  and pass-through cases.

## Validation

- Before the plan-governance slice, focused contracts, research, reports,
  database, workflows, web, and worker suites plus package typechecks/lints
  passed; root `pnpm verify`, formatting, manifest generation, repository
  checks, and the Next production build also passed.
- After the plan-governance slice, package lint/typecheck and one-worker Vitest
  validation pass (220 unit tests). The direct PostgreSQL integration suite
  still requires `APPSEA_TEST_DATABASE_URL`; a fresh Next build is blocked by
  this environment's `spawn EPERM` process restriction.
- The final handoff check reran direct TypeScript for contracts, workflows,
  database, worker, and web; source-tree ESLint; repository Prettier; and a
  focused 62-test contract/database handoff suite. The regenerated package
  manifest contains 591 files. Temporal-dependent tests remain blocked by the
  damaged local `protobufjs/light` install.
- `pnpm verify:persistence` and `pnpm verify:workflows` were retried on
  2026-07-26 and remain blocked by the unavailable Docker Desktop Linux engine
  pipe (`//./pipe/dockerDesktopLinuxEngine`).

## Still open

- Encrypted cloud object storage, lifecycle/backup purge, source approval,
  production Temporal provisioning/identity, deployed handoff scheduling and
  alerting, aggregate recomputation, plan curation, observability, and
  Docker-backed migration/replay proof remain open. Report and plan
  approval/export now hydrate validated object-backed payloads.

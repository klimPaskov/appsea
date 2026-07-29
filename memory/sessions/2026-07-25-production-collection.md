# Production collection checkpoint handoff

- Date: 2026-07-25
- Status: implemented and repository-validated; not a production activation
- Scope: additive production collection contracts, migrations `0027_source_policy_approval_boundary.sql`, `0028_production_collection_workflow_projection.sql`, and `0029_source_retention_enforcement.sql`, operator-only source-policy registry functions/repository, CFPB collection command, idempotent PostgreSQL source/evidence/complaint/tombstone persistence, bounded policy-derived retention enqueue, production Temporal workflow/client/activity boundary, and private collection evidence/coverage page/API.
- Source: `cfpb-consumer-complaints` remains disabled/pending in `packages/connectors/src/index.ts`; no live policy was registered or approved.
- Operator entry points: `pnpm worker:source:policy:cfpb` (migration-role draft/approval wrapper) and `pnpm worker:source:cfpb` (requires an active approved version plus stable `APPSEA_PRODUCTION_REQUESTED_AT`).
- Private reads: `/workspace/:workspaceId/research/:runId` and `/api/workspaces/:workspaceId/research/production/:runId`.
- Validation: focused contracts 50, connectors 13, DB 27, workflows 18, worker 30, web 32; `pnpm verify`, `pnpm memory:check`, and `pnpm docs:check` pass. `pnpm verify:persistence` and `pnpm verify:workflows` are blocked by the missing Docker Desktop Linux engine pipe.
- Simplification: this stage deliberately does not cluster, resolve competitors, score, generate reports/plans, or deploy production Temporal; the public leaderboard remains synthetic. Policy-derived source retention enqueue is implemented, while purge/object storage, recomputation, and Docker-backed workflow integration remain missing.
- Next: review/approve a source externally, provision secured Temporal/PostgreSQL infrastructure, add repository/activity/retention crash/retry integration proof, close the policy-revocation fetch race, and implement purge/recomputation before enabling any live source.

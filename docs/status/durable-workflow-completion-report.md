# Durable workflow tranche completion report

- Date: 2026-07-24
- This is a historical tranche report; the current production-collection and
  retention state is tracked in
  [`production-readiness-audit-2026-07-25.md`](production-readiness-audit-2026-07-25.md).
- Scope: durable fixture research workflow, approved-source boundary, private
  workspaces, and workflow-boundary hardening
- Status: fixture slice implemented; production release blocked

## Files and systems changed

- `packages/contracts`: bounded workflow/budget schemas, source quota/deletion
  metadata, fixed task-queue contract, and validation tests.
- `packages/db/migrations/0006_durable_workflow_jobs.sql` and
  `0007_workflow_checkpoint_integrity.sql` and
  `0008_auth_workspaces.sql`, `0009_privacy_redaction_gate.sql`, and
  `0010_auth_retention_and_rate_limits.sql`,
  `0011_source_quota_reservations.sql`, and
  `0012_deletion_propagation.sql`,
  `0013_quota_deletion_hardening.sql`,
  `0014_maintenance_workspace_enumerator.sql`,
  `0015_deletion_state_integrity.sql`, and
  `0016_deletion_claim_integrity.sql`, and
  `0017_workflow_actor_attribution.sql` and
  `0018_workflow_actor_update_scope.sql`, and
  `0019_workflow_workspace_gate.sql`: job/checkpoint projections, RLS,
  transition and checkpoint guards, output lineage, fixed queue binding,
  durable shared source quotas, deletion lineage/state, bounded expiry/purge,
  stale-claim recovery, monotonic source/evidence/tombstone redaction guards,
  non-fixture inline-package constraints, and immutable user/service requesting
  actor attribution with workspace membership enforcement; later state updates
  preserve that attribution even if membership changes.
- Production workflow activities refuse arbitrary fixture-workspace creation;
  local/test fixture runs may still auto-provision their synthetic workspace.
  The workflow table trigger also rejects direct inserts for inactive or
  non-fixture workspaces.
- `packages/db/src/workflow-job-repository.ts` and
  `packages/db/src/fixture-repository.ts`: idempotency, state transitions,
  campaign-state protection, output reconciliation identity, and ledgers.
- `packages/db/src/source-quota-repository.ts` and
  `packages/db/src/deletion-propagation-repository.ts`: policy-checked quota
  reservations, idempotent settlement/expiry/purge, owner-scoped all-workspace enumeration,
  skip-locked tombstone claims with stale recovery, source/evidence redaction,
  payload markers, and report/plan unavailability projections.
- `packages/workflows`: deterministic client/workflow, sanitized input copy,
  fixed task queue/version, status query, retries, budgets, cancellation, and
  persistence safe point.
- `apps/worker`: Temporal worker/activity adapters, fixed failure sanitization,
  reconciliation guard, local startup, explicit output IDs/locator, bounded
  structured observability events, source quota/deletion maintenance, and tests.
- `packages/db/src/auth-repository.ts` and `apps/web`: scrypt password hashes,
  revocable session hashes, membership authorization before RLS, private
  workspace APIs/pages for opportunities/evidence/reports/plans, and a sparse
  public fixture leaderboard that remains database-free. Durable hashed-key
  login/signup throttles, bounded session/rate-limit retention, production
  origin checks, `__Host-` session cookies, and the fixture-only authenticated
  workflow start/status gateway are included.
- `packages/connectors`: disabled CFPB policy/connector boundary, durable quota
  capability, and deterministic HTTP/deletion fixtures (not an enabled live
  source).
- `scripts/check_repo.py`, design references, and scoped worker/workflow guidance.

## Important decisions

See [ADR 0007](../adrs/0007-durable-workflow-orchestration.md): Temporal owns
orchestration while PostgreSQL remains the commit authority; workflow history is
small and sanitized on the supported client path; persistence completion is a
non-cancellable safe point; and local Temporal is development-only.

## Evidence

- `pnpm --filter @appsea/contracts test` (42), typecheck: passed.
- `pnpm --filter @appsea/db test` (17), typecheck, lint: passed.
- `pnpm --filter @appsea/connectors test` (12), typecheck, lint: passed.
- `pnpm --filter @appsea/workflows test` (14), typecheck, lint: passed.
- `pnpm --filter @appsea/worker test` (13), typecheck, lint: passed.
- `pnpm --filter @appsea/web test` (8), typecheck, lint: passed.
- `pnpm verify:persistence:fresh`: blocked in this environment because Docker
  Desktop's `dockerDesktopLinuxEngine` pipe is unavailable; the fresh lifecycle
  must be rerun after Docker is available for migrations 0011-0022, quota
  functions, deletion propagation, monotonic guards, and auth/RLS proof.
- `pnpm verify:workflows:fresh`: blocked by the same unavailable Docker engine;
  historical local/CI evidence passed completion, Temporal service
  restart/history replay, duplicate closed execution, one-job/one-run assertion,
  and decoded supported-client history key checks. Rerun after Docker is available.
- `pnpm smoke:web`: passed; this does not cover auth/workflow/evidence routes.
- `pnpm agents:sync`, `pnpm memory:check`, `pnpm repo:check --docs-only`,
  `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
  `pnpm smoke:web`, `pnpm worker:fixture`, `pnpm plan:sample`, and `pnpm manifest`:
  passed.

## Guidance, docs, memory, and generated artifacts

- Skills used: `appsea-source-connector`, `appsea-research-pipeline`,
  `appsea-contract-change`, `appsea-database-migration`, `appsea-worker-job`,
  `appsea-vertical-slice`, `appsea-security-review`,
  `appsea-guidance-maintenance`, `appsea-documentation`, and
  `appsea-completion-audit`.
- No new skill was needed; `appsea-worker-job` owns the reusable workflow and
  `appsea-source-connector` owns the policy-first connector workflow.
- Added ADR 0007, ADR 0008, Temporal, worker-observability, and source-maintenance
  runbooks, CFPB source-policy and auth-retention documents, and this report; updated
  architecture, status, active plan, and `docs/INDEX.md`.
- Updated `memory/HOT.md`, `ACTIVE.md`, `PROJECT.md`, `DECISIONS.md`, and the
  2026-07-24 session handoff.
- `pnpm agents:sync` refreshed generated catalogs; `pnpm manifest` must be rerun
  after this tranche and any subsequent edits.

## Simplifications and missing proof

- Only deterministic fixture research is wired to the durable workflow. No live
  source, model gateway, object storage, or non-zero model/source cost is claimed.
- Local Temporal is an unauthenticated loopback dev server with SQLite; production
  TLS/authentication, namespace authorization, HA, retention, encryption,
  backups/restore, deployment, metrics, and alerts are absent.
- A real Temporal service restart/history replay and activity-retry tests exist,
  but no dedicated worker process crash/replacement fault-injection test exists.
- Workflow unit tests mostly mock activities; adapter failure/cancellation and
  database-failure integration coverage is still incomplete despite the failure
  sanitization unit tests.
- Direct unauthenticated Temporal starts remain release blockers. Production
  activities no longer auto-create arbitrary fixture workspaces, but a
  pre-provisioned workspace ID is still not a substitute for Temporal
  authentication and namespace authorization. The private
  fixture start/status gateway requires membership, and user/service principals
  are now persisted and copied into terminal audit events; production Temporal
  auth and namespace authorization are still required before exposing a live
  workflow surface. At the time of this tranche, account recovery,
  invitations, and session/account deletion workflows were open; the later
  account-closure tranche adds owner-safe profile closure, while provider
  identity and production role separation remain open. Source quota reservations and bounded all-workspace deletion
  propagation are implemented, but stale-claim ownership races,
  object-store/backups purge, and complaint/cluster recomputation remain open.
  Database payloads are replaced with deletion markers; external object-store
  and backup duties still require deployment-specific integration.
- The CFPB connector is disabled pending review and therefore provides no live
  market coverage. Synthetic fixture content remains labeled and is not research.

## Current blockers and next actions

1. Provision an authenticated/TLS-protected Temporal topology and API gateway;
   add worker replacement and adapter fault-injection proof.
2. Add account recovery/invitations and the remaining identity operations
   behind an authenticated gateway; operate the new auth retention job on a
   schedule and validate distributed rate-limit behavior.
3. Complete legal/privacy/security review, then activate the CFPB policy only
   through an approved source registry; validate quota operations and deletion
   recomputation/object-store duties in deployment.
4. Extend the authenticated evidence/report slice with curation and
   non-fixture object-storage routes. Report approval and approved JSON export
   are now implemented; the deterministic fixture report composer and private
   report rendering remain fixture-only.
5. Rerun Docker-backed persistence/workflow gates, verify the generated
   manifest after future edits, and run the full completion audit before making
   any production claim.

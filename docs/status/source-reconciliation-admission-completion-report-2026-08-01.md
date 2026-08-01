# Source reconciliation admission completion report

## Outcome

The direct CFPB full-snapshot reconciliation boundary now has an explicit
authenticated admission path for private workspaces. Migration `0045` adds
immutable user/service actor attribution, a workspace-scoped five-start/
15-minute and one-active-job gate, and an `appsea-worker` service-principal
guard for the existing operator command. The source remains disabled pending
the separate legal/privacy/security policy review.

## Changed surfaces

- `packages/contracts/src/index.ts` adds the bounded private start request
  contract.
- `packages/db/migrations/0045_source_snapshot_reconciliation_admission.sql`
  adds actor columns, forced-RLS start buckets, the security-definer user
  admission function, and the worker actor trigger.
- `packages/db/src/transaction.ts` adds the explicit worker service-principal
  transaction helper.
- `packages/db/src/source-snapshot-reconciliation-repository.ts` adds the
  authenticated `enqueueForUser` repository path while preserving the
  service-only operator enqueue path.
- `apps/web/src/app/api/workspaces/[workspaceId]/research/source-reconciliation/route.ts`
  exposes the private request route with bounded JSON, same-origin checks,
  membership checks, retry headers, and sanitized failures.
- Unit, route, migration-contract, and PostgreSQL integration tests cover the
  admission and actor boundary. The integration fixture cannot run here while
  Docker Desktop's Linux engine pipe is unavailable.

## Security and policy decisions

- User admission inserts the durable job in the same transaction as the
  security-definer decision; there is no separate orphan reservation.
- The direct command remains a worker operation, not a public user bypass. It
  must establish `appsea-worker` through `withServiceWorkspaceTransaction` and
  targets only active private non-fixture workspaces.
- User-provided idempotency keys are hashed before persistence. The read model
  contains only the digest, never the caller key.
- Admission does not activate a source or override the existing policy and
  source-lease gates.

## Validation

- `pnpm --filter @appsea/contracts typecheck` passed.
- `pnpm --filter @appsea/db test -- --run` passed (74 tests).
- `pnpm --filter @appsea/db lint` passed.
- `pnpm --filter @appsea/db typecheck` passed.
- `pnpm --filter @appsea/web test -- --run src/app/source-reconciliation-start-route.test.ts` passed as part of the web suite (19 files, 57 tests).
- `pnpm --filter @appsea/web lint` passed.
- `pnpm --filter @appsea/web typecheck` passed.
- Real PostgreSQL/RLS integration remains blocked by
  `//./pipe/dockerDesktopLinuxEngine` in this environment.

## Simplifications and remaining blockers

- The admission gate uses fixed repository-owned limits (five starts per 15
  minutes and one active job); configurable per-tenant plans are deferred.
- A user admission is consumed by the durable job insert rather than a second
  Temporal reservation because snapshot reconciliation is a database worker
  queue, not a user-started Temporal workflow.
- Deployment still needs separate service/database roles, secret rotation,
  scheduler ownership, monitoring, crash/failure drills, and reviewed CFPB
  policy activation. This tranche does not claim a live source or production
  infrastructure.

# Maintenance scheduler transaction fencing completion report

Date: 2026-08-01

## Result

The repository now has a database-level fence for selected scheduler-owned
mutations. Migration `0052` validates the private scheduler identity with
PostgreSQL server time and holds the scheduler advisory/lease-row locks inside
the service transaction. A stale token fails closed before the mutation
callback runs.

## Changed surfaces

- Added the private `MaintenanceSchedulerFence` contract and strict validation.
- Added `appsea.assert_maintenance_scheduler_lease` with a narrow
  `appsea_service` execute grant and no table access.
- Extended transaction helpers and fixed `MaintenanceSchedulerFenceError`.
- Threaded the fence through source quota, deletion propagation, workflow and
  analysis admission purge, source-lease purge, object-purge state transitions,
  authentication retention, password-reset delivery state, and invitation
  delivery state.
- Kept the token out of run metrics, worker events, API contracts, and logs.
- Added scheduler/runner/unit coverage plus a Docker-gated integration test for
  lock holding, takeover, and stale-token rejection.

## Validation

- `pnpm --filter @appsea/contracts test`: 66 passed.
- `pnpm --filter @appsea/db test`: 88 passed.
- `pnpm --filter @appsea/worker test`: 63 passed.
- Affected contracts, database, and worker typechecks passed.
- `pnpm format:check` passed.
- Docker-backed PostgreSQL integration remains unrun because the local Docker
  Desktop Linux engine pipe is unavailable; the integration test is present but
  is not completion proof for a live database.

## Explicit limits and blockers

- CFPB remains disabled pending legal/privacy/security approval.
- Snapshot reconciliation, external source requests, provider delivery, and
  object-store deletion are outside the atomic PostgreSQL fence and need
  idempotency/conditional-delete and deployment recovery proof.
- Production PostgreSQL/Temporal/cloud provisioning, per-scheduler role
  isolation, alert ownership, backups, identity-provider/MFA controls, and
  signed Windows/macOS releases remain open.

# Complaint-correction recomputation completion report

Date: 2026-08-02

Status: repository-level vertical slice complete; production deployment remains
unverified.

## Outcome

Derived complaint corrections now participate in the existing durable analysis
repair path. A correction transaction invalidates stale analysis/opportunity
projections and, at transaction commit, queues one deterministic repair request
per affected opportunity. The worker reconstructs the current active,
policy-allowed evidence and starts the existing identifier-only
`production-analysis-v2` workflow. The queue requires exactly one immutable
source-tombstone or complaint-correction trigger identity.

Missing, withdrawn, or unapproved opportunity seeds remain `blocked`; the
correction path never bypasses seed review, source policy, evidence review, or
workspace RLS. Source evidence, provenance, and correction history remain
immutable.

## Implementation evidence

- `packages/db/migrations/0062_correction_recompute_jobs.sql` adds the
  correction trigger identity, lineage checks, and a deferred forced-RLS queue
  trigger that runs after correction invalidation is visible.
- `packages/db/src/production-analysis-recompute-repository.ts` maps nullable
  tombstone and correction identities without changing claim, retry, stale
  recovery, or deterministic workflow behavior.
- `apps/worker/src/production-analysis-recompute.ts` dispatches both deletion-
  and correction-triggered repairs through the same active-evidence and
  approved-seed gates.
- The complaint-analysis skill, active plan, runbooks, architecture/status
  docs, and project memory describe the shared queue and its blocked-seed
  behavior.

## Validation

- `pnpm --filter @appsea/db lint`: passed.
- `pnpm --filter @appsea/db typecheck`: passed.
- `pnpm --filter @appsea/db test`: passed, 23 files / 106 tests.
- `pnpm --filter @appsea/worker lint`: passed.
- `pnpm --filter @appsea/worker typecheck`: passed.
- `pnpm --filter @appsea/worker test`: passed, 17 files / 75 tests.
- Real PostgreSQL migration/RLS integration is not proven in this environment:
  Docker Desktop's Linux engine pipe is unavailable.

## Simplifications and remaining gaps

- The correction editor remains a compact derived-field JSON boundary; a
  field-by-field form and competitor feature matrix are still open.
- Automatic re-analysis reuses already collected active evidence and an
  approved immutable seed; it never fetches a source or invents a seed.
- The deferred trigger records the durable queue row but does not add a new
  UI queue counter; existing private status and maintenance paths remain the
  inspection boundary.
- Production Temporal/DB provisioning, source approval, identity delivery,
  object-store/backup purge, scheduler ownership, alert routing, and Docker
  crash/retry proof remain deployment blockers.

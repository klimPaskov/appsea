# Worker maintenance hardening completion report

Date: 2026-07-24

## Outcome

The source quota/deletion and authentication retention entry points now share
small, pure, schema-validated runners. Scheduler input is bounded before
repository work, results are bounded before they are emitted, and each run has
a stable correlation job ID (a UTC-minute default that can be supplied by the
scheduler). Quota expiry and settled-reservation purge have independent batch
budgets, so one operation cannot consume the other's work allowance.

This hardens the existing PostgreSQL operations. It does not activate a source,
create a second queue, or claim that the local fixture worker is production
infrastructure.

## Implementation

- `packages/contracts/src/index.ts` adds strict source-maintenance and auth-
  retention input/result contracts with bounded batch, retention, and counter
  fields.
- `apps/worker/src/maintenance-runner.ts` adds deterministic workspace ordering,
  deduplication, retention cutoffs, independent budgets, deletion counter
  bounds, and validated result construction.
- `apps/worker/src/source-maintenance.ts` and `apps/worker/src/auth-retention.ts`
  use the runners, minute-bucket job IDs, safe failure events, and guaranteed
  pool cleanup.
- `apps/worker/src/observability.ts` records only bounded maintenance IDs and
  counters; no raw error, source, credential, or database content is logged.
- `apps/worker/src/maintenance-runner.test.ts`, contract tests, and
  observability tests cover sorting, independent budgets, specific-workspace
  runs, counter rejection, retention passthrough, and secret-free events.

## Validation

Passed on 2026-07-24:

- `pnpm --filter @appsea/contracts test` (46 tests)
- `pnpm --filter @appsea/worker test` (19 tests)
- `pnpm --filter @appsea/worker typecheck`
- `pnpm --filter @appsea/db typecheck`

Repository-wide `pnpm verify`, formatting, lint, build, fixture, plan, web
smoke, and repository checks passed for this tranche. Fresh
PostgreSQL/Temporal integration gates remain unavailable
in this environment because Docker Desktop's Linux engine is not running.

## Remaining production gaps

- CFPB source policy remains disabled pending legal, privacy, and security
  approval; no live source is enabled.
- A production scheduler, Temporal topology, metrics/alerts, role separation,
  recovery drill, database deployment, and secret-management controls remain.
- Maintenance reruns are safe at the repository operation level, but there is
  no cross-run maintenance ledger or operator dashboard.
- Invitations, MFA/OIDC, deletion-driven
  complaint/cluster/opportunity recomputation, external object-store/backup
  purge, and signed desktop releases remain open. A later account-closure
  tranche adds owner-safe profile closure, while the account-recovery tranche
  implements hash-only reset tokens, encrypted outbox delivery, and a
  kill-switched worker; provider and identity approval remain open.

## Guidance and memory

The worker, source-maintenance, and auth-retention runbooks, current status,
known gaps, active plan, documentation index, and project memory were updated
in the same tranche. The existing `appsea-worker-job`,
`appsea-contract-change`, `appsea-security-review`, and
`appsea-guidance-maintenance` skills remain the reusable workflow; no new skill
was created.

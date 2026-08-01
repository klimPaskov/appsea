# Production workflow ingress admission completion report — 2026-08-01

## Decision

The repository-level authenticated production collection start boundary is
implemented and package-tested. It is not a production deployment claim: the
CFPB connector remains disabled, and PostgreSQL/Temporal provisioning,
namespace authorization, scheduler supervision, and crash-fault integration
proof remain external release gates.

## Surface audit

| Surface                   | Result                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission persistence     | Migration `0038` creates forced-RLS start buckets and digest-only admission rows. A security-definer function verifies active private non-fixture workspaces, owner/editor membership, and fixed limits under a workspace advisory lock.                                                           | `packages/db/migrations/0038_production_workflow_ingress_admission.sql`                                                                      |
| Rate/concurrency behavior | Five distinct starts per 15-minute workspace window and two active jobs/reservations are admitted. Replayed digests return a replay decision without another slot; rejected starts return bounded retry metadata. Limits are not request fields.                                                   | `packages/db/src/production-workflow-admission-repository.ts`, repository tests                                                              |
| Temporal bridge           | The private start route prepares the same deterministic digest/input hash before calling Temporal. Workflow initialization consumes the short-lived reservation in its existing PostgreSQL transaction; direct service starts without an admission remain compatible for migration/recovery paths. | `apps/web/src/app/api/workspaces/[workspaceId]/research/production/route.ts`, `packages/db/src/production-collection-workflow-repository.ts` |
| Retention/operations      | A bounded purge function removes consumed, released, or expired admissions older than the maintenance cutoff. The source-maintenance runner reports the count in secret-free events.                                                                                                               | `apps/worker/src/maintenance-runner.ts`, `apps/worker/src/source-maintenance.ts`, `apps/worker/src/observability.ts`                         |
| Public product boundary   | The public leaderboard is unchanged and remains fixture-only. Admission details and retry responses are private API behavior; no source payload or raw idempotency key crosses the boundary.                                                                                                       | Existing sparse leaderboard and private-route contracts                                                                                      |

## Validation

- Contract, database, worker, and web TypeScript checks passed.
- The affected contracts, database, worker, and web Vitest suites passed 198
  tests, including migration assertions, admission persistence, maintenance,
  observability, and the private start route.
- The PostgreSQL integration suite now includes fresh-install admission,
  replay, concurrency, rate-limit, and cleanup coverage, but cannot execute on
  this host because the Docker Desktop Linux engine is unavailable.
- `pnpm verify` passed after the final docs and manifest checkpoint (including
  lint, typecheck, tests, builds, fixture/analysis samples, web smoke, and
  repository checks); it does not replace Docker-backed migration/workflow
  evidence.
- `pnpm verify:persistence` and `pnpm verify:workflows` were attempted on
  2026-08-01 but remain blocked because the Docker Desktop Linux engine pipe
  (`//./pipe/dockerDesktopLinuxEngine`) is unavailable on this host.

## Security and privacy review

- The web route authorizes same-origin, authenticated owner/editor access and
  validates the path/body workspace match before admission.
- PostgreSQL checks membership again inside the authenticated transaction and
  the security-definer function rejects inactive, public, or fixture-only
  workspaces.
- Only SHA-256 idempotency/input digests are persisted. Admission tables have
  forced RLS and no direct runtime table grants; narrow functions own admit,
  consume, and purge operations.
- Fixed limits cannot be raised by request input. Retry responses contain only
  a generic message and bounded `Retry-After` seconds.
- Imported source content never participates in the admission decision.

## Simplifications and remaining blockers

- The limits are fixed reviewed migration constants (5 starts/15 minutes, 2
  active jobs, 5-minute reservation TTL), not operator-configurable deployment
  settings. Changing them requires a reviewed forward migration/code change.
- A reservation remains counted until workflow initialization consumes it or
  the TTL expires; an uncertain Temporal start is intentionally not released
  optimistically, preventing duplicate admission after a network ambiguity.
- The local/CI unit and static migration evidence cannot prove PostgreSQL RLS,
  advisory-lock serialization, or Temporal crash behavior without Docker and a
  secured deployment.
- Production source approval, TLS-authenticated Temporal, role separation,
  HA/backups, scheduler alerting, encrypted object storage, export/backup
  purge, identity-provider approval, and signed desktop releases remain open.

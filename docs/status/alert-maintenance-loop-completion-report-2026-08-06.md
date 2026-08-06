# Operational-alert supervisor completion report — 2026-08-06

Status: repository-level alert scheduling seam implemented and statically
validated. This is not proof of a deployed provider, database, or incident
endpoint.

## What changed

- Added `apps/worker/src/alert-maintenance-loop.ts` with bounded interval and
  failure-backoff settings, fixed child order, continue-after-one-child-failure
  behavior, fixed secret-free loop events, and SIGINT/SIGTERM child shutdown.
- The pass runs the existing lease-owned commands in this order:
  `source:quota:alert`, `source:health:alert`,
  `production:analysis:recompute:alert`, `workspace:cost:alert`, and
  `alerts:deliver`.
- Added the `alerts:loop` worker command (exposed from the repository as
  `pnpm worker:alerts:loop`) and a hardened long-lived `alerts`
  service in `infra/production/compose.yaml`. The service remains behind the
  one-shot production preflight and uses the same non-root, read-only,
  capability-dropped, init-enabled boundary as the other worker services.
- Extended the provider-neutral release checker so the alerts service is
  required and long-lived.

## Validation

- Worker tests: 32 files, 131 tests passed.
- Worker lint and typecheck passed.
- `pnpm verify:release -- --static` passed without Docker or provider access.
- The child commands retain their existing PostgreSQL lease, outbox, retry,
  and metrics boundaries; the supervisor does not add an in-memory duplicate
  lock or inspect source content.

## Remaining gates

Deployment still needs an operated scheduler owner, PostgreSQL/Temporal
provisioning, alert endpoint ownership and HMAC rotation, provider billing and
incident routing, Docker-backed recovery evidence, and the external source
policy approvals recorded in the production-readiness audit.

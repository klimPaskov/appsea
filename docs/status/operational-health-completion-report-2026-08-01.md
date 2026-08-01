# Operational health completion report — 2026-08-01

## Outcome

The web and worker now expose bounded, secret-free liveness signals suitable
for deployment integration:

- `GET /api/health/live` is dependency-free process liveness.
- `GET /api/health/ready` checks PostgreSQL, authenticated Temporal, and the
  configured object-store adapter concurrently with a two-second per-check
  deadline and returns `503` unless all checks pass.
- The long-lived worker emits `worker_heartbeat` every 30 seconds after
  startup and stops the timer during graceful shutdown.

The probes never run migrations or workflows and never return exception text,
credentials, connection strings, workflow input, or source content.

## Evidence

- Implementation: `apps/web/src/app/api/health/`,
  `apps/web/src/server/health.ts`, `apps/web/src/server/temporal.ts`, and
  `apps/worker/src/observability.ts`.
- Tests: `apps/web/src/server/health.test.ts` and
  `apps/worker/src/observability.test.ts` cover success, failure, timeout,
  bounded output, interval validation, and heartbeat shutdown.
- Operations: [`../runbooks/web-health.md`](../runbooks/web-health.md) and
  [`../runbooks/worker-observability.md`](../runbooks/worker-observability.md).

## Validation

The focused web and worker tests, typechecks, lint, formatting, and full
repository verification must pass before this tranche is committed.
Docker-backed PostgreSQL/Temporal integration remains an environment gate;
the unavailable Docker Desktop Linux engine is not hidden by these probes.

## Remaining gaps

This slice does not provide a deployed scheduler, durable cross-instance
metrics, alert routing, production Temporal topology, provider backup/purge
controls, source-policy approval, or identity-provider approval. Heartbeats and
readiness are deployment contracts, not evidence that those external controls
have been provisioned.

# Web health probes

The web service exposes two node-runtime probes:

- `GET /api/health/live` is a process liveness check. It does not open a
  database, Temporal, or object-store connection and returns `200` with a
  minimal JSON payload.
- `GET /api/health/ready` is a dependency readiness check. It verifies a
  bounded `SELECT 1`, the authenticated/TLS Temporal connection, and the
  configured object-store adapter. The object-store check validates
  configuration only; it deliberately performs no remote read or write. It
  returns `200` only when every check is healthy and `503` otherwise.

Both responses are `no-store` and contain only fixed service/status fields,
check names, states, and a server-observed timestamp. Dependency exception
text, connection strings, credentials, workflow input, and source content are
never returned. Each dependency check has a two-second deadline; a timeout is
reported as `failed`.

## Deployment contract

Use `/api/health/live` for the container/process liveness probe. Use
`/api/health/ready` for load-balancer admission and rollout readiness. A
production readiness failure is expected until all of the following are
configured and reachable:

- PostgreSQL with verified TLS and the runtime role;
- a non-loopback authenticated Temporal endpoint and namespace;
- the signed S3-compatible object-store settings. A separate deployment
  monitor must verify provider reachability and retention controls because the
  probe does not touch an object.

The probes do not run migrations, start workflows, or mutate research data.
They are diagnostic gates, not deployment proof. Keep the endpoint behind the
deployment's normal ingress controls if the platform requires private probe
routes.

# Production configuration preflight

This command is a deployment configuration gate for the web, durable worker,
maintenance scheduler, and migration process. It performs no network calls,
does not run migrations, and cannot activate a source policy.

## Run

Provide production values through the deployment secret manager, then run from
the repository root before starting any AppSea process:

```powershell
$env:NODE_ENV = 'production'
pnpm production:preflight
```

The command prints only a JSON status, check names, and fixed failure codes.
It never prints database URLs, passwords, API keys, object-store credentials,
certificate material, or delivery secrets. Exit code `0` means the configuration
shape passed; a non-zero exit means the deployment must not proceed.

## Required boundaries

- `DATABASE_URL` must use the remote `appsea_service` role; the maintenance
  URL must use `appsea_maintenance`; the migration URL must use
  `appsea_migrator` and `APPSEA_DATABASE_MIGRATION_ROLE` must be
  `appsea_owner`. All three use `APPSEA_DATABASE_SSL_MODE=verify-full`.
- `APPSEA_TEMPORAL_ADDRESS` must be non-loopback and accompanied by an explicit
  namespace, API key, and pinned PEM/base64 CA.
- Object storage must use the complete signed S3-compatible configuration over
  HTTPS with a non-loopback endpoint. Filesystem storage is not accepted for
  production.
- `APPSEA_PUBLIC_ORIGIN` must be an HTTPS, non-loopback origin. The scheduler
  owner, maintenance database, lease bounds, and metrics bounds must be
  present and valid.
- Cost inspection thresholds must be configured before scheduling
  `pnpm worker:workspace:cost:alert`: set `APPSEA_COST_ALERT_CURRENCY`,
  `APPSEA_COST_ALERT_ACTUAL_THRESHOLD_MICROS`, and
  `APPSEA_COST_ALERT_ESTIMATED_THRESHOLD_MICROS` as exact micro-unit strings.
- Recovery and invitation switches accept only `true` or `false`. Enabling
  either requires the 32-byte encryption key and HTTPS signed-delivery gateway
  configuration; leaving both disabled keeps delivery kill-switched.
- An optional trusted-proxy secret must be exactly 32 bytes in base64url form.

The web readiness endpoint remains the live dependency check: it verifies
PostgreSQL, Temporal, and object-store availability after processes start. The
preflight cannot prove TLS trust against a provider, role grants, backups,
high availability, alert routing, or source-policy approval. Those remain
deployment-owner and independent legal/privacy/security review gates.

## Ownership and recovery

The deployment owner runs this gate on every release and records the fixed
failure codes in the release evidence. A failed check is configuration work,
not a reason to weaken a role, TLS, source-policy, retention, or kill-switch
boundary. After configuration passes, use the migration runbook with the
dedicated migrator connection, then verify `/api/health/ready` and the worker
heartbeat before admitting private research jobs.

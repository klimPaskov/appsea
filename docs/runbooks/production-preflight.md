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
  namespace, the exact reviewed `APPSEA_TEMPORAL_TASK_QUEUE=appsea-research-v1`
  value, API key, and pinned PEM/base64 CA. The deployed Temporal namespace
  authorization must allow only this task queue and the workflow types shipped
  by the matching image; preflight validates the declared queue, while the
  provider ACL and authenticated service identity remain deployment evidence.
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
- Operational alert routing must be enabled with
  `APPSEA_ALERT_ROUTING_ENABLED=true`, an HTTPS non-loopback
  `APPSEA_ALERT_ROUTING_URL`, and a separate 32-byte base64url
  `APPSEA_ALERT_ROUTING_SECRET`. The quota, recomputation, and cost alert
  commands send only their bounded structured alert payloads; clear results
  are not delivered. The endpoint must honor the idempotency key and verify
  the HMAC request signature.
- Recovery and invitation switches accept only `true` or `false`. Enabling
  either requires the 32-byte encryption key and HTTPS signed-delivery gateway
  configuration; leaving both disabled keeps delivery kill-switched.
- `APPSEA_AUTH_MFA_ENCRYPTION_KEY` is always required in production and must be
  a separate 32-byte base64url key. `APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION`
  defaults to `1`; during a reviewed rotation, configure the strictly older
  `APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS` and
  `APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION` pair. The application
  rewraps secrets after successful TOTP verification, and
  `pnpm worker:auth:mfa:rotation:status` reports counts without key material;
  do not remove the previous key until an operator has reviewed zero previous
  and unknown rows.
- OIDC is disabled unless `APPSEA_AUTH_OIDC_ENABLED=true`. When enabled,
  preflight requires HTTPS non-private issuer and callback URLs whose origin
  matches `APPSEA_PUBLIC_ORIGIN`, client
  credentials, `APPSEA_AUTH_OIDC_REVIEWED=true`, and
  `APPSEA_AUTH_OIDC_ACCOUNT_LINKING=explicit`. Optional
  `APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS` entries must be reviewed HTTPS origins
  without paths, queries, or fragments or unsafe literal host forms; the issuer
  origin is always allowed.
  This check validates only the deployment shape; it does not approve a
  provider, verify its discovery/JWKS endpoint, or prove verified-email, DPA,
  delivery, retention, key-rotation, or incident operations. See
  [`auth-oidc.md`](auth-oidc.md).
- An optional trusted-proxy secret must be exactly 32 bytes in base64url form.

The web readiness endpoint remains the live dependency check: it verifies
PostgreSQL, Temporal, and object-store availability after processes start. The
preflight cannot prove TLS trust against a provider, role grants, backups,
high availability, endpoint delivery, provider billing, or source-policy
approval. Those remain deployment-owner and independent legal/privacy/security
review gates. Alert delivery retries a bounded number of times in the command;
the scheduler must retry the command after an unavailable endpoint.

## Ownership and recovery

The deployment owner runs this gate on every release and records the fixed
failure codes in the release evidence. A failed check is configuration work,
not a reason to weaken a role, TLS, source-policy, retention, or kill-switch
boundary. After configuration passes, use the migration runbook with the
dedicated migrator connection, then verify `/api/health/ready` and the worker
heartbeat before admitting private research jobs.

# Production container deployment

This runbook describes the repository's production-shaped OCI packaging and
Compose process topology. It does not provision PostgreSQL, Temporal, object
storage, identity, alert delivery, or a source policy. Those providers and
their approval records must exist before a deployment can pass preflight.

## Package the release

Build from the repository root with the pinned Dockerfiles:

```bash
docker build --file Dockerfile.web --tag appsea-web:<commit> .
docker build --file Dockerfile.worker --tag appsea-worker:<commit> .
```

Before publishing or deploying those images, run the repository release
boundary verifier:

```bash
pnpm verify:release
```

It checks the committed Compose topology, non-root/read-only container
defaults, loopback binding, secret-free production environment example, and
disabled-by-default identity and delivery switches. It also validates Compose
and proves that production preflight rejects an empty environment. The command
does not connect to PostgreSQL, Temporal, object storage, an identity provider,
or a complaint source. Use `pnpm verify:release -- --static` when Docker is not
available; that static result is not a substitute for the hosted Docker proof.

The web image uses Next.js standalone output and listens on port `3000`. The
worker image retains the workspace runtime packages because the durable worker,
maintenance loop, migration command, and preflight share the reviewed worker
entry points. Both images run as UID/GID `10001`, use a read-only root
filesystem in the Compose profile, and drop Linux capabilities.

## Configure the external providers

Copy `infra/production/production.env.example` to
`infra/production/production.env` through the deployment secret workflow. Fill
the three role-separated database URLs, authenticated Temporal endpoint,
pinned CA/API key/namespace and the exact `appsea-research-v1` task queue,
signed S3-compatible object store, public HTTPS origin, MFA key, scheduler
identity, bounded `APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS` window (30–900
seconds), cost thresholds, and HTTPS alert endpoint.
Keep recovery and invitation delivery disabled until their provider and DPA
review is complete. Never commit `production.env`.

## Preflight and migration

Run the one-shot preflight before any service can start:

```bash
docker compose --env-file infra/production/production.env --file infra/production/compose.yaml run --rm preflight
```

The Compose `preflight` dependency also gates `web`, `worker`, `maintenance`,
and `alerts`. A failed preflight is a release stop, not a reason to weaken
TLS, role separation, object-storage, alert, or identity settings.

The Temporal deployment must grant the worker identity access only to the
configured namespace and `appsea-research-v1` task queue. Record that provider
ACL, namespace retention, TLS trust, and service-identity evidence with the
release; the repository preflight cannot prove a remote provider's ACL.

The shared `production.env` may contain the dedicated migrator URL because it
is consumed by `preflight` and the explicit `migrate` profile. Compose
overrides `APPSEA_MIGRATION_DATABASE_URL` and
`APPSEA_DATABASE_MIGRATION_ROLE` to empty values in every long-lived `web`,
`worker`, `maintenance`, and `alerts` container. Verify the rendered Compose
configuration before startup; these services must not receive migration
credentials, even when they use the same env file for their other runtime
settings.

Run the forward-only migration as a separately reviewed release step:

```bash
docker compose --env-file infra/production/production.env --file infra/production/compose.yaml --profile migrate run --rm migrate
```

Use the dedicated `appsea_migrator` URL. Do not run migrations from the web or
worker runtime role, and do not make a down migration part of rollback.

## Start and verify

```bash
docker compose --env-file infra/production/production.env --file infra/production/compose.yaml up -d web worker maintenance alerts
curl --fail https://<approved-origin>/api/health/live
curl --fail https://<approved-origin>/api/health/ready
```

Route load-balancer admission through `/api/health/ready`; use `/api/health/live`
for process liveness. Confirm the worker heartbeat, maintenance metrics, and
alerts-loop events through the deployment's approved log/metric sink. The
`worker` service receives the configured Compose `stop_grace_period` from
`APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS`; do not send a forced kill before that
window expires. The `alerts` service runs six lease-owned alert/delivery/status commands
sequentially; each child retains its own PostgreSQL scheduler lease, while the
loop only supervises ordering, bounded backoff, and shutdown. The readiness
route does not run migrations, start workflows, or test object bodies.

The release CI container job also starts the web image, calls the liveness
route, waits for the Docker healthcheck to become `healthy`, and verifies that
worker preflight rejects an empty production environment. This is a packaging
smoke test, not proof that external providers or a deployed migration are
healthy.

The separate `release-boundary` CI job runs `pnpm verify:release` on every
change. Its preflight check intentionally fails closed with an empty
environment; a zero exit from that check is a release-boundary failure.

The web service is bound to loopback by default. Put a reviewed TLS reverse
proxy or private ingress in front of it; do not expose the container directly
to the public network without the deployment security review.

## Recovery and rollback

- Stop admission by removing the web service from the load balancer first.
- Preserve PostgreSQL and Temporal history; do not delete research to recover a
  failed process.
- Let the worker's idempotent workflow/checkpoint projections and scheduler
  lease recover work after replacement.
- If the worker loses its lease or the provider is unavailable, inspect the
  fixed failure/alert counters and rerun the bounded command after repair.
- Roll back the image only after checking migration compatibility and the
  production-analysis history manifest. The legacy v1 history checker and any
  archive/retention operation remain separately approved deployment work.

This package is a deployment boundary, not proof of production operation. A
release still needs provider TLS/secret/backup/HA evidence, scheduler ownership,
incident routing, source-policy approval, and signed desktop release evidence.

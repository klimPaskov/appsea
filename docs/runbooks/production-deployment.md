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

The web image uses Next.js standalone output and listens on port `3000`. The
worker image retains the workspace runtime packages because the durable worker,
maintenance loop, migration command, and preflight share the reviewed worker
entry points. Both images run as UID/GID `10001`, use a read-only root
filesystem in the Compose profile, and drop Linux capabilities.

## Configure the external providers

Copy `infra/production/production.env.example` to
`infra/production/production.env` through the deployment secret workflow. Fill
the three role-separated database URLs, authenticated Temporal endpoint,
pinned CA/API key/namespace, signed S3-compatible object store, public HTTPS
origin, MFA key, scheduler identity, cost thresholds, and HTTPS alert endpoint.
Keep recovery and invitation delivery disabled until their provider and DPA
review is complete. Never commit `production.env`.

## Preflight and migration

Run the one-shot preflight before any service can start:

```bash
docker compose --file infra/production/compose.yaml run --rm preflight
```

The Compose `preflight` dependency also gates `web`, `worker`, and
`maintenance`. A failed preflight is a release stop, not a reason to weaken
TLS, role separation, object-storage, alert, or identity settings.

Run the forward-only migration as a separately reviewed release step:

```bash
docker compose --file infra/production/compose.yaml --profile migrate run --rm migrate
```

Use the dedicated `appsea_migrator` URL. Do not run migrations from the web or
worker runtime role, and do not make a down migration part of rollback.

## Start and verify

```bash
docker compose --file infra/production/compose.yaml up -d web worker maintenance
curl --fail https://<approved-origin>/api/health/live
curl --fail https://<approved-origin>/api/health/ready
```

Route load-balancer admission through `/api/health/ready`; use `/api/health/live`
for process liveness. Confirm the worker heartbeat and maintenance metrics
through the deployment's approved log/metric sink. The readiness route does not
run migrations, start workflows, or test object bodies.

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

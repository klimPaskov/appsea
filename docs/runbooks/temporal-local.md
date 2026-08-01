# Local Temporal workflow runbook

This runbook exercises the fixture workflow against the local PostgreSQL and
Temporal services. It is a development and CI proof, not a production setup.

## Prerequisites

- Node.js 22 or later, pnpm, and Docker Desktop
- repository dependencies installed with `pnpm install`
- no other service using loopback ports `5433`, `7233`, or `8233`

Start the services:

```bash
docker compose -f infra/local/compose.yaml up -d postgres temporal
```

The database is exposed only on `127.0.0.1:5433`. Temporal gRPC and its UI are
exposed only on `127.0.0.1:7233` and `127.0.0.1:8233`. The local server stores
Temporal history in SQLite on the named `appsea-temporal-data` volume.

## Run the proof

The normal proof applies migrations, starts the worker, runs the fixture workflow,
restarts Temporal, runs the same idempotent request again, and checks that the
database still has one job and one research run:

```bash
pnpm verify:workflows
```

For a disposable fresh-stack proof, the script removes only the Compose project
containers and volumes declared by this file before recreating them:

```bash
pnpm verify:workflows:fresh
```

The command is intentionally destructive to local AppSea test data. It does not
target the repository or any other Docker project.

To run one fixture request after the services and migrations are ready:

```bash
pnpm worker:workflow:fixture
```

The fixture command accepts `APPSEA_TEMPORAL_ADDRESS` only when it is a
loopback host and an explicit valid port. The long-lived durable worker uses the
shared endpoint contract instead: local loopback remains unauthenticated, while
production requires a non-loopback address, namespace, API key, and pinned CA.

## What is covered

- validated workflow input and a scoped idempotency/input hash
- PostgreSQL checkpoints and monotonic state transitions
- bounded retry for transient activity failures
- fixed non-retryable failure classification
- budget rejection before persistence
- cancellation before the persistence safe point
- a late cancellation that still returns the committed result
- duplicate starts and closed-execution reuse
- authenticated web starts bind the session user; local service starts record
  the explicit `appsea-worker` actor in the job and terminal audit event
- Temporal restart recovery and one-time output/cost/audit/outbox effects
- decoded history inspection proving the raw fixture idempotency key is absent

## Troubleshooting

Check health and logs:

```bash
docker compose -f infra/local/compose.yaml ps
docker compose -f infra/local/compose.yaml logs temporal
docker compose -f infra/local/compose.yaml logs postgres
```

If a prior proof left state behind, use `pnpm verify:workflows:fresh`. If the
worker reports a loopback or production configuration error, inspect
`APPSEA_TEMPORAL_ADDRESS` and `NODE_ENV`. If a workflow is already closed, the
client deliberately reuses it and verifies the input hash; changing the same
idempotency key is an error.

## Production boundary

Do not expose this Compose Temporal server, SQLite history, local credentials, or
unauthenticated UI to a network. The worker/client configuration is now
production-shaped, but a production runbook is still required after choosing
the hosted/self-managed topology. It must specify TLS/mTLS, namespace and
task-queue authorization, retention, encryption, HA, backups, restore tests,
worker deployment, metrics, alerts, and incident response.

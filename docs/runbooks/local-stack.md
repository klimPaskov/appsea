# Local private-workspace stack

`pnpm dev:local` is the supported one-command local path for exercising the
authenticated private-workspace contract. It uses only the existing loopback
services and development adapters:

- PostgreSQL on `127.0.0.1:5433`, with the dedicated local service,
  maintenance, and migrator roles
- Temporal development server on `127.0.0.1:7233`
- disposable MinIO on `127.0.0.1:9000` (console at `127.0.0.1:9001`), using
  the signed S3-compatible adapter and the `appsea-local` bucket
- the Next.js web process at `http://localhost:3000`
- the durable fixture/production worker in development mode
- the lease-backed maintenance and alert supervisors in development mode

The command starts PostgreSQL, Temporal, and MinIO, waits for each service
health check, runs the disposable `minio-init` one-shot service to create the
bucket idempotently, applies all forward migrations through the dedicated
migrator role, then starts the worker, maintenance/alert supervisors, and web
process with loopback-only settings. The local S3 endpoint uses fixed development credentials, path-style
addressing, and the test-only insecure-localhost allowance required for HTTP;
these values are never suitable for production. The command deliberately
removes inherited filesystem/cloud object-store, remote Temporal, OIDC,
delivery, proxy, and alert-routing settings so a production environment cannot
be reused accidentally.

## Run

Prerequisites are Docker Desktop, Node.js 22 or later, pnpm, and installed
dependencies:

```bash
pnpm install
pnpm dev:local
```

Open `http://localhost:3000`. Press Ctrl+C to stop the web, worker,
maintenance, and alert processes. The dependency containers remain available
for the next run:

```bash
docker compose -f infra/local/compose.yaml down
```

To remove the disposable database, Temporal, and MinIO data as well, add
`--volumes` (this removes the named local volumes and the bucket contents):

```bash
docker compose -f infra/local/compose.yaml down --volumes
```

Use `pnpm dev:local --dry-run` to inspect the commands and loopback endpoints
without contacting Docker or the database.

To run the disposable end-to-end smoke (loopback services, migrations, worker,
web readiness, authenticated private-workspace signup, owner-authorized manual
intake through durable consumption, complaint confirmation, reviewed and
approved opportunity seed input, production-analysis completion, private
opportunity/report/plan readback, auth pages, fixture disclosure, and
dependency cleanup), use:

```bash
pnpm verify:local-stack
```

The smoke leaves named local volumes (including the MinIO bucket) in place but
removes the Compose containers. GitHub CI runs this command on every change. It
is safe to run locally only when Docker Desktop is available.

## Boundaries

The owner-intake row and reviewed opportunity seed are smoke-only test
payloads. They are never market evidence, are not shown on the public
leaderboard, and prove only the tenant-private manual-import, review, and
production-shaped analysis/report/plan contracts. This is a development
workflow, not a production deployment. It uses local credentials and an
unauthenticated Temporal dev server, keeps the public leaderboard synthetic,
and does not activate CFPB, Stack Exchange, or any other third-party source.
MinIO is a disposable local S3-compatible test service; it does not provide
production encryption, versioning, retention, backup, or deletion controls.
Production still requires the reviewed external
PostgreSQL, Temporal, object-storage, identity, scheduler, alert, and source
policy controls described in the production deployment runbook.

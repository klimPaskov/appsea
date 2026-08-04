# Local private-workspace stack

`pnpm dev:local` is the supported one-command local path for exercising the
authenticated private-workspace contract. It uses only the existing loopback
services and development adapters:

- PostgreSQL on `127.0.0.1:5433`, with the dedicated local service,
  maintenance, and migrator roles
- Temporal development server on `127.0.0.1:7233`
- the filesystem object-store adapter under `.appsea-object-store/`
- the Next.js web process at `http://localhost:3000`
- the durable fixture/production worker in development mode

The command starts PostgreSQL and Temporal, waits for both service health
checks, applies all forward migrations through the dedicated migrator role,
then starts the worker and web process with loopback-only settings. It deliberately removes inherited
cloud object-store, remote Temporal, OIDC, delivery, proxy, and alert-routing
settings so a production environment cannot be reused accidentally.

## Run

Prerequisites are Docker Desktop, Node.js 22 or later, pnpm, and installed
dependencies:

```bash
pnpm install
pnpm dev:local
```

Open `http://localhost:3000`. Press Ctrl+C to stop the web and worker
processes. The dependency containers remain available for the next run:

```bash
docker compose -f infra/local/compose.yaml down
```

Use `pnpm dev:local --dry-run` to inspect the commands and loopback endpoints
without contacting Docker or the database.

To run the disposable end-to-end smoke (loopback services, migrations, worker,
web readiness, authenticated private-workspace signup, owner-authorized manual
intake through durable consumption, auth pages, fixture disclosure, and
dependency cleanup), use:

```bash
pnpm verify:local-stack
```

The smoke leaves named local volumes in place but removes the Compose
containers. GitHub CI runs this command on every change. It is safe to run
locally only when Docker Desktop is available.

## Boundaries

The owner-intake row is a smoke-only test payload. It is never market evidence,
is not shown on the public leaderboard, and proves only the tenant-private
manual-import contract and workflow forwarding. This is a development
workflow, not a production deployment. It uses local credentials and an
unauthenticated Temporal dev server, keeps the public leaderboard synthetic,
and does not activate CFPB, Stack Exchange, or any other third-party source.
Production still requires the reviewed external
PostgreSQL, Temporal, object-storage, identity, scheduler, alert, and source
policy controls described in the production deployment runbook.

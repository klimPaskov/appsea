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

The command starts PostgreSQL and Temporal, waits for both ports, applies all
forward migrations through the dedicated migrator role, then starts the worker
and web process with loopback-only settings. It deliberately removes inherited
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

## Boundaries

This is a development workflow, not a production deployment. It uses local
credentials and an unauthenticated Temporal dev server, keeps the public
leaderboard synthetic, and does not activate CFPB, Stack Exchange, or any
other third-party source. Production still requires the reviewed external
PostgreSQL, Temporal, object-storage, identity, scheduler, alert, and source
policy controls described in the production deployment runbook.

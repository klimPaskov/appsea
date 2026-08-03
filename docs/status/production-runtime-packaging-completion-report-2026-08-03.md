# Production runtime packaging completion report — 2026-08-03

Status: repository packaging implemented; operated production deployment is
not claimed.

## Delivered

- `Dockerfile.web` enables Next.js standalone output and copies the traced
  server/static runtime into a pinned Node 22 image running as UID/GID `10001`.
- `Dockerfile.worker` packages the durable worker and shared workspace runtime
  with reviewed commands for Temporal work, preflight, migration, and the
  maintenance loop under the same non-root boundary.
- `infra/production/compose.yaml` defines one-shot preflight and explicit
  migration services plus web, worker, and singleton maintenance services.
  Long-lived services use read-only filesystems, dropped Linux capabilities,
  `no-new-privileges`, and loopback web binding by default.
- `infra/production/production.env.example` documents the secret-free
  production environment contract without shipping credentials.
- `docs/runbooks/production-deployment.md` records image build, preflight,
  migration, rollout, health, recovery, and rollback responsibilities.
- GitHub CI validates the Compose model and builds both images.

## Validation

- Local `pnpm --filter @appsea/web build` produced the expected standalone
  server at `apps/web/.next/standalone/apps/web/server.js`.
- Local `docker compose --file infra/production/compose.yaml config --quiet`
  passed without a Docker daemon.
- GitHub Actions run `30822047661` passed for commit `bd713ee`, including the
  full verification, fresh PostgreSQL and Temporal checks, Compose validation,
  and both container image builds.

## Explicit limits

This tranche does not provision PostgreSQL, Temporal, object storage, identity,
alert delivery, or a container registry; sign images; run a production
migration; activate a source connector; or prove HA, restore, crash,
backup/purge, incident, or signed desktop release behavior. Those remain
reviewed deployment-owner and independent legal/privacy/security gates.

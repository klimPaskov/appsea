# Production object-storage adapter completion report — 2026-08-01

## Outcome

The shared object-store boundary now has a signed S3-compatible adapter in
addition to the deterministic in-memory and local filesystem adapters. The web
process, durable worker, and source-maintenance command select the adapter
through one validated environment factory. Local defaults remain available
only outside production; production configuration without an explicit adapter
fails closed.

The adapter writes content-addressed bodies and JSON sidecars with conditional
requests, signs requests with AWS Signature Version 4, rejects redirects,
validates response size and SHA-256 content, preserves workspace isolation, and
keeps deletion/retention state in the sidecar. It does not claim provider
encryption, bucket versioning, backup deletion, key rotation, or a deployed
cloud topology.

## Evidence

- packages/object-store/src/index.ts implements S3ObjectStore,
  objectStoreFromEnv, bounded response handling, conditional immutable puts,
  ETag-guarded deletion marks, and retention-aware purge.
- packages/object-store/src/s3.test.ts exercises signing, replay, workspace
  isolation, corruption detection, retention, conditional deletion, endpoint
  validation, and configuration selection through a fixture-backed transport.
- apps/web/src/server/object-store.ts,
  apps/worker/src/durable-worker.ts, and
  apps/worker/src/source-maintenance.ts use the shared factory.
- apps/web/package.json generates Next route types as part of typecheck so the
  repository verification does not depend on a stale concurrent .next build.
- .env.example, docs/runbooks/production-object-storage.md, the system
  overview, status, and active plan describe the configuration and remaining
  provider/deployment gates.

## Validation

- pnpm --filter @appsea/object-store typecheck — passed.
- pnpm --filter @appsea/object-store lint — passed.
- pnpm --filter @appsea/object-store test — 15 tests passed.
- pnpm --filter @appsea/worker typecheck — passed.
- pnpm --filter @appsea/web typecheck — passed.

## Simplifications and remaining blockers

- The adapter is S3-compatible rather than tied to one cloud provider; provider
  policy, encryption, versioning, network controls, key rotation, backup purge,
  and restore drills still require deployment review and evidence.
- The adapter uses a body plus sidecar instead of a provider-specific metadata
  transaction. Conditional writes and the durable PostgreSQL purge queue keep
  partial failures inspectable and retryable.
- No source was activated and no production migration or cloud credential was
  performed. Docker-backed PostgreSQL/Temporal verification remains blocked by
  the unavailable Docker Desktop Linux engine.

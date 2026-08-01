# Production object storage

AppSea stores non-fixture analysis artifacts, report JSON, and plan packages
through the object-store contract. The local and test adapters remain
available, but a production process must use the signed S3-compatible adapter.
This runbook describes configuration and the boundary it provides; it is not a
cloud-provider approval or deployment runbook.

## Configuration

Set all of these values through a secret manager or deployment environment:

```
APPSEA_OBJECT_STORE_ENDPOINT=https://objects.example.test
APPSEA_OBJECT_STORE_BUCKET=appsea-production
APPSEA_OBJECT_STORE_REGION=us-east-1
APPSEA_OBJECT_STORE_ACCESS_KEY_ID=...
APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY=...
```

APPSEA_OBJECT_STORE_SESSION_TOKEN is optional for short-lived credentials.
APPSEA_OBJECT_STORE_FORCE_PATH_STYLE=true is useful for an approved
S3-compatible gateway that does not support virtual-host bucket addressing.
APPSEA_OBJECT_STORE_ALLOW_INSECURE_LOCALHOST=true is test-only and is rejected
when NODE_ENV=production. Do not set both APPSEA_OBJECT_STORE_ROOT and the
cloud settings.

The web process, durable worker, and source-maintenance command all use the
same factory. In local development, APPSEA_OBJECT_STORE_ROOT or the web
filesystem fallback may select the filesystem adapter; a production process
must provide signed S3-compatible settings and fails closed otherwise.

## Storage boundary

Every object is content-addressed by workspace, object kind, and SHA-256
content hash. The adapter writes the body and a JSON sidecar with conditional
requests, signs every request with AWS Signature Version 4, rejects redirects,
and validates the stored length and hash before a read is returned. A replay of
the same immutable object is safe; a deleted object cannot be resurrected.

The sidecar is the deletion authority. Marking deleted uses an ETag condition,
preserves the immutable retention and deletion metadata, and is idempotent for
the same reason. Purge requires a deleted reference and either an expired
retention window or a reviewed workspace-closure/deletion authorization. Body
deletion occurs before sidecar deletion, so a crash leaves an inspectable
metadata tombstone for a later retry.

## Provider controls still required

Before production use, the deployment owner must verify provider-side
encryption, bucket versioning, private network policy, least-privilege
credentials, lifecycle/retention rules, conditional-delete behavior, backup
deletion, access logging, key rotation, and restore/failure drills. The adapter
does not claim those controls merely because a request is signed.

## Validation

- pnpm --filter @appsea/object-store typecheck
- pnpm --filter @appsea/object-store lint
- pnpm --filter @appsea/object-store test
- S3 transport tests use a deterministic fixture-backed fetch boundary and
  verify signing, workspace isolation, corruption detection, conditional
  deletion, and retention enforcement.

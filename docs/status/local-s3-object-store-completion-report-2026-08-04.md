# Local S3-compatible object-store proof

Date: 2026-08-04
Status: repository and local proof complete; hosted provider operation remains open.

## Outcome

`pnpm dev:local` now provisions PostgreSQL, Temporal, and a disposable MinIO
service, creates the `appsea-local` bucket idempotently, and configures the web
and worker through the signed S3-compatible object-store adapter. The existing
private-stack smoke therefore writes and reads production-shaped analysis,
report, and plan objects through S3 semantics without changing source
activation or the sparse synthetic public leaderboard.

## Changed surfaces

- `infra/local/compose.yaml` adds pinned MinIO and `mc` services, loopback-only
  ports, readiness health checks, and a bounded idempotent bucket initializer.
- `scripts/dev_local.mjs` selects signed local S3 settings and clears inherited
  filesystem, cloud, and remote-boundary settings before startup.
- `scripts/dev_local.test.mjs` covers environment isolation and compose wiring.
- `docs/runbooks/local-stack.md` documents credentials, reset, and boundaries.

## Security and boundary review

Development credentials are fixed, loopback-only, and never suitable for
production. The local launcher cannot reuse inherited remote object-store or
identity/delivery settings. MinIO is not production evidence for encryption,
versioning, lifecycle retention, provider IAM, HA, backups, restore, or
destructive purge/deletion.

## Validation

- `node --test scripts/dev_local.test.mjs` — 3 passing tests.
- `docker compose -f infra/local/compose.yaml config --quiet` — passed.
- `pnpm verify:local-stack` — passed; containers and network were cleaned up.
- `pnpm verify` — passed (56 lint/typecheck/test/build tasks plus fixture,
  report/plan/analysis samples, web smoke, release-boundary, and repository
  validation).
- `pnpm agents:sync`, `pnpm repo:check --docs-only`, `pnpm format:check`, and
  `pnpm memory:status` — passed; memory validation issues: 0.

## Simplifications and remaining gaps

This tranche adds only a local S3-compatible proof; it does not provision a
hosted object-storage provider, activate a public source, add calibration data,
or claim market research from fixtures or owner-import rows. Provider role
separation, encryption/versioning, lifecycle and backup deletion, HA/restore,
endpoint ownership, alert routing, source approvals, and signed desktop release
evidence remain open.

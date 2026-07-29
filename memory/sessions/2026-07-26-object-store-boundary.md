# Session handoff: object-store boundary

Date: 2026-07-26

## Outcome

Added `@appsea/object-store` as a reviewed storage seam for non-fixture report,
plan, and analysis blobs. The contract and adapters are deliberately isolated;
they do not activate a source. Migrations `0030` and `0031` plus the
production-analysis/auth repositories now persist and govern references through
this seam; cloud deployment and purge remain open.

## Behavior

- `objectReferenceSchema` binds a URI to workspace, object kind, SHA-256, size,
  content type, retention, and deletion metadata.
- `InMemoryObjectStore` provides deterministic tests.
- `FileObjectStore` provides a local/CI content-addressed blob plus metadata
  sidecar adapter with workspace-safe paths and atomic writes.
- Identical puts replay; metadata conflicts fail; deleted objects cannot be
  resurrected; reads fail after tombstoning; purge requires expiry or explicit
  deletion/closure authorization.

## Validation and limits

The object-store package has typecheck, lint, and eight passing tests; contract
tests cover active references and tombstones. Production encrypted, versioned
S3-compatible deployment, lifecycle rules, backup deletion proof, plan curation,
and cloud purge remain open. Plan-package approval/export is now covered by the
private auth repository and web routes. Docker-backed PostgreSQL proof is still
unavailable in this environment.

# ADR 0019: Keep workspace purge manifests metadata-only

- Status: accepted
- Date: 2026-08-04

## Context

Workspace archival and the owner purge-intent ledger deliberately stop before
destructive retention work. Operators still need a stable inventory of
persisted object references to reconcile cloud object-store, export, and
backup controls without exposing source/report/plan bodies or giving a web
request authority over provider deletion.

## Decision

Migration `0083_workspace_purge_manifests.sql` adds a separate, forced-RLS
ledger and security-definer create/read functions. Only an owner of an
archived workspace can prepare a manifest. The repository gathers permitted
`appsea-object://` URI/kind pairs from persisted source, report, plan, and
production-analysis references, sorts and deduplicates them, computes a
canonical SHA-256 hash, and derives a deterministic manifest ID. The database
validates workspace ownership, URI shape, kind agreement, count, uniqueness,
and expiry; the repository uses a 24-hour expiry. Replays return the existing
record and do not create another audit/outbox receipt.

The private API and members page require same-origin access, authentication,
recent password and MFA step-up, and an exact confirmation phrase. Responses
contain only the manifest metadata and URI/kind pairs. The manifest is a
coordination artifact, not a delete command or approval. Provider credentials,
object-store/export/backup deletion, manifest consumption, and a destructive
workspace purge remain separately reviewed deployment responsibilities.

## Consequences

- External operators receive a deterministic, bounded, expiring inventory with
  visible external requirements and no raw research payloads.
- Forced RLS, direct-table revocation, owner checks, and identifier-only
  receipts preserve private-workspace and provenance boundaries.
- A future provider workflow can consume the manifest only through a reviewed
  contract; this slice intentionally does not renew expired manifests or
  delete anything.

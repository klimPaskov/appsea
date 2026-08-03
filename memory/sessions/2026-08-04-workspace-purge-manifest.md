# Workspace purge manifest handoff — 2026-08-04

## Current state

Migration `0083_workspace_purge_manifests.sql`, contracts, repository methods,
private API, and owner members-page controls implement a deterministic,
24-hour, metadata-only purge manifest for archived workspaces. Object URIs are
sorted/deduplicated and validated against the workspace; no bodies, source
payloads, credentials, or delete commands are returned. Preparation and read
require owner membership; POST also requires recent password/MFA step-up and
the exact confirmation phrase.

## Evidence

- Contracts: 94 tests passed.
- Database unit suite: 138 tests passed; migration list/static assertions and
  an integration test cover archived-owner replay, read authorization, and
  identifier-only receipts (integration requires Docker/CI PostgreSQL).
- Web suite: 147 tests passed; web typecheck and affected lints passed.
- `pnpm memory:check` passed. `pnpm agents:sync` passed.

## Remaining work

Run the full repository checks and push for the fresh PostgreSQL/Temporal CI
gate. Local Docker Desktop's Linux engine is unavailable. Provider object,
export, and backup retention operations, manifest consumption, and a reviewed
destructive purge workflow remain external blockers.

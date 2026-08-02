# Production configuration preflight

Date: 2026-08-02
Status: implemented; deployment and source activation remain external gates

## Delivered

- Added `pnpm production:preflight`, a secret-free worker command that validates
  the complete production configuration shape before process startup.
- The preflight checks production mode, exact database role separation and TLS,
  maintenance scheduler ownership and bounds, authenticated Temporal settings,
  signed remote object storage, HTTPS public origin, auth delivery kill
  switches, and optional trusted-proxy secret shape.
- The command aggregates fixed failure codes, emits no raw configuration values,
  makes no network calls, runs no migration, and cannot activate a source.
- Tests cover a complete environment, enabled delivery requirements, loopback or
  insecure endpoints, role confusion, invalid flags, malformed proxy secrets,
  and non-production mode.

## Validation

- Worker lint and typecheck pass.
- Worker test suite passes (81 tests), including five preflight cases.
- Repository-wide `pnpm verify`, formatting, memory, and documentation checks
  remain the required final validation for this tranche.

## Security boundary and simplifications

The check uses fixed status names and failure codes rather than returning
exception text, so secrets and connection strings cannot enter release logs.
It validates configuration shape only; the existing web readiness endpoint is
still required to prove live PostgreSQL, Temporal, and object-store reachability.
The command deliberately does not choose a cloud provider, create roles, run a
production migration, enable recovery delivery, or approve a source policy.

## Remaining blockers

Production PostgreSQL/Temporal/object-storage provisioning, TLS and role-grant
verification, HA/backups/retention, scheduler and alert ownership, identity
provider approval, and independent legal/privacy/security approval for CFPB or
Stack Exchange remain open. Fresh Docker-backed integration is still blocked by
the unavailable Docker Desktop Linux engine in this environment.

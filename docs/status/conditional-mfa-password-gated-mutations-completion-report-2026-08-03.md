# Conditional MFA password-gated mutation completion report — 2026-08-03

Status: implemented as an AppSea-owned security slice. It does not claim
provider identity, production delivery, or production readiness.

## Delivered

- Extended the existing `0081` session-bound MFA marker check to account
  closure, revocation of another session, owner membership role/removal,
  invitation create/revoke, workspace archival, purge-intent request/cancel,
  evidence redaction, and agent-token issue/revoke.
- Kept the compatibility path for accounts without enabled MFA: the existing
  password step-up remains sufficient until enrollment activates the second
  factor.
- Kept the route boundary fail-closed and private: stale or missing second
  factor returns `428 Recent MFA verification required` before the mutation
  repository is called, without exposing MFA enrollment state or codes.
- Added ADR 0015, runbook/product/security/status updates, and route tests for
  both the password and conditional-MFA failure paths.

## Validation

- `pnpm --filter @appsea/web test`: 144 tests passed across 41 files.
- `pnpm --filter @appsea/web typecheck`: passed.
- `pnpm --filter @appsea/web lint`: passed.
- Formatting and the broader repository checks remain part of the final
  tranche gate.

## Deliberate boundaries and remaining blockers

- No database migration or new factor was introduced; the route checks reuse
  the reviewed `0081` marker and existing MFA transaction.
- Mutations that do not already require password step-up remain outside this
  slice and need a separate actor/risk contract.
- OIDC, verified identity, provider delivery/DPA, MFA key rotation, production
  secret storage, live source approval, production PostgreSQL/Temporal, cloud
  purge, and signed desktop release remain open.

This report does not present fixture data as market research and does not claim
AppSea is production-ready.

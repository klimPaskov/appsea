# Account-closure tranche (2026-07-25)

## Completed

- Added migration `packages/db/migrations/0026_account_closure.sql`.
- Added strict account-closure contracts and types in
  `packages/contracts/src/index.ts`.
- Added `PostgresAuthRepository.closeAccount`, the fixed owner-blocking error,
  and auth exports.
- Added `DELETE /api/auth/account` with same-origin, recent step-up, typed
  confirmation, rate limiting, private response headers, and cookie clearing.
- Added the account-closure panel to `/account/security`.
- Added contract, migration/static, repository, and web-route tests.
- Updated product, runbook, ADR, status, memory, and documentation index.

## Policy

Closure revokes active sessions, invalidates reset tokens, discards encrypted
reset deliveries, anonymizes profile fields, and emits `account_closed`. It
retains workspace memberships and shared research. Closure is blocked while the
account owns any workspace; transfer ownership first.

## Validation

- Contracts: 48 tests pass.
- DB: 25 tests and typecheck pass.
- Web: 26 tests and typecheck pass.
- Docker-backed PostgreSQL/Temporal gates remain blocked by the unavailable
  Docker Desktop Linux engine pipe.

## Next work

Keep production identity-provider/MFA/OIDC approval, live source activation,
deletion recomputation/object-store purge, and production DB/Temporal
provisioning open. Do not treat account closure as workspace-data deletion.

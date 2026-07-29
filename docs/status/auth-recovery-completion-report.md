# Account recovery tranche completion report

## Outcome

The repository now contains a provider-neutral password-recovery vertical
slice. It is production-shaped but deliberately not a production activation
claim: the external delivery provider, verified email/identity policy, secret
management, and deployment review remain explicit blockers.

## Implementation

- Contracts validate reset requests, single-use tokens, accepted responses,
  retention counters, and bounded delivery batches.
- Migrations `0023_auth_password_reset.sql` and
  `0024_auth_recovery_delivery_boundary.sql` add hash-only reset rows,
  encrypted-token delivery outbox rows, security events, latest-active-token
  uniqueness, bounded purge, and `SECURITY DEFINER` functions. The runtime role
  has no direct reset-row or password-hash update grant.
- `PostgresAuthRepository` queues, cheaply validates, and atomically consumes
  reset tokens; consumption updates the password and revokes sessions in the
  database function. Outbox claim/complete/fail methods are idempotent and
  bounded.
- The web routes return generic responses, apply same-origin and durable abuse
  controls, and never send or return token material. The reset page reads only
  a URL fragment and immediately removes it from history.
- The worker decrypts delivery material briefly, sends an HMAC-signed request
  with delivery ID/idempotency key, rejects redirects, and records fixed-code
  retries with secret-free counters.
- Retention reports reset-token deletion counts separately; production recovery
  is kill-switched unless explicitly enabled.

## Validation

- Contracts: 47 tests passed.
- Database package: 23 tests passed; migration catalog now covers `0024`.
- Worker: 24 tests passed, including fragment/signature/configuration and
  outbox retry tests.
- Web: 20 tests passed, including generic recovery/reset route behavior and the
  per-response reset-page CSP nonce boundary.
- TypeScript checks passed for contracts, database, worker, and web.
- `pnpm verify` passed: 52 package tasks plus fixture generation, plan-package
  generation, web smoke, and repository validation.
- `pnpm docs:check`, `pnpm memory:check`, and `pnpm repo:check --docs-only`
  passed after the final documentation and memory updates.
- `pnpm verify:persistence` and `pnpm verify:workflows` were attempted on
  2026-07-25 but could not start because the Docker Desktop Linux engine pipe
  (`//./pipe/dockerDesktopLinuxEngine`) is unavailable in this environment.
  They must be rerun on a host with Docker before migration/role/RLS completion
  can be claimed.

## Documentation and memory

The recovery runbook, security-boundary rules, private-workspace behavior,
active plan, status pages, and `docs/INDEX.md` were updated in this tranche.
Project memory and the dated session handoff were updated with the final
validation evidence.

## Remaining blockers and simplifications

- No external email gateway is activated; provider policy, DPA/retention,
  verified domain, monitoring, key rotation, and incident-drill evidence are
  required.
- Signup email verification and a complete production identity-provider/MFA
  policy are not implemented. Recovery therefore remains an explicit
  deployment approval boundary.
- The current worker is a bounded scheduler command rather than a hosted
  always-on queue service; deployment must supply scheduling, alerting, and
  crash/retry supervision.

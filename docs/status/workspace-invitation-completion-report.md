# Workspace invitation tranche completion report

## Outcome

AppSea now has a durable owner-scoped workspace-invitation slice. It is
production-shaped but not a production activation claim: delivery, verified
identity/email policy, provider retention, deployment scheduling, and security
review remain explicit gates. Invitations currently accept existing AppSea
accounts only.

## Implementation

- Contracts validate editor/viewer invitations, opaque token acceptance, read
  models, retention counters, and bounded delivery batches.
- Migration `0025_workspace_invitations.sql` adds invitation state, pending-email
  uniqueness, hash-only token storage, encrypted delivery outbox material, forced
  RLS, owner-scoped security-definer issue/revoke/accept/claim/complete/fail/purge
  functions, and identifier-only audit/outbox receipts.
- `PostgresAuthRepository` creates, lists, revokes, accepts, claims, completes,
  fails, and purges invitation material through narrow validated methods. The
  acceptance function rechecks the invited email and inviter ownership before
  inserting only editor/viewer membership.
- The worker shares the signed HMAC gateway boundary with recovery, uses
  fragment-only invitation URLs, bounded leases/retries, a stable minute-bucket
  job ID, secret-free counters, and a production kill switch.
- Private web APIs require same-origin requests, authenticated workspace
  membership, owner role, durable rate limits, and recent password step-up for
  issue/revoke. `/invite` removes the fragment from browser history and accepts
  only a signed-in existing account.

## Validation

- Contracts: 48 tests passed.
- Database: 24 package tests passed; migration catalog includes `0025`.
- Worker: 29 tests passed, including invitation signature/configuration and
  outbox retry tests.
- Web: 23 tests passed, including invitation API, kill-switch, step-up, and
  acceptance behavior.
- TypeScript and lint checks passed for database, worker, and web packages.
- `pnpm verify` passed all 52 package tasks plus fixture/plan generation, web
  smoke, formatting, and repository validation.
- Docker-backed persistence/workflow gates remain unavailable on this host and
  must be rerun before infrastructure completion is claimed.

## Simplification and remaining gates

- No new account creation or email verification is included; the identity
  policy must be approved before widening this contract.
- No external email provider is activated. DPA/retention, verified domain,
  key rotation, monitoring, and failure-drill evidence remain required.
- The worker is a bounded scheduler command; deployment must supply durable
  scheduling, supervision, alerting, and cost/accounting controls.

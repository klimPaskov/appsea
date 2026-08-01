# Workspace invitations

Workspace invitations are an owner-only, provider-neutral access workflow for
existing AppSea accounts. They are intentionally separate from the sparse
public leaderboard and do not grant a role until the recipient accepts.

## Configuration and approval

The web API and worker are disabled in production unless
`APPSEA_AUTH_INVITATIONS_ENABLED=true` is explicitly approved. The worker uses
the same reviewed HMAC gateway and encryption settings as password recovery:

- `APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY` protects the outbox copy of the opaque
  invitation token.
- `APPSEA_AUTH_RECOVERY_DELIVERY_URL` and
  `APPSEA_AUTH_RECOVERY_DELIVERY_SECRET` identify the HTTPS gateway and its
  signing key.
- `APPSEA_PUBLIC_ORIGIN` must be a fixed HTTPS origin in production.

Provider DPA/retention, verified-email/identity policy, gateway idempotency,
key rotation, monitoring, and failure-drill evidence are required before the
kill switch is enabled. The current implementation does not create accounts or
verify email ownership; it only accepts an invitation when an already signed-in
AppSea account has the invited normalized email.

## Owner workflow

1. Sign in as a workspace owner and open `/workspace/:workspaceId/members`.
2. Complete the 15-minute password step-up.
3. Enter an existing AppSea account email and choose `editor` or `viewer`.
4. The API stores a hash-only token, encrypted delivery material, expiry, and
   identifier-only audit/outbox receipts. It returns no token.
5. Revoke a pending invitation from the same page when necessary. Revocation
   discards queued delivery and is idempotent for already revoked rows.

Acceptance is at `/invite`. The token is delivered in a URL fragment, removed
from browser history immediately, and never sent to the server as a query or
referrer. The accepting account must match the invited email. The database
function locks the invitation, prevents expiry/reuse, rechecks that the inviter
remains an owner, inserts only `editor`/`viewer` membership, and records the
accepting user in audit history.

## Delivery worker

Run the bounded outbox command from a scheduler or supervised job:

```text
pnpm --filter @appsea/worker workspace:invitations
```

`APPSEA_WORKSPACE_INVITATION_DELIVERY_BATCH_SIZE` is bounded to 1–100 and
defaults to 100. PostgreSQL claims rows with skip-locked leases, skips expired
tokens, retries up to ten attempts, and exposes no delivery table directly to
the runtime role. The worker sends a signed, redirect-blocked, idempotent
gateway request with the workspace ID, role, recipient, fragment URL, and
expiry; it never logs the token, ciphertext, provider body, or exception text.
Success/failure counters use the fixed event names
`workspaceInvitationDeliveriesClaimed`, `workspaceInvitationDeliveriesSent`,
and `workspaceInvitationDeliveriesFailed`.

Migration `0046` protects the delivery pass with the same server-clock owner
lease. The lease uses the dedicated `appsea_maintenance` connection from
`APPSEA_MAINTENANCE_DATABASE_URL`, separate from the data-work connection.
Production requires a unique `APPSEA_SCHEDULER_OWNER_ID`; a contended run exits
without claiming rows and lease loss is a fixed failure code. Migration `0052`
fences claim and sent/failed state transactions with the private scheduler
identity; the gateway/provider send remains outside the PostgreSQL fence.

## Retention and incident response

`pnpm --filter @appsea/worker auth:retention` purges expired invitations and
old accepted/revoked/expired invitation rows in bounded batches, cascading
delivery material. If a provider or encryption key is compromised, disable
`APPSEA_AUTH_INVITATIONS_ENABLED`, rotate the encryption/gateway keys through
the secret manager, and review pending invitation rows before re-enabling.
The plaintext recipient email in the delivery outbox is restricted to the
worker claim boundary and must be covered by the approved retention policy.

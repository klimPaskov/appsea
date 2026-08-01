# Account recovery

AppSea account recovery is a provider-neutral, single-use password-reset
workflow. The web API never sends mail and never returns a reset token. It
validates the request, applies the durable abuse bucket, and writes a reset
record plus a delivery outbox row through
`appsea.issue_password_reset(...)`. Known and unknown addresses follow the
same accepted `202` response shape.

## Local and deployment configuration

Set these values only through a secrets manager in a deployed environment:

- `APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY`: 32-byte base64url key used to encrypt
  the one-time token in the outbox. The database stores only the token hash;
  the worker decrypts the ciphertext briefly in memory.
- `APPSEA_AUTH_RECOVERY_DELIVERY_URL`: HTTPS endpoint for the reviewed delivery
  gateway in production.
- `APPSEA_AUTH_RECOVERY_DELIVERY_SECRET`: at least 32 bytes of base64url HMAC
  key shared with that gateway.
- `APPSEA_PUBLIC_ORIGIN`: fixed HTTPS web origin in production.
- `APPSEA_AUTH_RECOVERY_ENABLED=true`: explicit production kill-switch
  approval. The default is disabled; the API returns a generic temporary
  outage until identity verification, provider processing, and deployment
  review are complete.

The optional `APPSEA_TRUSTED_PROXY_SECRET` allows an ingress to sign a bounded
client marker for rate limiting. Production ignores arbitrary
`X-Forwarded-For` values when the marker is absent and falls back to a global
bucket.

Workspace invitations use the same reviewed gateway and encryption boundary,
but have their own kill switch: set `APPSEA_AUTH_INVITATIONS_ENABLED=true` in
both the web and worker environments only after the invitation/provider review.
The default is disabled. Invitations currently target existing AppSea accounts
only; they do not create accounts or prove email ownership.

## Delivery worker

Run the bounded outbox worker from a scheduler:

```text
pnpm --filter @appsea/worker auth:recovery
```

`APPSEA_AUTH_RECOVERY_DELIVERY_BATCH_SIZE` is bounded to 1–100 (default 100).
The database claim function skips expired rows, uses row locks, a five-minute
lease, and a maximum of ten attempts. Successful sends are idempotently marked
`sent`; failures use
the fixed `APPSEA_AUTH_RECOVERY_DELIVERY_FAILED` code and become retryable
after five minutes. The worker emits counters only and never logs tokens,
passwords, provider responses, or raw exceptions.

Migration `0046` also protects the delivery pass with a server-clock lease.
The lease uses the dedicated `appsea_maintenance` connection from
`APPSEA_MAINTENANCE_DATABASE_URL`, separate from the data-work connection.
Production requires a unique `APPSEA_SCHEDULER_OWNER_ID`; development/test runs
generate an ephemeral owner. Lease contention is a no-op with a bounded
`maintenance_scheduler_lease_contended` event, while lease loss is a fixed
failure code.

The gateway request carries a delivery ID/idempotency key, timestamp, nonce,
and HMAC signature. It must reject redirects and retain no reset token beyond
its approved delivery purpose. The reset URL carries the token in a URL
fragment (`/reset-password#token=…`), is removed from browser history on page
load, and is protected by no-store/no-referrer headers plus a per-response CSP
nonce middleware policy. The nonce keeps required Next.js hydration scripts
working while denying untrusted inline or external scripts. A fragment is not
sent in HTTP requests or referrer headers.

## Retention and incident handling

`pnpm --filter @appsea/worker auth:retention` calls the security-definer purge
function for expired, consumed, and invalidated reset tokens, delivery rows,
security events, sessions, rate-limit buckets, and expired/old workspace
invitations in bounded batches. It emits `passwordResetTokensDeleted` and
`workspaceInvitationsDeleted` separately from session counts. Rotate the
encryption and delivery keys through the deployment secret manager; revoke the
old provider key before re-enabling delivery after a compromise.

Recovery remains a production blocker until a reviewed email/identity policy,
gateway DPA/retention terms, verified-domain configuration, monitoring, and
failure-drill evidence are attached to the deployment change.

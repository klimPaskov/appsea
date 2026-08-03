# Optional OIDC identity boundary

AppSea supports an optional, provider-neutral OpenID Connect login boundary.
It is disabled unless `APPSEA_AUTH_OIDC_ENABLED=true`. The repository does not
choose a provider, provision a tenant, or activate external identity
operations on its own.

## Safety contract

- A provider identity is keyed by the exact normalized `(issuer, subject)`
  pair. Email equality never links two accounts.
- Linking is available only to an existing password account after recent
  password reauthentication and, when enabled, a fresh AppSea MFA step-up.
- The callback requires a matching HttpOnly state cookie, a nonce, PKCE
  `S256`, an exact configured redirect URI, a discovery issuer match, an
  `RS256` signature from the provider JWKS, an audience match, a fresh expiry,
  and `email_verified=true`.
- A successful provider callback can sign in only an already linked identity.
  It never creates an account or links by email. Accounts with AppSea MFA
  receive a short-lived HttpOnly challenge cookie and must complete the local
  second factor before a session is issued; the database binds the linked
  identity to that challenge so sign-in telemetry is emitted only after the
  session is created.
- Provider subjects and ID-token claims do not appear in read models, logs,
  browser URLs, reports, workspace data, or repository memory. Account closure
  removes linked identities while retaining shared research as documented in
  [`account-closure.md`](account-closure.md).
- A linked identity is retained for the lifetime of an active account unless
  the user unlinks it; there is no silent inactivity purge. The provider
  retention/DPA review must approve that account-lifetime rule and define any
  provider-side revocation or deletion notice handling.
- Unlinking is a same-origin, password/MFA-step-up-protected operation. The
  identity table and security events are global authentication rows, outside
  workspace RLS.

## Deployment configuration

Local development may use a loopback HTTPS-capable test provider (or a
loopback HTTP fixture only in development). Production preflight requires all
of the following before an enabled provider can start:

```text
APPSEA_AUTH_OIDC_ENABLED=true
APPSEA_AUTH_OIDC_ISSUER=https://id.example.invalid
APPSEA_AUTH_OIDC_REDIRECT_URI=https://appsea.example.invalid/api/auth/oidc/callback
APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS=https://id.example.invalid
APPSEA_AUTH_OIDC_CLIENT_ID=...
APPSEA_AUTH_OIDC_CLIENT_SECRET=...
APPSEA_AUTH_OIDC_REVIEWED=true
APPSEA_AUTH_OIDC_ACCOUNT_LINKING=explicit
```

`APPSEA_AUTH_OIDC_REVIEWED=true` is an operator attestation, not proof of
provider approval. The identity, privacy, retention, delivery/DPA, incident,
key-rotation, and provider availability reviews must be recorded outside the
repository before the switch is enabled. Keep the client secret in the
deployment secret manager; never put it in source, fixtures, or logs. Discovery
authorization, token, and JWKS endpoints must resolve to the issuer origin or
an explicitly reviewed origin in `APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS`; paths,
queries, fragments, literal private/loopback/mapped/unspecified/multicast
hosts, and more than eight origins are rejected. In production, each metadata,
token, and JWKS request also resolves every returned address and fails closed if
any answer is private, loopback, link-local, multicast, or otherwise unsafe.
The provider metadata and response body reads are bounded and have a 10-second
request timeout, but deployment egress/DNS pinning must still prevent a
time-of-check/time-of-use rebinding race.

## Browser flow

1. The login page starts `GET /api/auth/oidc/start?mode=login` only when the
   reviewed provider is configured. The server performs discovery, creates a
   random state/nonce/verifier, stores the state in a short-lived HttpOnly
   cookie, and redirects to the provider.
2. The provider returns to `GET /api/auth/oidc/callback`. AppSea clears the
   state cookie on every exit path, exchanges the code with the configured
   client credentials, fetches JWKS without following redirects, and verifies
   the ID token.
3. Login looks up the verified issuer/subject pair. A missing link returns a
   generic sign-in message instructing the user to link it from account
   security after password sign-in.
4. Account security starts linking with a same-origin `POST
/api/auth/oidc/start` after the password/MFA step-up. It lists only a bounded provider label, host, verified email,
   and timestamps. It does not expose the provider subject or token.

## Validation and remaining operations

The provider/config verifier is covered by `apps/web/src/server/oidc.test.ts`,
route state/redirect tests by `apps/web/src/app/oidc-routes.test.ts`, MFA
cookie handoff by `apps/web/src/app/mfa-routes.test.ts`, repository authorization
and identity-view tests by `packages/db/src/auth-repository.test.ts`, and the
production DNS safety helper by the same OIDC test file, and the deployment gate
by `apps/worker/src/production-preflight.test.ts`. Fresh
PostgreSQL migration execution remains a deployment/CI check when the local
Docker engine is unavailable.

This boundary does not claim a live provider, verified production identity
policy, delivery/DPA approval, provider-backed step-up for mutations outside
the password-gated set, provider key rotation, or incident routing. Those are
release gates and remain visible in the production readiness status.

# ADR 0014: Require MFA step-up for agent bearer mutations

- Status: accepted
- Date: 2026-08-03

## Context

AppSea's read-only MCP boundary issues workspace-scoped bearer tokens. The
existing route required a recent password step-up, while account TOTP MFA was
used only during login and enrollment. A stolen authenticated browser session
could therefore issue or revoke an agent credential during the password
step-up window without presenting the enrolled second factor.

## Decision

When an account has MFA enabled, issuing or revoking an agent access token must
require both:

1. the existing fifteen-minute password reauthentication marker; and
2. a separate fifteen-minute MFA marker on the same authenticated session.

`POST /api/auth/mfa/step-up` consumes a current TOTP or one unused recovery
code, then writes only `auth_sessions.last_mfa_reauthenticated_at`. Migration
`0081_auth_mfa_step_up.sql` grants the runtime role only the reviewed update
column. Accounts without enabled MFA retain the password-only compatibility
path until they enroll a second factor.

## Security properties

- MFA codes are validated, replay-checked, and consumed inside one database
  transaction with the session and MFA row locked.
- Recovery codes remain hash-only and one-time; no code, marker, or raw bearer
  token is returned to the agent-token repository or a read model.
- The step-up endpoint is same-origin, schema-validated, private, no-store,
  and rate-limited through the existing MFA bucket.
- Token issue/revoke routes enforce the second marker server-side; UI state is
  not an authorization grant.
- The marker is bounded by the existing fifteen-minute reauthentication window
  and is cleared with the session through normal revocation/retention.

## Deliberate boundary

This ADR covers AppSea-owned agent-token issue/revoke mutations. It does not
claim OIDC, verified email identity, provider-backed step-up, key rotation,
delivery approval, or production identity operations. Other high-risk actions
continue to use their existing reviewed password step-up until a separate
boundary is implemented.

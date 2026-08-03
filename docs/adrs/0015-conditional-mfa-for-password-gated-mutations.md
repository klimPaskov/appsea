# ADR 0015: Extend conditional MFA to password-gated mutations

- Status: accepted
- Date: 2026-08-03

## Context

AppSea already used a fifteen-minute password step-up for account, workspace,
session, invitation, and evidence-redaction mutations. Migration `0081` added a
session-bound MFA marker for agent-token issue/revoke, but leaving the other
password-gated mutations on password proof alone made the security boundary
inconsistent for accounts that had enrolled MFA.

## Decision

When an account has enabled AppSea TOTP MFA, every mutation that already
requires the recent password marker must also require a recent
`last_mfa_reauthenticated_at` marker. The protected set is:

- account closure and revocation of another authentication session
- owner membership role/removal and invitation create/revoke
- workspace archival and purge-intent request/cancel
- evidence redaction
- owner agent-token issue/revoke

The existing same-origin `POST /api/auth/mfa/step-up` endpoint remains the only
way to establish the marker. Accounts without enabled MFA retain the reviewed
password-only compatibility path. Mutations that do not currently require
password step-up remain outside this decision until a separate reviewed
boundary defines their actor, risk, and reauthentication contract.

## Security properties

- Both markers are checked server-side immediately before the mutation
  repository is called; UI state cannot authorize a mutation.
- MFA codes are validated and replay-consumed inside the existing locked
  database transaction; no code or marker enters a read model, audit payload, or
  imported content path.
- A missing or stale marker returns the private `428 Recent MFA verification
required` response without revealing whether an account has MFA enabled.
- The database migration and session retention boundary remain unchanged; the
  marker is session-bound and expires with the password step-up window.

## Deliberate boundary

This is an AppSea-owned conditional factor, not OIDC, verified identity,
provider-backed delivery, provider step-up, or key rotation. Production identity
operations and high-impact mutations without a password-step-up boundary still
require independent review and deployment evidence.

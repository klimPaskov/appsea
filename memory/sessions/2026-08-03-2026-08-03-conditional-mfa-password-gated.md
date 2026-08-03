# AppSea session handoff — conditional MFA password-gated mutations

- Date: 2026-08-03
- Scope: extend migration `0081`'s session-bound MFA marker from agent-token
  issue/revoke to every mutation that already requires recent password
  step-up: account closure, session revocation, member role/removal,
  invitation create/revoke, workspace archival, purge-intent request/cancel,
  and evidence redaction.
- Code: the eight web route boundaries check both markers before invoking the
  mutation repository and return the existing private `428` MFA response;
  accounts without enabled MFA retain the password-only compatibility path.
- Tests: web tests 144 passed across 41 files; web typecheck and lint passed.
  Route tests cover both stale-password and stale-MFA failures and ensure the
  mutation repository is not called on a missing second factor.
- Docs: ADR 0015, MFA runbook, security boundary, private-workspace product
  rules, active plan, current/known-gap/audit status, and project memory were
  aligned. No new migration or skill was needed.
- Next: run full repository verification, complete the guidance checkpoint,
  commit/push, and verify GitHub CI. Keep provider identity, source approval,
  production infrastructure, cloud purge, and desktop release blockers
  explicit; do not claim production readiness.

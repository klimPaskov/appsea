# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture is the complete persisted path; approved collection is separate/non-synthetic. Leaderboard only.
- Fixture/collection tested; fresh PostgreSQL/Temporal CI-proven. Local/CI
  worker replacement covers persistence loss, one-time row, and sanitized
  history; backup/restore covers schema/roles, while hosted
  restore/crash drill and cloud/backup purge remain pending.
- `CfpbConnector` is disabled pending legal/privacy/security approval;
  `StackExchangeConnector` is a disabled candidate for competitor/contrary
  research. `manual-owner-import-v1` is the only active non-fixture path and
  accepts owner-attested tenant-private CSV/JSON; it never fetches URLs or
  establishes public coverage.
- Web auth uses scrypt/revocable sessions, membership/RLS, step-up, TOTP MFA, and disabled-by-default OIDC with closure/retention boundaries; provider approval/delivery, identity retention/revocation, DNS/egress, provider-backed step-up, deployment review, and non-password-gated mutations remain open.
- Production collection persists policy-bound evidence, complaints, gaps, cost, and lineage; private reads use `/workspace/:workspaceId/research/:runId`; outputs use filesystem/S3.
- Analysis v2 carries IDs/digests; the worker rebuilds artifacts in-activity. Legacy v1 drain, cloud/backup purge, role rotation, and scheduler ownership remain open. Collection writes lock leases; `0037` recovers stale dispatches.
- Auth, quotas, retention, admissions, purge, tombstones, scheduler metrics, and
  campaign refresh are durable; `maintenance:loop` is signal-safe. Owner purge
  remains `awaiting_external_controls`; no destructive operation is wired.
- Web/worker share fail-closed Temporal config; production requires TLS/API-key/namespace/CA. Maintenance uses `0046`/`0052`; source commands use `0051`; alerting, role rotation, recovery, and proof remain open.
- Runtime skill registry is dormant: independent proposer/evaluator/approver,
  signed review/transition evidence; no worker import/activation, and
  persistence/audit/policy-specific activation remain open.
- Read-only MCP tokens recheck workspace membership and use PostgreSQL
  60-per-60-second windows, four in-flight leases, and 30-second stale recovery;
  edge limits, secret storage, and hosted monitoring remain open. `0098` adds
  the audit index; its cursor read is RLS-bound and scalar-only.

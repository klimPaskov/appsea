# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture is the complete persisted path; approved collection is separate/non-synthetic. Leaderboard only.
- PostgreSQL/RLS: `packages/db`; Temporal: `packages/workflows` and `apps/worker`.
- Fixture/collection workflows are package-tested; Temporal/Docker proof and cloud/backup purge remain pending. `0043` queues output purge; `0044` retries tombstones.
- `CfpbConnector` is disabled pending legal/privacy/security approval; `StackExchangeConnector` is a disabled candidate for competitor/contrary research; no real source is active.
- Web auth uses scrypt, revocable sessions, membership-before-RLS, and step-up; TOTP MFA uses encrypted secrets, hash recovery codes, expiring challenges, and migration `0081` session markers for password-gated high-risk mutations. Recovery/delivery, OIDC/provider identity, key rotation, provider-backed step-up, and mutations without a password-step-up boundary remain open.
- Production collection persists policy-bound evidence, complaints, tombstones, gaps, cost, and lineage; private reads: `/workspace/:workspaceId/research/:runId`; outputs use filesystem/S3.
- `0067` adds step-up owner/editor redaction receipts and masks; provenance, hashes, snapshots, raw deletion, and cloud/backup purge remain separate.
- Analysis v2 carries IDs/digests; the worker rebuilds artifacts in-activity. Private reads carry approval state; legacy v1 drain, cloud/backup purge, role rotation, and scheduler ownership remain open. Collection writes lock leases; `0037` recovers stale dispatches.
- Auth, quotas, retention, admissions, purge, tombstones, scheduler metrics,
  and campaign refresh are durable; `maintenance:loop` is bounded/signal-safe.
  Owner purge requests remain `awaiting_external_controls`; no destructive
  operation is wired. Deployment ownership/alerting and cloud/backup remain
  open.
- Migrations `0083`-`0085` add the archived-owner metadata-only purge manifest, PostgreSQL 18 archival repair, and read-only read-function repair; it is private/idempotent and never authorizes deletion.
- Re-collection is explicit: matching tombstone, `limit: 1`, exact lookup,
  immutable lineage, no automatic retry/refetch.
- Web/worker share fail-closed Temporal config; production requires TLS/API-key/namespace/CA. Maintenance uses `0046` leases/`0052` fencing; direct source commands use `0051`; deployment alerting, role rotation, recovery, and proof remain open.

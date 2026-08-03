# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture is the complete persisted path; approved collection is separate/non-synthetic. Leaderboard only.
- PostgreSQL/RLS: `packages/db`; Temporal: `packages/workflows` and `apps/worker`.
- Fixture/collection workflows are package-tested; Temporal/Docker proof and cloud/backup purge remain pending. `0043` queues output purge; `0044` retries tombstones.
- `CfpbConnector` is disabled pending legal/privacy/security approval; `StackExchangeConnector` is a disabled candidate for competitor/contrary research; no real source is active.
- Web auth uses scrypt, revocable sessions, membership-before-RLS, and step-up; TOTP MFA uses encrypted secrets, hash recovery codes, and expiring challenges. Recovery/delivery, OIDC/provider identity, key rotation, and high-risk token enforcement remain open.
- Production collection persists policy-bound evidence, complaints, tombstones, gaps, cost, and lineage; private reads: `/workspace/:workspaceId/research/:runId`; outputs use filesystem/S3.
- `0067` adds step-up owner/editor redaction receipts and masks; provenance, hashes, snapshots, raw deletion, and cloud/backup purge remain separate.
- Analysis v2 carries IDs/digests; the worker rebuilds artifacts in-activity. Private reads carry approval state; legacy v1 drain, cloud/backup purge, role rotation, and scheduler ownership remain open. Collection writes lock leases; `0037` recovers stale dispatches.
- Auth, quotas, retention, admissions, purge, tombstones, scheduler metrics, and campaign refresh are durable; initialization fails closed without a reservation; `maintenance:loop` is bounded and signal-safe. Owner purge requests persist an `awaiting_external_controls` handoff after the database gate; no destructive operation is wired. Deployment ownership/alerting and cloud/backup remain open.
- Health probes fail closed; worker heartbeat is 30s, secret-free.
- Re-collection is explicit only: a completed matching tombstone, `limit: 1`, exact source-native lookup, immutable lineage, and no automatic retry/refetch.
- Web/worker share fail-closed Temporal config; production requires TLS/API-key/namespace/CA. Maintenance uses `0046` leases/`0052` fencing; direct source commands use `0051`; deployment alerting, role rotation, recovery, and proof remain open.

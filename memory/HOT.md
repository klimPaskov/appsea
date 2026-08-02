# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture mode is the complete persisted path; approved collection stores non-synthetic evidence separately. Leaderboard is leaderboard-only.
- PostgreSQL/RLS: `packages/db`; Temporal: `packages/workflows` and `apps/worker`.
- Fixture/collection workflows are package-tested local/CI only; Temporal deployment/Docker proof and cloud/backup purge remain pending. `0043` queues output purge; `0044` retries tombstones.
- `CfpbConnector` is typed and quota/deletion-aware but disabled pending legal/privacy/security approval; `0027` records operator-only policy evidence.
- Web research uses scrypt credentials, revocable sessions, membership-before-RLS, owner mutations, and 15-minute step-up; invitation/recovery delivery is kill-switched; MFA/OIDC remain open.
- Production collection persists policy-bound evidence, complaints, tombstones, gaps, cost, and lineage; private reads: `/workspace/:workspaceId/research/:runId`; outputs use filesystem/S3.
- Migrations `0033`-`0059` add seed/admission/deletion, analysis, policy, campaign-refresh, and competitor-observation provenance; CFPB disabled.
- Analysis v2 carries IDs/digests; worker rebuilds artifacts in the activity. Private reads carry report/plan approval state. Legacy v1 drain, cloud/backup purge, role rotation, and scheduler ownership remain open; `0045` admits private reconciliation. Collection writes lock leases through commit; `0037` recovers stale dispatches.
- Auth throttles, sessions, quotas, retention, admissions, purge, tombstones, scheduler metrics, and policy-gated campaign refresh dispatch are durable; initialization fails closed without a reservation; workspace enumeration is forced-RLS fail-closed. `maintenance:loop` supervises one lease-backed pass with bounded backoff and signal-safe shutdown; deployed ownership/alerting, cloud/backup, and purge remain open.
- Health probes fail closed on DB/Temporal/object-store; worker heartbeat is 30s and secret-free.
- Re-collection is explicit only: a completed matching tombstone, `limit: 1`, exact source-native lookup, immutable lineage, and no automatic retry/refetch.
- Web/worker share fail-closed Temporal config; production requires TLS/API-key/namespace/CA. Maintenance uses `0046` leases plus `0052` fencing; direct source commands use `0051`; deployment alerting, role rotation, external recovery, and proof remain open.

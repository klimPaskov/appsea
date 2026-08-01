# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture mode is the complete persisted path; approved collection stores non-synthetic evidence separately. Leaderboard is leaderboard-only.
- PostgreSQL/RLS: `packages/db`; Temporal: `packages/workflows` and `apps/worker`.
- Fixture/collection workflows are package-tested local/CI only; Temporal TLS/HA/deployment/Docker proof and cloud/backup purge remain pending. `0043` queues invalidated output purge; `0044` retries tombstone propagation.
- `CfpbConnector` is typed and quota/deletion-aware but disabled pending legal/privacy/security approval; `0027` records operator-only policy evidence.
- Web research uses scrypt credentials, revocable sessions, membership-before-RLS, owner mutations, and 15-minute step-up; invitation/recovery delivery is kill-switched; MFA/OIDC remain open.
- Production collection persists policy-bound evidence, complaints, tombstones, gaps, cost, and lineage; private reads: `/workspace/:workspaceId/research/:runId`; outputs use filesystem/S3.
- Migrations `0033`-`0045` add approved seeds/handoff, deletion repair, leases/checkpoints, separate collection/analysis/reconciliation admissions, worker-principal admission, and retryable tombstones; no source is enabled.
- Analysis v2 carries workspace/collection/analysis/seed IDs and digests; worker rebuilds artifacts in the activity. Legacy v1 drain, cloud/backup purge, service-role/secret rotation, and scheduler ownership remain open; `0045` admits private editor reconciliation and requires `appsea-worker`. Collection writes lock leases through commit; `0037` recovers stale dispatches.
- Reports/plans use role-checked review/approval gates and approved JSON exports.
- Auth throttles, sessions, quotas, retention, admissions, lease purge, bounded resume, tombstones, and invalidated-output purge are durable; initialization fails closed without a reservation; workspace enumeration is forced-RLS fail-closed. Scheduler/alerts, cloud/backup, and closure/export deletion remain open.
- Health probes fail closed on DB/Temporal/object-store; worker heartbeat is 30s and secret-free.
- Web and durable worker share fail-closed Temporal config; production requires TLS/API-key/namespace/CA; local fixtures are loopback-only.

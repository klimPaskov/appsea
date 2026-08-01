# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture mode is the complete persisted opportunity path; approved collection stores non-synthetic evidence separately. The leaderboard contains the leaderboard only.
- PostgreSQL/RLS live in `packages/db`; Temporal lives in `packages/workflows` and `apps/worker`.
- Fixture/collection workflows are package-tested locally/CI-only; Temporal TLS/HA/deployment/Docker proof and cloud/backup purge remain pending. Migration `0043` queues invalidated output objects for local retention purge; `0044` adds retryable tombstone propagation.
- `CfpbConnector` is typed and quota/deletion-aware but disabled pending legal/privacy/security approval; migration `0027` records operator-only policy evidence.
- Web research uses scrypt credentials, revocable sessions, membership-before-RLS, owner mutations, and 15-minute step-up; invitation/recovery delivery is kill-switched and MFA/OIDC remain open.
- Production collection persists approved-policy CFPB items, redacted evidence, complaints, tombstones, gaps, settled source cost, and audit/outbox lineage; private reads live at `/workspace/:workspaceId/research/:runId`.
- Migrations `0033`–`0045` add approved seeds/handoff, deletion repair, source leases/snapshot checkpoints, separate collection/analysis/source-reconciliation admissions, explicit worker-principal source service admission, and retryable tombstone propagation; no source is enabled.
- Analysis v2 carries only workspace/collection/analysis/seed identifiers and digests; the worker rebuilds artifacts inside the activity. Legacy v1 drain, cloud/backup purge, deployed service-role/secret rotation, and scheduler ownership remain open; migration `0045` admits private editor source-reconciliation requests and requires `appsea-worker` for the direct service command. Collection writes lock their lease through commit. Migration `0037` recomputation claims recover server-clock-stale dispatches with bounded terminal failure. `0043` provides the bounded output queue.
- Reports/plans use role-checked review/approval gates and only approved JSON exports.
- Auth throttles, sessions, quotas, retention, admissions, lease purge, bounded snapshot resume, tombstones, and invalidated output purge are durable; initialization fails closed without a reservation; workspace enumeration is forced-RLS fail-closed. Scheduler/alerts, cloud/backup, and closure/export deletion remain open.

# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture mode is complete persisted opportunity path; approved collection stores non-synthetic evidence separately.
- Leaderboard contains leaderboard only.
- PostgreSQL/RLS live in `packages/db`; Temporal lives in `packages/workflows` and `apps/worker`.
- Fixture/collection workflows are package-tested locally/CI-only; Temporal TLS/HA/deployment/Docker proof and cloud/backup purge remain pending. Migration `0043` queues invalidated output objects for local retention purge.
- `CfpbConnector` is typed and quota/deletion-aware but disabled pending legal/privacy/security approval; migration 0027 records operator-only policy evidence.
- Web research uses scrypt credentials, revocable sessions, membership-before-RLS, owner mutations, and 15-minute step-up; invitation/recovery delivery is kill-switched and MFA/OIDC remain open.
- Production collection persists approved-policy CFPB items, redacted evidence, complaints, tombstones, gaps, and audit/outbox lineage; private reads live at `/workspace/:workspaceId/research/:runId`.
- Migration `0032` adds editor/owner complaint curation with guarded review states and identifier-only actions. Only confirmed observations enter reviewed analysis.
- Migrations `0033`–`0042` add approved seeds/handoff, deletion repair, source leases/snapshot checkpoints, and separate collection/analysis admissions; no source is enabled.
- Analysis v2 carries only workspace/collection/analysis/seed identifiers and digests; the worker rebuilds artifacts inside the activity. Legacy v1 drain, cloud/backup purge, tombstone retries, and direct CLI admission remain open; collection writes lock their lease through commit. Migration `0037` recomputation claims recover server-clock-stale dispatches with bounded terminal failure. `0043` provides the bounded output queue.
- Reports/plans use role-checked review/approval gates and only approved JSON exports.
- Auth throttles, sessions, quotas, retention, admissions, lease purge, snapshot resume, tombstones, and invalidated output purge are durable; initialization fails closed without a reservation; workspace enumeration is forced-RLS fail-closed. Scheduler/alerts, cloud/backup, and closure/export deletion remain open.

# Hot memory

- Start broad work with repository instructions, memory, and `docs/INDEX.md`.
- Fixture mode is the only complete persisted opportunity path; approved collection stores non-synthetic evidence separately.
- The leaderboard page contains the leaderboard only.
- PostgreSQL/RLS live in `packages/db`; Temporal orchestration/workers live in `packages/workflows` and `apps/worker`.
- Fixture/collection workflows are package-tested locally/CI-only; Temporal TLS/HA/deployment/Docker proof and object/backup purge remain pending.
- `CfpbConnector` is typed and quota/deletion-aware but disabled pending legal/privacy/security approval; migration 0027 records operator-only policy evidence.
- Private web research uses scrypt credentials, revocable sessions, membership-before-RLS, owner mutations, and 15-minute step-up; invitation/recovery delivery is kill-switched and MFA/OIDC remain open.
- Production collection persists approved-policy CFPB items, redacted evidence, complaints, tombstones, gaps, and audit/outbox lineage idempotently; private reads live at `/workspace/:workspaceId/research/:runId`.
- Migration `0032` adds editor/owner complaint curation with guarded review states and identifier-only actions. Only confirmed observations enter reviewed analysis.
- Migrations `0033`/`0034` add approved seeds/handoff; `0035` invalidates stale opportunities, `0036` protects reactivation, `0037` queues repair, `0038` gates production starts, `0039` adds a policy-bound source lease with stable capture time, `0040`/`0041` add identifier-only snapshot jobs with warning-bearing page checkpoints and atomic tombstone finalization, and `0042` gates manual analysis starts with an immutable actor and digest-only admission.
- Analysis v2 carries only workspace/collection/analysis/seed identifiers and digests; the worker rebuilds artifacts inside the activity. Legacy v1 drain, object purge, stale claims, tombstone retries, and direct CLI admission remain open; collection writes lock their lease through commit.
- Reports/plans use role-checked review/approval gates and only approved JSON exports.
- Auth throttles, sessions, quotas, retention, collection/analysis admission and lease purge, snapshot resume, and tombstone propagation are durable; collection and user-analysis initialization fail closed without a consumed reservation; workspace enumeration remains forced-RLS fail-closed. Deployed scheduler/alerts and object/backup purge remain open.

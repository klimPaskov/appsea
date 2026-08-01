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
- Migrations `0033`/`0034` add approved seeds/handoff; `0035` invalidates stale opportunities, `0036` protects reactivation, `0037` queues repair, `0038` gates production starts, `0039` adds a policy-bound source lease with stable capture time, `0040`/`0041` add identifier-only snapshot jobs with warning-bearing page checkpoints and atomic tombstone finalization, and `0042` gates manual analysis starts with an immutable actor and digest-only admission.
- Analysis v2 carries only workspace/collection/analysis/seed identifiers and digests; the worker rebuilds artifacts inside the activity. Legacy v1 drain, cloud/backup purge, stale claims, tombstone retries, and direct CLI admission remain open; collection writes lock their lease through commit. `0043` provides the bounded output queue.
- Reports/plans use role-checked review/approval gates and only approved JSON exports.
- Auth throttles, sessions, quotas, retention, admissions, lease purge, snapshot resume, tombstones, and invalidated output purge are durable; initialization fails closed without a reservation; workspace enumeration is forced-RLS fail-closed. Scheduler/alerts, cloud/backup, and closure/export deletion remain open.

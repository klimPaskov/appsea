# Hot memory

- Start broad work with repository instructions, memory, and `docs/INDEX.md`.
- Fixture mode is the only complete persisted opportunity path; approved collection stores non-synthetic evidence separately.
- The leaderboard page contains the leaderboard only.
- PostgreSQL/RLS live in `packages/db`; Temporal orchestration/workers live in `packages/workflows` and `apps/worker`.
- Fixture/collection workflows are package-tested locally/CI-only; Temporal TLS/HA/deployment/Docker proof and object/backup purge remain pending.
- `CfpbConnector` is a typed, quota/deletion-aware boundary but remains disabled pending legal/privacy/security approval. Migration 0027 records operator-only policy draft/approval evidence; no live source is enabled.
- Private web research uses scrypt credentials, revocable sessions, membership-before-RLS, owner mutations, and 15-minute step-up; invitation/recovery delivery is kill-switched and MFA/OIDC remain open.
- Production collection persists approved-policy CFPB items, redacted evidence, complaints, tombstones, gaps, and audit/outbox lineage idempotently; private reads live at `/workspace/:workspaceId/research/:runId`.
- Migration `0032` adds editor/owner complaint curation with guarded review states and identifier-only actions. Only confirmed observations enter reviewed analysis.
- Migrations `0033`/`0034` add approved seeds/handoff; `0035` invalidates stale opportunities, `0036` protects reactivation, `0037` queues repair, `0038` gates production starts, and `0039` adds a policy-bound source lease with stable capture time.
- Analysis workflow v2 carries only workspace/collection/analysis/seed identifiers and digests; the worker rebuilds the artifact inside the activity using server time for retention. Legacy v1 drain/retention, object purge races, lease atomicity, stale recompute claims, tombstone retries, and direct CLI admission remain open.
- Reports use migration 0022 `draft` → `reviewed` → `approved`/`withdrawn`; plans use migration 0031 `unreviewed` → `reviewed` → `approved`/`withdrawn`. Editors review, owners approve/withdraw, and only approved JSON exports.
- Auth throttles, sessions, quotas, retention, admission/lease purge, and tombstone propagation are durable; collection initialization fails closed without a consumed reservation; workspace enumeration remains forced-RLS fail-closed. Scheduler/alerts and object/backup purge remain open.
- Skills `.agents/skills`; agents `.codex/agents`.

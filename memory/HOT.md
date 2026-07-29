# Hot memory

- Start broad work with repository instructions, memory, and `docs/INDEX.md`.
- Fixture mode is the only complete persisted opportunity path; approved collection stores non-synthetic evidence separately, while test-only analysis composes clusters, score, report, and plan.
- The leaderboard page contains the leaderboard only.
- PostgreSQL/RLS live in `packages/db`; Temporal orchestration/workers live in `packages/workflows` and `apps/worker`.
- Fixture and collection workflows are package-tested locally/CI-only. Temporal TLS/authentication, HA, backups, deployment, and Docker proof are pending; retention enqueue is durable, while object/backup purge remains open.
- `CfpbConnector` is a typed, quota/deletion-aware boundary but remains disabled pending legal/privacy/security approval. Migration 0027 records operator-only policy draft/approval evidence; no live source is enabled.
- Private web research uses scrypt credentials, revocable sessions, membership-before-RLS, owner mutations, and a 15-minute step-up; the public leaderboard remains DB-free fixture data. Invitation/recovery delivery is kill-switched pending identity review; MFA/OIDC remain open.
- Production collection persists approved-policy CFPB items, redacted evidence, complaints, tombstones, gaps, and audit/outbox lineage idempotently. Migrations `0028`/`0029` add policy-gated jobs/checkpoints and retention enqueue; private reads live at `/workspace/:workspaceId/research/:runId`.
- Migration `0032` adds editor/owner complaint curation: active observations use guarded `unreviewed`/`confirmed`/`rejected` transitions and identifier-only page actions. Only confirmed observations may enter reviewed analysis; recomputation is open.
- Migrations `0033`/`0034` add immutable approved seed reviews and a durable seed-bound post-collection analysis handoff; `0035` invalidates stale opportunity projections after source deletion. Manual analysis remains available.
- Reports use migration 0022 `draft` → `reviewed` → `approved`/`withdrawn`; plans use migration 0031 `unreviewed` → `reviewed` → `approved`/`withdrawn`. Editors review, owners approve/withdraw, and only approved JSON exports.
- Auth throttles, sessions, quotas, retention enqueue, owner maintenance, and tombstone propagation are durable; workspace enumeration remains forced-RLS fail-closed. Scheduler/alerts, recomputation, and object/backup purge remain open.
- Skills `.agents/skills`; agents `.codex/agents`.

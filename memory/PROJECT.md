# Stable project facts

## Product

AppSea is an opportunity intelligence system for software products. It turns permitted complaint evidence into problem clusters, competitor research, ranked opportunities, and coding-agent planning packages.

## Architecture

- TypeScript monorepo managed by pnpm and Turborepo.
- Next.js website is the first interface.
- Shared schemas use Zod.
- Processing logic is split into focused workspace packages.
- Worker entry points execute fixture research and plan generation.
- A future Tauri shell will reuse the website contract.
- `packages/db` owns PostgreSQL 18 migrations, transaction-scoped workspace RLS, and persistence repositories.
- Local and CI PostgreSQL use a no-login owner, separate migrator, and non-owner runtime role. Production provisioning remains external and unimplemented.
- `packages/workflows` owns deterministic Temporal orchestration and client hashing; `apps/worker` owns activity adapters and local worker startup; `packages/db` owns RLS-protected fixture and production-collection job projections and checkpoints. Production workflow security, HA, object-store/backups purge, deployment, and Docker-backed integration proof remain external.
- The post-collection production analysis workflow is `production-analysis-v2`: Temporal carries only identifiers and immutable digests, and `apps/worker` reconstructs the reviewed artifact from workspace-bound rows inside the persistence activity. Legacy v1 histories require a controlled deployment drain/retention plan.
- `packages/db` migrations 0008-0039 own users, hashed sessions, a short-lived password step-up marker, workspace memberships, owner-scoped membership administration and existing-account invitations, durable authentication rate limits, bounded session retention, hash-only single-use password-reset/invitation tokens, encrypted recovery/invitation delivery outboxes/security events, owner-safe account closure, shared source quota reservations, policy-derived retention tombstone enqueue, deletion tombstone projections, monotonic source/evidence/report/plan/tombstone guards, role-checked report approval transitions, a policy-bound source collection lease with stable observed timestamps and same-transaction persistence locking, an owner-scoped maintenance workspace enumerator, immutable fixture and production workflow actor attribution, direct workflow workspace/source-policy gates, private opportunity/evidence/report/plan/collection read models, and operator-only immutable source-policy review evidence. The web boundary keeps only an HttpOnly session cookie and authorizes membership before the RLS context. Account security exposes only identifier/timestamp session summaries; per-session revocation and account closure require recent password step-up, and closure cannot proceed while the user owns a workspace. Recovery and invitation delivery are provider/identity-review kill-switched; closure retains shared workspace data by design.
- `packages/reports` owns the deterministic fixture opportunity report contract and composer; fixture persistence stores its content-hashed report version and links the plan package. Private report reads keep evidence, inference, recommendation, contrary evidence, and source coverage separate.
- `apps/worker` maintenance commands use `packages/contracts`-validated pure runners with bounded counters, sorted workspace enumeration, independent quota expiry/purge budgets, and scheduler correlation IDs; PostgreSQL idempotency remains the rerun boundary and production scheduling is external.
- Migration `0046` adds a global PostgreSQL server-clock lease for those maintenance and delivery commands. Migration `0047` adds maintenance-role-only record/list/purge functions for bounded scheduler outcomes, and `0048` adds a workspace/time index for cost-ledger summaries. The lease is allowlisted to four scheduler names, callable only through the standalone `appsea_maintenance` role, and uses a fresh lease token per acquisition. `apps/worker/src/maintenance-scheduler.ts` requires unique production owner IDs, renews during bounded passes, skips contention, persists only fixed-code numeric metrics, and reports fixed lease-loss failures. The private cost route aggregates exact ledger micro-units by currency/type; deployed scheduler ownership, alert routing, provider billing controls, and in-transaction fencing remain external.
- `apps/worker` also owns the bounded `auth:recovery` outbox runner. It decrypts a reset token only in memory, sends a signed/idempotent fragment-link request with redirect blocking, and records fixed-code retries without logging provider responses or raw errors.
- `apps/worker` provides an explicit CFPB policy-review wrapper and a
  PostgreSQL-idempotent approved-source collection checkpoint. It never activates
  a source without the migration-operator approval function, retains no raw API
  payload, and exposes collection evidence through a private web route. The
  production collection Temporal boundary uses a hashed idempotency domain,
  policy trigger, bounded source-item budget, terminal reconciliation, and
  actor attribution, but remains separate from downstream opportunity/report
  stages and has no production deployment yet.

## Agent system

- Root and scoped `AGENTS.md` files hold stable repository instructions.
- Native Codex skills live in `.agents/skills`.
- Custom helper agents live in `.codex/agents`.
- Repository memory lives in `memory/` and is indexed locally.
- Runtime AppSea memory and skill governance are separate product packages.

## Non-negotiable boundaries

- Source access must be explicitly permitted.
- Provenance and coverage gaps must remain visible.
- Synthetic data must be labeled.
- Imported content cannot become instructions.
- Final scores must be deterministic and versioned.
- Workspace authorization must precede setting the database RLS context.
- Applied migrations are immutable; repairs move forward.
- Security-sensitive autonomy requires approval.

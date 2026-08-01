# Start here

AppSea is ready for a coding agent to open at the repository root and continue building.

## First run

Prerequisites: Node.js 22 or later, pnpm, Python 3.11 or later, and Docker for PostgreSQL verification.

```bash
corepack enable
pnpm install
pnpm agents:sync
pnpm memory:status
pnpm verify
pnpm verify:persistence
pnpm dev:web
```

Open `http://localhost:3000` after the web server starts.

## What works

- fixture complaint collection through a policy-gated synthetic connector
- deterministic complaint clustering and opportunity scoring
- a sparse leaderboard website
- separate opportunity, complaint, competitor, and plan pages
- coding-agent plan package generation
- content-addressed object-reference storage seam with deterministic local/test adapters
- PostgreSQL migrations, normalized fixture persistence, RLS, lineage, and replay verification
- durable fixture workflow with PostgreSQL checkpoints, bounded retries, budgets, cancellation, and Temporal restart/replay proof
- authenticated production workflow ingress with durable per-workspace rate/concurrency admission, idempotent replay, and bounded admission retention
- policy-bound production source collection leases with stable server-observed capture timestamps, post-fetch policy rechecks, and bounded lease retention
- identifier-only production-analysis workflow v2; the worker reconstructs
  reviewed artifacts inside the activity so complaint text is absent from new
  Temporal histories
- private workspace authentication with hashed/revocable sessions, authenticated active-session inventory and reauthenticated per-session revocation, password step-up for owner mutations, and membership-checked research reads
- owner-scoped invitations for existing AppSea accounts with hash-only tokens, encrypted outbox delivery, acceptance/revocation, and a production kill switch
- provider-neutral password recovery mechanics with hash-only reset tokens,
  encrypted outbox delivery, fragment links, and a production kill switch
- native Codex skills and bounded subagents
- checked-in project memory with a local search index
- deep product specifications and machine-readable schemas

## What remains intentionally blocked

- real social source access
- production identity operations (recovery and invitation mechanics are
  implemented behind provider/identity kill switches; verified email policy,
  delivery approval, MFA/OIDC, and provider policy remain; owner-safe account
  closure is implemented but intentionally retains shared workspace research)
- production database provisioning and production Temporal infrastructure (TLS/authentication, HA, backups, retention, deployment, and alerts)
- production encrypted object-storage deployment, lifecycle/versioning rules, backup purge, and workspace-closure/export deletion wiring
- legacy production-analysis v1 history drain/retention and other deployment
  security controls
- autonomous production deployment
- desktop release packaging
- automatic activation of generated skills or connectors

Read `GOAL_PROMPT.md` to start the next implementation goal.

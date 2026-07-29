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
- production encrypted object storage, lifecycle rules, backup purge, and database lineage wiring
- autonomous production deployment
- desktop release packaging
- automatic activation of generated skills or connectors

Read `GOAL_PROMPT.md` to start the next implementation goal.

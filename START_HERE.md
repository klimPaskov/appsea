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
- shared fail-closed Temporal endpoint configuration for the web client and durable worker (local loopback or production TLS/API-key/namespace/CA settings)
- server-clock PostgreSQL scheduler leases for bounded maintenance and delivery commands, with a dedicated maintenance role, per-acquisition tokens, owner-checked renewal, stale takeover, fixed lease-loss events, and maintenance-role-only durable run metrics
- authenticated production workflow ingress with durable per-workspace rate/concurrency admission, idempotent replay, and bounded admission retention
- policy-bound production source collection leases with stable server-observed capture timestamps, post-fetch policy rechecks, and bounded lease retention
- identifier-only production-analysis workflow v2; the worker reconstructs
  reviewed artifacts inside the activity so complaint text is absent from new
  Temporal histories
- private workspace authentication with hashed/revocable sessions, authenticated active-session inventory and reauthenticated per-session revocation, password step-up for owner mutations, and membership-checked research reads
- private workspace cost summaries over the immutable ledger, grouped by currency and cost type with exact micro-unit totals and bounded periods
- private visibility for settled source-quota requests that lack a completed production result, with maintenance-role-only resolution and no automatic re-fetch
- lease-owned, read-only quota-reconciliation alert inspection with bounded alert/incomplete/clear events and visible truncated coverage
- lease-owned, read-only production-analysis recomputation alert inspection with bounded alert/incomplete/clear events and visible truncated coverage; it never dispatches or retries a repair
- explicit, one-record, tombstone-bound source re-collection with immutable lineage and private review; it never runs automatically and does not activate a connector
- direct CFPB source commands use the same bounded production admission ledger through the `appsea-worker` service principal; they cannot bypass private-workspace, fixture, or source-policy gates
- owner-scoped invitations for existing AppSea accounts with hash-only tokens, encrypted outbox delivery, acceptance/revocation, and a production kill switch
- provider-neutral password recovery mechanics with hash-only reset tokens,
  encrypted outbox delivery, fragment links, and a production kill switch
- native Codex skills and bounded subagents
- secret-free `pnpm production:preflight` configuration gate for production
  role, TLS, Temporal, object-store, scheduler, delivery, and proxy settings
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
- deployed scheduler ownership, incident routing, and live alert delivery for quota-reconciliation and production-analysis recomputation cases
- automatic source re-collection, downstream analysis, and report/plan generation after a re-collection

Read `GOAL_PROMPT.md` to start the next implementation goal.

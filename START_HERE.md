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

The command above runs the public fixture website. To exercise the private
workspace path locally, run `pnpm dev:local`; it starts the existing loopback
PostgreSQL/Temporal services, applies migrations, and starts the durable worker
and web process. See [`docs/runbooks/local-stack.md`](docs/runbooks/local-stack.md).
The disposable integration smoke is `pnpm verify:local-stack`.

## What works

- fixture complaint collection through a policy-gated synthetic connector
- deterministic complaint clustering and opportunity scoring
- a sparse leaderboard website
- separate opportunity, complaint, competitor, and plan pages
- coding-agent plan package generation
- content-addressed object-reference storage seam with deterministic local/test adapters
- PostgreSQL migrations, normalized fixture persistence, RLS, lineage, and replay verification
- editor/owner field-level evidence redaction with immutable receipts, provenance-preserving masks, and private report/analysis read projections
- durable fixture workflow with PostgreSQL checkpoints, bounded retries, budgets, cancellation, and Temporal restart/replay proof
- shared fail-closed Temporal endpoint configuration for the web client and durable worker (local loopback or production TLS/API-key/namespace/CA settings)
- server-clock PostgreSQL scheduler leases for bounded maintenance and delivery commands, with a dedicated maintenance role, per-acquisition tokens, owner-checked renewal, stale takeover, fixed lease-loss events, and maintenance-role-only durable run metrics
- authenticated production workflow ingress with durable per-workspace rate/concurrency admission, idempotent replay, and bounded admission retention
- policy-bound production source collection leases with stable server-observed capture timestamps, post-fetch policy rechecks, and bounded lease retention
- identifier-only production-analysis workflow v2; the worker reconstructs
  reviewed artifacts inside the activity so complaint text is absent from new
  Temporal histories, and a bounded visibility-only checker distinguishes new
  v2 histories from legacy executions without decoding payloads
- idempotent SIGINT/SIGTERM worker shutdown that drains handoff/recomputation
  scans and heartbeat work before closing Temporal and PostgreSQL connections
- private workspace authentication with hashed/revocable sessions, authenticated active-session inventory and reauthenticated per-session revocation, password step-up for owner mutations, AppSea-owned TOTP MFA, conditional MFA step-up for password-gated high-risk mutations, and membership-checked research reads
- optional, disabled-by-default OIDC identity linking/sign-in with strict
  issuer/subject binding, state/nonce/PKCE and ID-token verification, explicit
  step-up-protected linking/unlinking, and MFA-aware challenge handoff
- private workspace cost summaries over the immutable ledger, grouped by currency and cost type with exact micro-unit totals and bounded periods
- lease-owned, bounded dormant-account MFA ciphertext rewrap batches with fail-closed unknown-version handling and count-only progress
- private visibility for settled source-quota requests that lack a completed production result, with maintenance-role-only resolution and no automatic re-fetch
- lease-owned, read-only quota-reconciliation alert inspection with bounded alert/incomplete/clear events and visible truncated coverage
- lease-owned, read-only production-analysis recomputation alert inspection with bounded alert/incomplete/clear events and visible truncated coverage; it never dispatches or retries a repair
- lease-owned, read-only workspace cost-threshold inspection with exact micro-unit aggregates, explicit currency gaps, and bounded alert/incomplete/clear events; it never blocks work or performs billing
- scalar-only, maintenance-owned operational-alert outbox with idempotent enqueue, stale-claim recovery, bounded retry/exhaustion, retention purge, and the `pnpm worker:alerts:deliver` drain command
- archived-owner, private, deterministic metadata-only workspace purge manifests with 24-hour expiry and visible object/export/backup requirements; they never authorize deletion
- explicit, one-record, tombstone-bound source re-collection with immutable lineage and private review; it never runs automatically and does not activate a connector
- direct CFPB source commands use the same bounded production admission ledger through the `appsea-worker` service principal; they cannot bypass private-workspace, fixture, or source-policy gates
- owner-scoped invitations for existing AppSea accounts with hash-only tokens, encrypted outbox delivery, acceptance/revocation, and a production kill switch
- owner-only, step-up-protected workspace archival that blocks active work, preserves research lineage, and records identifier-only lifecycle receipts
- owner-issued, expiring workspace-scoped agent tokens with hash-only persistence, recent password step-up, and conditional recent-MFA create/revoke controls
- authenticated read-only MCP-over-HTTP access to scoped private opportunities, evidence references, source coverage, and approved report/plan artifacts
- owner-authorized, tenant-private CSV/JSON intake through the `manual-owner-import-v1` policy, with bounded parsing, PII scrubbing, identifier-only Temporal handoff, durable batch consumption, and owner deletion/tombstones; this is not public market coverage and never fetches imported URLs
- provider-neutral password recovery mechanics with hash-only reset tokens,
  encrypted outbox delivery, fragment links, and a production kill switch
- native Codex skills and bounded subagents
- secret-free `pnpm production:preflight` configuration gate for production
  role, TLS, Temporal, object-store, scheduler, delivery, proxy, and cost-alert settings
- checked-in project memory with a local search index
- deep product specifications and machine-readable schemas

## What remains intentionally blocked

- real social or other third-party public source access (CFPB and Stack Exchange remain disabled pending independent review; owner imports are private and bounded)
- production identity operations (recovery and invitation mechanics are
  implemented behind provider/identity kill switches; verified email policy,
  delivery approval, OIDC provider approval, and provider policy remain;
  owner-safe account
  closure is implemented but intentionally retains shared workspace research)
- production database provisioning and production Temporal infrastructure (TLS/authentication, HA, backups, retention, deployment, and alerts)
- production encrypted object-storage deployment, lifecycle/versioning rules, provider consumption of purge manifests, and destructive workspace/object/backup/export purge wiring (workspace archival is implemented separately)
- production deployment must still run the legacy production-analysis v1
  history checker, complete approved archive/retention actions, and prove the
  remaining Temporal security controls; it must also configure a worker drain
  window and prove graceful replacement/crash recovery
- autonomous production deployment
- desktop release packaging
- automatic activation of generated skills or connectors
- deployed scheduler ownership, incident routing, endpoint operation, and provider recovery for live alert delivery (the repository outbox and drain are implemented)
- automatic source re-collection, downstream analysis, and report/plan generation after a re-collection
- deployed MCP secret storage, HTTPS/rate limiting, token-rotation automation, provider-backed MFA/OIDC controls, identity key rotation, and step-up contracts for mutations outside the password-gated set

Read `GOAL_PROMPT.md` to start the next implementation goal.

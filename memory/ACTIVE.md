# Active work

## State

The fixture product, PostgreSQL persistence, durable workflows, policy-gated
CFPB collection checkpoint, authenticated private workspaces, report/plan
approval/export, recovery, and invitations are implemented. Migrations
`0027`-`0049` add policy evidence, collection checkpoints, deletion repair,
leases, snapshot reconciliation, workflow admissions, source-reconciliation
admission, retryable tombstones, maintenance-run telemetry, and a durable
source-quota reconciliation case ledger. CFPB remains
disabled; deployed Temporal/scheduler ownership, policy approval, role
separation, re-collection, non-fixture outputs, and identity-provider approval
remain open. Fixture and production collection routes are Temporal gateways;
signup workspaces remain non-fixture by design.

On 2026-08-01, production analysis Temporal starts were versioned to
`production-analysis-v2`. New starts carry only workspace, collection,
analysis, seed-review, timestamp, and digest identifiers. `apps/worker`
reconstructs the policy-validated artifact from workspace-bound rows inside the
persistence activity, preserving the no-raw-source-in-history boundary. Legacy
v1 executions need a drain/retention plan.

Retention uses server-observed activity time rather than caller `requestedAt`;
future timestamps are rejected. Final lineage locks the active, current,
unexpired policy, requires allowed/restricted commercial use, and rechecks
confirmed redacted evidence before linking outputs. Collection initialization
fails closed without a consumed admission reservation.

Collection persistence locks and rechecks the source lease in its write
transaction. Settled source-request cost travels from `CfpbConnector` through
the immutable collection snapshot/result, Temporal checkpoints, and
audit/outbox metadata. The reviewed CFPB policy declares zero API cost; the
runner rejects known cost overages before lease acquisition.

The object-store boundary includes a signed S3-compatible adapter and one
environment factory used by web, durable worker, and source maintenance. It
uses conditional content-addressed body/sidecar writes, ETag-guarded deletion,
bounded hash-checked reads, and the retention purge queue. Provider
encryption/versioning, backup deletion, credential rotation, and deployed cloud
proof remain open; local filesystem fallback is not a production claim.

Operational monitoring includes `/api/health/live`, `/api/health/ready`, and a
secret-free worker heartbeat every 30 seconds. Web and durable worker share a
fail-closed Temporal endpoint contract: production requires non-loopback
address, namespace, API key, and pinned CA. Deployment topology, authorization,
HA, retention, and failure drills remain open.

Migration `0046_maintenance_scheduler_leases.sql` adds a global server-clock
lease per fixed scheduler name. Only standalone, non-inheriting
`appsea_maintenance` can call acquire/renew/release; runtime table access and
`appsea_service` function execution are revoked. Acquisitions have fresh
tokens. Source maintenance, auth retention, recovery, and invitation delivery
renew during bounded passes, guard mutations, skip contention, and emit fixed
lease-loss/release failures.

Migration `0047_maintenance_scheduler_run_metrics.sql` adds
maintenance-role-only record/list/purge functions. The wrapper records a
generated run ID, owner/state, fixed failure code, bounded duration, and
validated numeric counters, purges rows older than the configured retention
window, and never persists lease tokens, source content, credentials, or raw
exception messages. This improves durable operator telemetry but does not
provide fencing inside a long-running mutation, deployed scheduler ownership,
or alert routing. Migration `0048` adds the ledger time index and a
membership-authorized private workspace cost summary that groups exact
micro-unit totals by currency and cost type over a bounded period; it is
operational accounting, not billing. Migration `0049` discovers committed
source reservations without completed production results, exposes private
member inspection at `/api/workspaces/:workspaceId/research/quota-reconciliation`,
and permits only the standalone maintenance role to record an exact linked
result or explicit no-result resolution. It never refunds quota or authorizes
a re-fetch.

## Validated commands

- `pnpm verify` passed 2026-08-01 before this telemetry tranche: packages,
  samples, smoke, and repository checks.
- Scheduler/metrics focus: contracts 64 tests, DB 84 tests, worker 58 tests,
  lint, typecheck, and format checks passed.
- Workspace cost focus: private route tests 67 passed; exact micro-unit
  aggregation, period bounds, and membership/error boundaries are covered.
- Quota reconciliation focus: private inspection route tests 71 passed across
  the web suite; contract case invariants, repository role boundaries, and
  maintenance resolution are covered. Docker-backed persistence remains
  unavailable in this environment.
- PostgreSQL migration/read/deletion/concurrency/role/metrics integration is
  staged but Docker-blocked by the unavailable Docker Desktop Linux engine.
- `pnpm agents:sync` passed; memory and docs checks must pass after this file
  rewrite.

## Next production tranche

1. Legal/privacy/security approval and activation of the CFPB connector policy.
2. Provision production Temporal and add Docker-backed crash/retry proof.
3. Provider/identity approval, verified recovery/invitation delivery, and
   deployed auth/source maintenance jobs.
4. Explicit re-collection after deletion and general report/export workflows.
5. Operational monitoring, deployed scheduler ownership, provider pricing and
   billing controls, production database/Temporal provisioning, and security
   review.

## Current blockers

- No real source is approved or enabled; CFPB is policy-gated.
- No production database/Temporal deployment exists; local fixtures are not
  production infrastructure. Identity delivery, role separation, cloud/backup
  purge, and deployment validation remain.
- Recovery and invitation delivery are disabled pending provider, identity,
  DPA/retention, key-rotation, monitoring, and failure-drill approval.
- Deletion propagation retries and terminalizes bounded failures, but explicit
  re-collection, workspace-closure/export purge, cloud object storage, and
  backup purge remain open.
- Production collection is locally package-tested and PostgreSQL-idempotent,
  but no production Temporal deployment or integration proof exists. Cloud
  storage, recomputation alerting, deployed reconciliation scheduling, and
  quota-case alert ownership remain open.
- Windows/macOS packaging remains open.

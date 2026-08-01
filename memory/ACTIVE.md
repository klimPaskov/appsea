# Active work

## State

The fixture product, PostgreSQL persistence, durable workflows, policy-gated
CFPB collection checkpoint, authenticated private workspaces, report/plan
approval/export, recovery, and invitations are implemented. Migrations
`0027`–`0045` add policy evidence, collection checkpoints, deletion repair,
leases, snapshot reconciliation, workflow admissions, authenticated
source-reconciliation admission, and retryable tombstone propagation. CFPB
remains disabled; deployed Temporal/scheduler ownership,
policy approval, role separation, re-collection, non-fixture outputs, and
identity-provider approval remain open. Fixture and production collection
routes are Temporal gateways; signup workspaces remain non-fixture by design.

Migrations `0042`–`0045` add manual-analysis/source-reconciliation
admission, immutable actor attribution, object purge, retryable tombstones, and
worker-principal snapshot scheduling. The maintenance runner resumes one due
snapshot per workspace with bounded counters; recomputation claims are
server-clock recoverable with deterministic Temporal identity. Focused tests
pass, while PostgreSQL/RLS integration remains Docker-blocked.

On 2026-08-01, the production analysis Temporal envelope was versioned to
`production-analysis-v2`. New starts carry only workspace, collection, analysis,
seed-review, timestamp, and digest identifiers. `apps/worker` reconstructs the
policy-validated artifact from workspace-bound rows inside the persistence
activity, preserving the no-raw-source-in-history boundary. The old v1 shape is
not accepted for new starts; legacy executions need a drain/retention plan.

Retention uses server-observed activity time rather than caller `requestedAt`,
and the repository rejects materially future timestamps. Final lineage locks
the active, current, unexpired policy, requires allowed/restricted commercial
use, and rechecks confirmed redacted evidence before linking outputs. Collection
initialization fails closed without one.

Open security follow-ups are cloud object/backup deletion verification,
deployment-level service-role/secret rotation, and scheduler ownership.
Collection persistence now locks and rechecks the lease in its write
transaction; these and production deployment remain readiness blockers.

The production collection cost slice now preserves the settled source-request
cost from `CfpbConnector` through `productionCollectionPersistenceInputSchema`,
the immutable collection snapshot/result, Temporal persistence checkpoints,
and audit/outbox metadata. The reviewed CFPB policy still declares zero API
cost; non-zero billing adapters and deployment-level cost monitoring remain
open. The runner rejects a known source-cost overage before lease acquisition,
and the workflow records a bounded `cost_budget_exceeded` result. Existing
snapshots parse with a zero default for backward compatibility.

The object-store boundary now includes a signed S3-compatible adapter and one
environment factory used by web, durable worker, and source maintenance. It
uses conditional content-addressed body/sidecar writes, ETag-guarded deletion,
bounded hash-checked reads, and the existing retention purge queue. Provider
encryption/versioning, backup deletion, credential rotation, and deployed
cloud proof remain open; local filesystem fallback is not a production claim.
Web typecheck now runs Next route type generation itself, avoiding a concurrent
`.next` build race during repository verification.

The operational monitoring slice now adds `/api/health/live` and
`/api/health/ready`. Readiness checks PostgreSQL, authenticated Temporal, and
object-store configuration with fixed two-second deadlines and no dependency
error details. The long-lived worker emits a secret-free `worker_heartbeat`
every 30 seconds. These are deployment probes/signals, not scheduler,
durable-metrics, alert-routing, or cloud deployment proof.

## Validated commands

- `pnpm verify` passed 2026-08-01: packages, samples, smoke, and repo checks.
- Ingress, source-lease, snapshot-reconciliation admission, object-purge, and
  recomputation-reclaim focused suites passed; real PostgreSQL fixtures remain
  Docker-blocked.
- 2026-08-01 tombstone-retry focus: db lint, db typecheck, db 73-test suite,
  worker typecheck, worker 48-test suite passed; migration and integration
  assertions are present.
- 2026-08-01 source-maintenance scheduler focus: contracts 62-test suite and
  worker 48-test suite passed; the real PostgreSQL scheduler path remains
  Docker-blocked.
- 2026-08-01 collection-cost focus: contracts 62, connectors 16, db 74,
  workflows 21, and worker 48 tests passed; full repository verification passed.
- `pnpm verify:persistence` and `pnpm verify:workflows` attempted on
  2026-07-25 and 2026-08-01; both are blocked by the unavailable Docker
  Desktop Linux engine pipe (`//./pipe/dockerDesktopLinuxEngine`).

## Next production tranche

1. Legal/privacy/security approval and activation of the CFPB connector policy.
2. Provision the production Temporal boundary and add Docker-backed
   repository/activity crash and retry proof for production collection.
3. Provider/identity approval, verified recovery/invitation delivery, and
   deploy/operate validated auth/source maintenance jobs.
4. Explicit re-collection after deletion and general report/export workflows.
5. Operational monitoring, cost controls, production database/Temporal
   provisioning, and security review.

## Current blockers

- No real source is approved or enabled; CFPB is policy-gated and has no active
  deployment.
- No production database/Temporal deployment exists. Local fixtures are not
  production infrastructure; identity delivery, role separation, cloud/
  backup/closure purge, and deployment validation remain.
- Account recovery and invitation delivery remain disabled pending provider,
  identity, DPA/retention, key-rotation, monitoring, and failure-drill
  approval; invitations accept existing accounts only.
- Deletion propagation now retries and terminalizes bounded failures, but
  explicit re-collection, cloud object storage, exports, workspace closure,
  and backup purge remain open.
- Production collection is locally package-tested and PostgreSQL-idempotent,
  but no production Temporal deployment or integration proof exists. Cloud
  object storage, recomputation alerting, deployed reconciliation scheduling,
  and quota/operator reconciliation remain open; repository-level snapshot
  resume is now part of source maintenance.
- Windows/macOS packaging remains open.

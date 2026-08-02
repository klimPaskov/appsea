# Production-readiness audit — 2026-08-02

Status: not production-ready. This is the current requirement-by-requirement
audit for the active AppSea goal. It supersedes the 2026-07-25 baseline while
preserving that report for historical comparison.

## Surface status

| Requirement                                 | Repository state                                                 | Evidence and remaining gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL persistence and migrations       | Implemented as a production-shaped repository slice              | Sixty-seven forward, checksummed migrations cover sources, evidence, complaints, clusters, competitors, opportunities, score snapshots, reports, plans, deletion lineage, workflow state, costs, maintenance projections, owner-only non-destructive workspace archival, and provenance-preserving field-level evidence redaction. Least-privilege repositories, forced-RLS transactions, and migration assertions are tested. Fresh PostgreSQL integration is blocked on this host because Docker's Linux engine pipe is unavailable. |
| Durable workflow engine and idempotent jobs | Implemented locally and in package/CI tests                      | Fixture, production collection, identifier-only production analysis v2, handoff, recomputation, maintenance, and alert-inspection jobs have bounded retries, leases, idempotency, and terminal states. Production Temporal TLS/namespace authorization, HA, deployment ownership, legacy v1 history drain, and crash drills still require an operated environment.                                                                                                                                                                     |
| Approved complaint source connector         | Boundary implemented; activation blocked                         | CFPB has typed policy metadata, quotas, provenance, deletion reconciliation, source leases, and fixture-backed HTTP tests. It remains disabled pending independent legal/privacy/security review and explicit commercial-use/retention approval. Stack Exchange remains unregistered and inactive pending separate competitor-purpose review.                                                                                                                                                                                          |
| Complaint analysis and scoring              | Implemented for fixture and reviewed production-shaped artifacts | Normalization, deduplication, classification/entity snapshots, clustering, competitor/contrary-signal fields, deterministic versioned scoring, correction invalidation, and bounded recomputation are persisted and tested. Synthetic fixture data is labeled and not market evidence.                                                                                                                                                                                                                                                 |
| Reports and coding-agent packages           | Implemented behind private governance boundaries                 | Evidence-backed reports, coverage gaps, approval state, object references, plans, approved JSON export, and private routes are implemented. Owner settings now expose a read-only purge-readiness inventory for database-observable blockers. Non-fixture output requires deployed encrypted object storage; workspace-closure/export purge and backup deletion remain open.                                                                                                                                                           |
| Authentication and private workspaces       | First private slice implemented                                  | Password sessions, membership/RLS authorization, step-up, session inventory/revocation, owner-safe account closure, owner-only workspace archival, invitations, and recovery mechanics exist. Recovery/invitations remain kill-switched pending provider/DPA/retention review; MFA/OIDC, verified identity, and production identity operations remain open.                                                                                                                                                                            |
| Website and desktop boundary                | Website contract implemented; desktop release not shipped        | The public leaderboard remains sparse and explicitly synthetic; research detail is on private opportunity routes. Web smoke/build/type/test checks pass. Tauri Windows/macOS signing, updates, platform testing, and release runbook are not implemented.                                                                                                                                                                                                                                                                              |
| Observability, cost limits, and recovery    | Repository-level controls implemented                            | Maintenance leases, run metrics, heartbeat/readiness, quota/recomputation/cost alert inspections, exact micro-unit summaries, bounded failures, and secret-free events are implemented. Deployment scheduler ownership, incident routing, provider pricing/billing, live alert delivery, and failure drills remain external.                                                                                                                                                                                                           |
| Guidance, memory, skills, and provenance    | Aligned                                                          | `AGENTS.md`, native skills, docs index, active plan, current status, `memory/ACTIVE.md`, source policies, tests, and completion reports agree on fixture-only/review-gated scope and visible coverage gaps. Imported content remains untrusted and cannot edit repository guidance.                                                                                                                                                                                                                                                    |

## Validation evidence

Passing on 2026-08-02:

- `pnpm verify` (all 56 Turbo tasks, fixture worker, plan sample, analysis sample,
  web smoke, and repository checks).
- Focused contracts (81 tests), database (117 tests / 27 files), and web route
  suites for the evidence-redaction tranche.
- `pnpm format:check`, `pnpm memory:check`, and `pnpm repo:check --docs-only`.

The purge-readiness tranche also passed focused contracts (82 tests), database
(118 tests), and web (115 tests) suites plus package typechecks.

Attempted but unavailable on this host:

- `pnpm verify:persistence:fresh`
- `pnpm verify:workflows:fresh`

Both stop before execution because `//./pipe/dockerDesktopLinuxEngine` is not
available. No claim is made for fresh PostgreSQL role/RLS/migration-upgrade or
Temporal crash/replay integration until those gates pass on a Docker-enabled
host.

## Deliberate simplifications

- The only complete research path remains synthetic fixture mode.
- No source is activated by this repository or by an autonomous worker.
- Alert scans are read-only observability projections; they never dispatch,
  retry, block admission, or perform billing.
- Purge readiness is a read-only owner inventory. `database_ready` does not
  authorize workspace, export, object-store, or backup deletion.
- Production identity, cloud storage/backup deletion, provider billing, live
  alert routing, infrastructure provisioning, and desktop release are not
  simulated with fixtures or presented as complete.

## Exact next actions

1. Obtain independent legal/privacy/security approval for CFPB and a separately
   reviewed competitor-purpose source before any activation.
2. Provision role-separated PostgreSQL and authenticated Temporal, then run the
   fresh persistence/workflow gates plus restore, crash, and legacy-history
   drain/retention drills.
3. Approve identity/delivery providers, MFA/OIDC, DPA and retention terms, key
   rotation, and recovery/invitation monitoring before enabling delivery.
4. Deploy encrypted object storage with lifecycle/versioning, workspace/export
   purge, backup deletion, provider pricing, and incident routing.
5. Complete signed Windows/macOS Tauri packaging and release validation.

This report is completion proof for the audit only; it is not a claim that
AppSea is production-ready or that real market research is available.

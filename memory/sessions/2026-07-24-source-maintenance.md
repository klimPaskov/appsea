# Session handoff: 2026-07-24 source maintenance

- Date: 2026-07-24
- Status: active; quota/deletion tranche complete, production blockers remain

Added migrations `0011_source_quota_reservations.sql`,
`0012_deletion_propagation.sql`, `0013_quota_deletion_hardening.sql`,
`0014_maintenance_workspace_enumerator.sql`, `0015_deletion_state_integrity.sql`,
`0016_deletion_claim_integrity.sql`, `0017_workflow_actor_attribution.sql`, and
`0018_workflow_actor_update_scope.sql`, and `0019_workflow_workspace_gate.sql`.
PostgreSQL now owns shared source quota minute windows, workspace-scoped
idempotent reservations, commit/release settlement, bounded expiry/purge, and
future-date checks. `PostgresSourceQuotaRepository` is adapted to the narrow
connector capability; CFPB collection requires it outside tests and remains
disabled/pending review.

Added `PostgresDeletionPropagationRepository` with skip-locked claims, stale
claim recovery, idempotent completion/failure, provenance-linked tombstones,
raw-object reference clearing, normalized-evidence/report/plan redaction, and
unavailable projections. Added `apps/worker source:maintenance` for
all-workspace quota expiry/purge and deletion processing with secret-free
events. The all-workspace path now calls the narrowly granted
`appsea.list_active_workspaces_for_maintenance()` security-definer function;
direct runtime table reads remain forced-RLS fail-closed. Active source/evidence
rewrites and terminal tombstone payload/state rewrites are database-blocked, and
processing rows require a lease-start timestamp.

Authenticated fixture workflow starts now inject the session user as a durable
requesting actor. Service starts default to the explicit `appsea-worker` actor;
the migration verifies user membership/role and makes actor columns immutable,
and terminal audit events use the stored actor instead of a hard-coded worker.
Migration 0018 keeps later job updates from depending on continued membership,
so revocation cannot strand an already-running workflow.
Migration 0019 rejects direct workflow inserts for inactive or non-fixture
workspaces as a database defense-in-depth gate.

Checks passed: db tests (17), connectors tests (12), worker tests (13), db/
connectors/worker lint and typecheck. Docker-backed fresh PostgreSQL and
Temporal validation remains blocked by the unavailable Docker Desktop engine.

Next: validate the SQL/functions against a fresh PostgreSQL instance; add
complaint/cluster/opportunity recomputation, object-store/backups and export
purge, source-policy registry activation, principal-attributed production
Temporal/identity/role operations before any production claim. A fixture-only
authenticated web workflow start/status gateway is now present; signup-created
non-fixture workspaces intentionally reject synthetic starts.

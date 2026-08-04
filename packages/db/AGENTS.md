# Database instructions

Read the root `AGENTS.md`, ADR 0006, `appsea-contract-change`, and
`appsea-security-review` before changing production persistence.

Use ordered forward-only SQL migrations. Never edit a migration that may have
been applied; add a new migration instead. Every workspace-owned query must run
inside an explicit workspace transaction so row-level security remains active.
Keep raw source payloads out of ordinary relational rows. Preserve provenance,
policy versions, immutable content hashes, deletion identifiers, audit records,
and score/report/plan lineage.

Migration and repository changes require integration tests against real
PostgreSQL. Mocks or SQLite do not prove constraints, transactions, or row-level
security.

Scheduled mutations must carry the private `MaintenanceSchedulerFence` into
the same service transaction as the write; migration `0052` holds the lease
advisory/row lock through commit. Do not claim this fence covers external
source, provider, or object-store effects.

Complaint-derived fields must be persisted with the immutable observation in a
versioned `analysis_snapshot` JSONB column. Backfill older rows conservatively,
keep unresolved entity types explicit, and expose snapshot review-state changes
through the same workspace transaction as the relational review state.

Source-policy approvals must retain canonical reviewer identity, independent
role, and explicit attestation. Preserve legacy review rows for audit, but do
not treat them as collectible until an integrity-attested review re-approves
the policy.

Runtime skill governance is global and dormant. Persist only records hydrated
through `@appsea/skill-registry`; use the migration-operator security-definer
functions and immutable transition events from migration `0099`. Never grant
the service, maintenance, or worker roles direct runtime-skill table/function
access, and do not treat persistence as activation.

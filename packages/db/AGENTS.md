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

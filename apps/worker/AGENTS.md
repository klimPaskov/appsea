# Worker instructions

Read the root `AGENTS.md`, `appsea-worker-job` skill, and ADR 0007.

Worker entry points must be deterministic in fixture mode, idempotent for the same run id, explicit about output paths, and safe to rerun. Production jobs will need durable checkpoints, cancellation, retry limits, cost budgets, and structured failure records.

The durable fixture worker owns Temporal activity adapters and PostgreSQL job
projections. Keep workflow histories sanitized, map failures to fixed types, and
make persistence completion a non-cancellable safe point. The local Temporal
endpoint is loopback-only and development-only; production TLS, authorization,
retention, HA, backups, and deployment controls require a separate reviewed
configuration. Emit only the bounded, secret-free events defined by
`src/observability.ts`; never add raw exception messages, source text, bearer
tokens, passwords, or database URLs to worker logs.

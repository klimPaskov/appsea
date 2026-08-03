# Workflow package instructions

Read the root `AGENTS.md`, ADR 0007, and the `appsea-worker-job` skill before
changing this package.

Workflow code must remain deterministic and replay-safe. Keep Node APIs, crypto,
database clients, report generation, source payloads, complaint text, and raw
idempotency keys out of workflow bundles. Use type-only activity contracts and
validated shared schemas. Version workflow behavior and task queues explicitly;
add replay/duplicate/retry/cancellation tests for changes.

Activities in `apps/worker` own external effects and PostgreSQL access. Map
failures to fixed sanitized types and preserve the persistence safe point. A
local Temporal proof never authorizes production deployment or implies TLS,
authentication, HA, backup, or retention controls.

Production-analysis v2 starts may carry only the reviewed, non-sensitive history
memo from `packages/contracts`; never add evidence, source payloads, caller
secrets, or arbitrary memo values. Legacy v1 histories are handled by the
worker's visibility-only drain checker and an operator manifest, not by
decoding or deleting history inside workflow code.

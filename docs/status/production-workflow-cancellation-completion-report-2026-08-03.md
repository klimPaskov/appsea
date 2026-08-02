# Production workflow cancellation completion report — 2026-08-03

Status: repository tranche complete; production deployment remains unproven.

## Delivered

- Migration `0071_production_collection_workflow_cancellation.sql` adds
  immutable, owner/editor-bound cancellation intent to the forced-RLS
  one-source workflow projection. Service updates are limited to the intent
  columns, and the trigger rejects service-principal or terminal-job requests.
- `PostgresProductionCollectionWorkflowRepository` persists idempotent user
  intent with identifier-only audit/outbox receipts, exposes bounded service
  target/prepare reads, and includes the request timestamp in private campaign
  run history.
- The private workflow status route accepts same-origin owner/editor `POST`
  cancellation requests. It commits PostgreSQL first, attempts Temporal
  cancellation best-effort, returns `202` while pending, and never exposes
  provider errors or source content.
- The leased source-maintenance pass retries pending one-source cancellations
  with `APPSEA_PRODUCTION_WORKFLOW_CANCELLATION_BATCH_SIZE`; the worker never
  marks terminal state. Existing workflow non-cancellable termination remains
  responsible for `canceled` versus persistence-race reconciliation to
  `completed`.
- Campaign history and workflow-status pages show a quiet cancellation action
  and pending safe-boundary state. The public leaderboard remains unchanged.

## Validation

- `pnpm --filter @appsea/contracts test` — 86 passed.
- `pnpm --filter @appsea/db test` — 124 passed.
- `pnpm --filter @appsea/worker test` — 100 passed.
- `pnpm --filter @appsea/web test` — 132 passed.
- Affected package typechecks and `pnpm format:check` pass.

Fresh PostgreSQL/Temporal lifecycle probes remain blocked before startup by the
unavailable Docker Desktop Linux engine pipe. No production role, namespace,
provider, source activation, or crash-drill claim is made.

## Simplifications and remaining gates

- The cancellation runner retries only the external Temporal call; it does not
  add a second terminal-state writer or a new queue. Workflow reconciliation is
  intentionally the single persistence authority.
- Cancellation is available after the workflow projection exists; a start/cancel
  race before projection creation returns not-found and remains an operational
  retry case.
- Source legal/privacy/security approval, production PostgreSQL/Temporal,
  identity/MFA/OIDC, cloud purge/backup controls, alert routing, and signed
  Windows/macOS Tauri release validation remain open.

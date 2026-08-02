# Research campaign orchestration cancellation completion report — 2026-08-03

## Status

Implemented as a production-shaped local/CI slice. It is not a production
activation claim: non-fixture sources remain disabled, and deployed
PostgreSQL/Temporal, scheduler ownership, and crash-drill gates remain open.

## Delivered

- Added migration `0070_research_campaign_orchestration_cancellation.sql`.
  Cancellation intent is immutable, workspace-scoped, owner/editor-only, and
  recorded with identifier-only audit/outbox receipts. It does not mark a run
  canceled until child reconciliation reaches a terminal safe point.
- Added a strict cancellation result contract and a cancellation timestamp to
  the private orchestration read model. No caller secrets, source payloads,
  policy hashes, or raw workflow history cross the read boundary.
- Added `requestCancellationForUser` to the orchestration repository. It is
  idempotent, repeats the private workspace and role checks, returns only
  bounded active child workflow identities to the server, and keeps the
  durable intent when Temporal is unavailable.
- Added cancellation reconciliation for queued children and a lease-backed
  worker retry path for already-started children. A dispatching child is left
  claim-owned until its external start either records its workflow identity or
  expires, preventing an orphan workflow race.
- Added `cancelProductionCollectionWorkflow` to the Temporal client and an
  authenticated same-origin `POST` cancellation route. The route performs a
  best-effort immediate cancel and returns `202` while the worker continues
  recovery from the persisted intent.
- Added a private campaign-page cancel action that uses existing quiet-button
  styling, keeps the public leaderboard unchanged, and states the safe-boundary
  behavior in text.

## Validation

- `pnpm --filter @appsea/contracts test` — 85 passed.
- `pnpm --filter @appsea/db test` — 122 passed.
- `pnpm --filter @appsea/workflows test` — 29 passed.
- `pnpm --filter @appsea/worker test` — 97 passed.
- `pnpm --filter @appsea/web test` — 128 passed.
- Affected package typechecks and lints passed.
- `git diff --check` passed.
- Docker-backed fresh PostgreSQL/Temporal verification remains unavailable
  because the Docker Desktop Linux engine pipe is not present on this host.

## Security review

The request is authorized at both the session gateway and the database
transaction. The database trigger binds the immutable actor to the authenticated
workspace membership and rejects terminal or service-principal requests.
Temporal cancellation is never the source of truth: the database intent is
committed first, and failed external cancellation remains inspectable and
retryable. Imported source content cannot influence cancellation or worker
instructions. Workflow IDs are returned only to the server after workspace
validation and are not included in the private response.

## Simplifications and remaining work

- This tranche covers multi-source campaign orchestrations. One-source
  production run cancellation still needs a parallel user boundary.
- The immediate web request is best effort; the lease-backed maintenance pass
  is the durable retry mechanism and still needs deployed scheduler ownership,
  Temporal namespace authorization, and crash/failure drills.
- Cancellation does not delete evidence, reports, plans, objects, exports, or
  backups. Those retention and purge boundaries remain separate reviewed work.
- No connector was activated and no production migration was run by this
  change.

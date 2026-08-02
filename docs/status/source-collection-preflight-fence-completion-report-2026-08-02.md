# Source collection pre-request fence

Date: 2026-08-02
Status: implemented; no source activated

## Delivered

- `StackExchangeConnector` and `CfpbConnector` accept a worker-owned
  `beforeRequest` lease assertion and invoke it after durable quota reservation
  but immediately before the external HTTP call.
- A denied preflight fails closed with no source request and releases the
  reservation. A failed release becomes an explicit operator-reconciliation
  error rather than silently spending or replaying quota.
- Production CFPB collection passes the source-lease assertion into the
  connector. Snapshot reconciliation passes the same assertion before every
  identifier-only page and records policy denial as a terminal reconciliation
  failure with lease cleanup.
- Connector, runner, and reconciliation tests cover allowed ordering, denied
  ordering, quota release, and no-fetch behavior.

## Security and provenance boundary

The callback is worker-owned and is not part of the caller-controlled request
digest. Imported content cannot supply or bypass it. The persistence repository
continues to lock and recheck policy and lease in the collection transaction,
and the observed lease timestamp remains the provenance timestamp. The
preflight assertion and the subsequent provider socket call are not an atomic
database transaction; this tranche reduces the revocation window but does not
claim a provider-side fencing guarantee.

## Validation

- Connector lint, typecheck, and tests pass (25 tests).
- Worker lint, typecheck, and tests pass (76 tests).
- Repository-wide `pnpm verify`, documentation checks, and memory validation
  pass on this worktree; fresh Docker-backed PostgreSQL/Temporal checks remain
  blocked because the Docker Desktop Linux engine pipe is unavailable.

## Blockers and simplifications

- CFPB and Stack Exchange remain disabled or unregistered pending independent
  legal, privacy, commercial-use, and security review. No live market-research
  claim is made.
- A preflight callback cannot make a database assertion and a remote network
  send one atomic operation. Production still requires deployment-level lease
  revocation drills, scheduler/alert ownership, and provider/network failure
  recovery.
- Quota release on denial is bounded to the reservation created by that
  request; uncertain settlement after a provider call still follows the
  existing durable quota-reconciliation runbook.

This tranche strengthens the source-policy boundary without activating a
connector or completing the broader AppSea production-readiness goal.

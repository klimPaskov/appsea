# Session handoff — private source re-collection workspace slice

## Completed

- Added strict `productionCollectionRecollectionTarget` contract data with
  source ID, native record ID, reason, completion time, active-lineage flag, and
  active workflow identifier; raw payload fields are rejected.
- Added bounded authenticated `listRecollectionTargetsForUser` persistence
  reads over completed tombstones and active recollection lineage. The gateway
  rejects a different in-flight workflow for the same tombstone while allowing
  the deterministic idempotent replay.
- Added the private campaigns-page section and owner/editor action that filters
  to current approved non-synthetic campaigns, requests exactly one record, and
  links to durable workflow status without auto-analysis.

## Proof

- Contracts, DB, and web focused suites passed; contracts/DB/web typechecks and
  lints passed during the tranche.
- Existing API, worker, connector, and migration gates remain unchanged; public
  sources stay disabled pending independent review.

## Follow-up

Keep the public leaderboard synthetic-only. Do not treat a successful
re-collection as restored history or public market coverage. Hosted PostgreSQL,
Temporal, provider operations, and source approvals remain external release
gates.

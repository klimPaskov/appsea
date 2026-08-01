# Explicit source re-collection completion report

Date: 2026-08-01

## Outcome

AppSea now has a reviewed, explicit tombstone-bound re-collection boundary.
After a completed source deletion, an authenticated private workspace member
may request exactly one source-native record. The path preserves the deleted
row, creates a new lineage-linked active observation, and remains separate from
automatic retries, analysis, reports, plans, and the public leaderboard.

## Implementation

- Migration `0050_explicit_source_recollection.sql` adds immutable tombstone
  lineage to research runs, source items, and production workflow projections;
  replaces the natural-key constraint with an active-row partial unique index;
  and adds completed-tombstone trigger guards.
- `@appsea/contracts` bounds tombstone requests to `limit: 1` in both gateway
  and workflow schemas, and exposes the lineage identifier in private status
  and result contracts.
- The CFPB connector supports the official exact complaint route and keeps the
  existing policy, consent, redaction, quota, and raw-payload boundaries.
- The worker runner, Temporal activity, persistence repository, workflow
  projection, and authenticated web gateway carry and verify the same
  identifier-only lineage.
- Private route, connector, workflow, worker, database, migration, and
  contract tests cover exact routing, hash identity, admission fail-closed
  behavior, missing tombstones, and lineage reads.

## Validation

- `@appsea/contracts`: 65 tests passed.
- `@appsea/connectors`: 17 tests passed.
- `@appsea/db`: 85 tests passed.
- `@appsea/worker`: 60 tests passed.
- `@appsea/web`: 74 tests passed.
- All affected package typechecks passed.
- Docker-backed PostgreSQL integration remains unavailable because the Docker
  Desktop Linux engine is not running; migration execution proof is therefore
  still a deployment/infrastructure blocker.

## Deliberate simplifications and remaining gaps

- CFPB remains disabled pending legal/privacy/security approval; this tranche
  does not claim a live source or market research.
- Re-collection is explicit and one-record only. No scheduler, quota recovery,
  deletion worker, or model may automatically fetch the record again.
- The path stores database lineage and redacted evidence but does not itself
  run downstream clustering, competitor research, scoring, report generation,
  or plan generation.
- Production PostgreSQL/Temporal provisioning, scheduler ownership,
  alerting, cloud object storage, backup purge, and signed desktop releases
  remain open.

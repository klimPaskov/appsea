# Source-quota reconciliation completion report

## Outcome

Settled source-quota reservations without a completed production result are
now durable, inspectable, and explicitly resolvable. The boundary remains
fail-closed: resolution never refunds quota, fabricates a result, or authorizes
an automatic source re-fetch.

## Changed surfaces

- `packages/contracts` validates bounded case, list, and resolution shapes.
- Migration `0049_source_quota_reconciliation.sql` adds a forced-RLS case
  projection plus security-definer list and maintenance-only resolve functions;
  identifier-only full-snapshot reconciliation reservations are excluded from
  this production-result case detector.
- `PostgresSourceQuotaRepository` discovers cases inside authenticated workspace
  transactions and resolves them only through the maintenance role.
- `GET /api/workspaces/:workspaceId/research/quota-reconciliation` exposes
  private, no-store inspection to workspace members.
- `apps/worker/src/source-quota-reconciliation-cli.ts` provides bounded inspect
  and explicit `linked_result`/`voided_no_result` operator actions.
- Runbooks, source-collection guidance, architecture/security notes, status,
  and project memory describe the boundary and remaining deployment work.

## Security review

- Case rows contain identifiers, bounded record/cost counters, timestamps, and
  fixed resolution metadata only; no raw source request, complaint text,
  idempotency key, or exception message is retained.
- The private route repeats membership authorization through the authenticated
  RLS transaction and returns `private, no-store` responses.
- Direct table access is revoked from both runtime and maintenance roles.
- Resolution requires the standalone `appsea_maintenance` session and, for a
  linked result, an exact completed production run matching the case.
- Imported source content cannot choose a resolution, modify code, or change
  policy. No source is activated by this slice.

## Validation

- contracts: 64 tests passed
- database package: 84 tests passed
- worker package: 58 tests passed
- web package: 71 tests passed
- affected package lint/typecheck passed
- Docker-backed PostgreSQL integration remains blocked before startup when the
  Docker Desktop Linux engine is unavailable.

## Simplifications and remaining gaps

- This slice does not refund quota, re-fetch automatically, or infer a missing
  result; operators must verify the run and choose a resolution code.
- The CLI is an operator boundary, not a hosted admin console.
- Deployment still needs scheduler ownership, open-case alert routing,
  production database role provisioning, and crash/failure drills.

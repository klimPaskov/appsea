# Complaint-analysis correction completion report

## Delivered

- Added the strict `complaintAnalysisCorrectionSchema` contract. Corrections
  can change only derived interpretation fields; source evidence, provenance,
  policy flags, redaction state, and derivation ownership remain immutable.
- Added migration `0061_complaint_analysis_corrections.sql` with forced-RLS
  immutable correction history, a guarded `corrected` review transition, and
  the authenticated `SECURITY DEFINER` correction function.
- Added prior/next snapshot hashes, actor identity, identifier/hash-only audit
  and outbox receipts, idempotent correction replay, active-evidence checks,
  and stale production-analysis/opportunity invalidation.
- Added repository and route handling, a compact private JSON correction editor,
  success/invalidation messaging, and active-output filters that hide stale
  report/plan projections.
- Passed the persisted corrected snapshots through the private analysis-input
  boundary so the next production artifact/report uses the reviewed fields
  instead of silently reclassifying the source text.

## Validation

- `pnpm --filter @appsea/contracts typecheck`
- `pnpm --filter @appsea/contracts test` (74 tests)
- `pnpm --filter @appsea/db typecheck`
- `pnpm --filter @appsea/db test` (105 tests)
- `pnpm --filter @appsea/web typecheck`
- `pnpm --filter @appsea/web test` (101 tests)
- `pnpm --filter @appsea/research typecheck` and test (8 tests)
- `pnpm --filter @appsea/worker typecheck` and test (75 tests)
- `pnpm agents:sync`, `pnpm memory:status`, and `pnpm repo:check --docs-only`
- `pnpm verify` (56 Turbo tasks, fixture/plan/analysis samples, web smoke)

Docker/PostgreSQL integration proof was not rerun because the local Docker
Desktop Linux engine is unavailable. The migration remains forward-only and
must pass `pnpm verify:persistence:fresh` in a provisioned PostgreSQL 18
environment before deployment.

## Deliberate simplifications and remaining gaps

- The editor uses a strict JSON boundary rather than a full field-by-field
  form. Automatic recomputation is not triggered; an owner/editor must start a
  new reviewed analysis after a correction.
- Source connectors remain policy-disabled. The public leaderboard remains
  sparse, database-free, and synthetic; no fixture output is presented as
  market evidence.
- Production database/Temporal provisioning, cloud object storage/backups,
  identity-provider/MFA, deployment alerting, workspace/export purge, and
  Windows/macOS release proof remain open.

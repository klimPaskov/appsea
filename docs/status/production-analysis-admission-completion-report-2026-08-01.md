# Production analysis admission completion report

Date: 2026-08-01

## Outcome

The reviewed private production-analysis start route now has a durable,
workspace-scoped admission boundary. It binds the authenticated owner/editor,
stores only an idempotency digest and workflow input hash, applies fixed
five-start/15-minute and two-active-job limits, and reserves a five-minute
initialization window before contacting Temporal. The worker consumes the
reservation in the same transaction as analysis-run creation and releases it
on terminal failure or completion. The requesting actor is immutable in the
analysis run and is copied into completion audit metadata. Consumed or
released digests replay without another admission slot; only an expired
reservation may be reclaimed.

## Changed surfaces

- Migration `0042_production_analysis_ingress_admission.sql` adds actor columns,
  forced-RLS admission/bucket tables, security-definer admission/consume/
  release/purge functions, actor immutability, and owner/editor membership
  checks.
- `@appsea/contracts` and `@appsea/workflows` carry the user/service actor and
  separate workflow input hash while keeping raw idempotency keys out of
  Temporal history.
- The private analysis route admits the prepared digest before Temporal and
  returns bounded `429`/`409` responses for rate, concurrency, and identity
  conflicts.
- The persistence repository consumes/releases admissions transactionally and
  fails closed when a user start has no active reservation. Service-owned
  handoffs and recomputation starts retain the explicit `appsea-worker` actor.
- Source maintenance purges stale analysis admissions and reports a bounded,
  secret-free `productionAnalysisAdmissionsPurged` counter.

## Validation

- `pnpm format:check`
- `pnpm --filter @appsea/contracts typecheck`
- `pnpm --filter @appsea/db typecheck`
- `pnpm --filter @appsea/workflows typecheck`
- `pnpm --filter @appsea/worker typecheck`
- `pnpm --filter @appsea/web typecheck`
- `pnpm --filter @appsea/contracts test` (62 tests)
- `pnpm --filter @appsea/db test` (67 tests)
- `pnpm --filter @appsea/workflows test` (20 tests)
- `pnpm --filter @appsea/worker test` (45 tests)
- `pnpm --filter @appsea/web test` (54 tests)

The PostgreSQL integration test covers admission, consumption, release, and
actor attribution. Repository tests cover replay mapping, rate/concurrency
decisions, malformed input, conflict handling, and purge. The integration
suite remains Docker-blocked in this environment because the Docker Desktop
Linux engine pipe is unavailable. Static migration assertions pass.

## Remaining gaps

This tranche does not provision production PostgreSQL or Temporal, add a
deployed scheduler, or prove multi-instance crash recovery. The direct source
CLI remains outside the authenticated web admission boundary. The CFPB source
is still disabled pending legal/privacy/security approval, and AppSea is not
being claimed production-ready.

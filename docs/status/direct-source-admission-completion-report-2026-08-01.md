# Direct source admission completion report

Date: 2026-08-01

## Outcome

The direct `pnpm worker:source:cfpb` command now uses the same bounded
production collection admission ledger as the authenticated web gateway. It
must establish the transaction-local `appsea-worker` service principal on the
`appsea_service` runtime role, target an active private non-fixture workspace,
and reserve/consume a digest-only admission before the external CFPB request.
The service path shares the five-start/15-minute and two-active limits and
rejects an existing workflow identity instead of racing or bypassing it.

The source policy remains disabled pending legal/privacy/security approval.
This change does not activate CFPB, authorize a new source, or change the
authenticated user admission path.

## Changed surfaces

- `packages/db/migrations/0051_service_production_workflow_admission.sql`
  extends the security-definer admission function with a worker-principal
  branch and preserves the runtime grant boundary.
- `packages/db` adds service admission and service consumption repository
  methods, migration checks, and a PostgreSQL integration assertion for the
  private/non-fixture and idempotency rules.
- `apps/worker` prepares the sanitized workflow admission identity in the
  direct CFPB command and consumes it inside the runner before collection.
  Expired admission fails closed and releases the source lease before any
  connector call.
- Source collection and architecture runbooks, status, plan, `START_HERE`,
  and project memory now describe the direct-command boundary.

## Validation

- `pnpm verify` passed: formatting, 14-package lint/typecheck/test/build,
  fixture/plan/analysis samples, web smoke, and repository validation.
- `pnpm --filter @appsea/db typecheck`
- `pnpm --filter @appsea/worker typecheck`
- `pnpm --filter @appsea/db test` (86 tests)
- `pnpm --filter @appsea/worker test -- production-cfpb-runner.test.ts` (62 tests)
- Docker-backed PostgreSQL integration remains required for migration, RLS,
  role, concurrency, and service-principal SQL proof; Docker Desktop's Linux
  engine is unavailable in this environment.

## Security review

- User and service admission ledgers remain separate from downstream analysis
  admission.
- The direct command stores only digests and input hashes; raw idempotency keys,
  source payloads, and complaint text do not enter the admission row or worker
  events.
- Service admission cannot target fixture, public, or inactive workspaces and
  cannot authorize source-policy activation.
- Deployment-level role separation, secret rotation, Temporal authorization,
  scheduler ownership, and legal/privacy/security approval remain release
  gates.

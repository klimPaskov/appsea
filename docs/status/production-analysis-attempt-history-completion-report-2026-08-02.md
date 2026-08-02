# Production-analysis attempt history completion report

Date: 2026-08-02

## Outcome

Migration `0056_production_analysis_attempt_history.sql` adds a bounded,
workspace-isolated history row for each production-analysis activity attempt.
The row records only server-observed start, last-heartbeat, finish, bounded
duration, heartbeat count, terminal state, and a fixed failure code. It does not
store source content, exception text, workflow hashes, object references, or
credentials.

The worker starts the record before reconstructing the artifact, sends
identifier-only Temporal and database heartbeats at reconstruction and
persistence boundaries, and closes the attempt as completed or failed. Retries
remain idempotent by `(workspace_id, analysis_run_id, activity_attempt)` and
the existing highest-attempt projection remains the compact status summary.

The private analysis status contract/API now includes at most ten attempt rows.
When Temporal is reachable, the web boundary best-effort merges the durable
history into the safe Temporal projection; when Temporal is unavailable,
PostgreSQL remains the source of truth. History is still membership-authorized
and covered by forced RLS.

## Validation

- `pnpm --filter @appsea/contracts test` — passed (72 tests).
- `pnpm --filter @appsea/db typecheck` — passed.
- `pnpm --filter @appsea/db test` — passed (97 tests).
- `pnpm --filter @appsea/worker typecheck` — passed.
- `pnpm --filter @appsea/web typecheck` — passed.
- The PostgreSQL integration test now exercises start, heartbeat, failed
  attempt, completed retry, idempotent terminal replay, and RLS-backed reads.
  It remains Docker-blocked in this environment because the Docker Desktop
  Linux engine pipe is unavailable.

## Security and scope

The migration uses forced RLS, a production collection-run lineage check,
immutable attempt identity, monotonic heartbeat guards, fixed failure codes,
least-privilege service grants, and no raw error persistence. This tranche does
not add periodic deployment alerting, automatic scheduling, production
Temporal provisioning, or source activation. Those remain external review and
operations gates.

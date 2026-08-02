# Research campaign refresh scheduler tranche

Date: 2026-08-02

## Outcome

AppSea now has a repository-level scheduled refresh boundary for strict,
non-synthetic research campaigns. `manual`, `daily`, `weekly`, and `monthly`
refresh policy values remain part of the campaign contract. Non-manual policies
persist a server-owned due timestamp on `research_campaigns`. The existing
lease-backed `source:maintenance` pass can claim one due campaign per bounded
batch with a crash-recoverable token, persist a deterministic run/workflow
identity, bind the validated production request, and use the existing policy
and production-admission gates before starting Temporal.

Claims are workspace-scoped, row-locked, skip-locked, and reclaimable after
their lease expires. Draft edits and archive transitions clear pending claims.
Admission limits and Temporal failures keep a pending request for a bounded
retry; unsupported or unapproved sources clear it and expose a fixed failure
code. The private campaign read model and page show manual/scheduled/
dispatching/failed state, next due time, and a bounded failure summary.

This tranche does not activate the CFPB connector, approve a source policy,
enable multi-source orchestration, or claim production scheduler/Temporal
availability. Imported source content remains untrusted and cannot change
code, skills, instructions, permissions, or repository memory.

## Changed surfaces

- `packages/contracts`: refresh policy/state/failure schemas and maintenance
  batch/result counters.
- `packages/db/migrations/0058_campaign_refresh_scheduler.sql`: due, claim,
  pending-request, attempt, failure, index, and least-privilege update fields.
- `packages/db/src/research-campaign-repository.ts`: schedule read model,
  workspace enumeration, claim/bind/dispatch/failure service methods, and
  lifecycle cleanup.
- `apps/worker/src/campaign-refresh-runner.ts`: bounded policy/admission/
  Temporal dispatcher with deterministic identity checks.
- `apps/worker/src/source-maintenance.ts` and `maintenance-runner.ts`: reuse
  the existing maintenance lease and emit bounded refresh counters; Temporal
  connects lazily only when a due refresh is actually dispatched.
- Private campaign page: refresh status is visible without changing the sparse
  public leaderboard.

## Validation

- Contract, database, worker, and web package typechecks pass.
- Contract, database, worker, and web package tests pass, including refresh
  policy/read-model, migration, runner success, policy denial, and admission
  retry cases.
- Full repository verification remains the final integration proof. Both
  `pnpm verify:persistence` and `pnpm verify:workflows` are environment-
  dependent; in this run Docker Desktop's Linux engine pipe was unavailable,
  so fresh PostgreSQL/Temporal integration and crash/retry proof remain open.

## Open follow-up

- Review and approve the external CFPB policy before enabling any source.
- Provision production PostgreSQL, Temporal, scheduler ownership, secrets,
  alerting, backup/deletion controls, and crash/failure drills.
- Add campaign pagination and reviewed multi-source orchestration. The
  registry-backed source picker is now delivered separately in the
  [`research-campaign-source-picker-completion-report-2026-08-02.md`](research-campaign-source-picker-completion-report-2026-08-02.md).

---
name: appsea-database-migration
description: Use when adding, repairing, reviewing, or validating AppSea PostgreSQL schemas, migrations, persistence repositories, RLS policies, or database roles.
---

# AppSea database migration

## Read first

- `AGENTS.md`
- `packages/db/AGENTS.md`
- `docs/adrs/0006-postgresql-persistence.md`
- `docs/runbooks/postgresql-local.md`
- `docs/architecture/security-boundaries.md`
- `memory/ACTIVE.md`

Use `appsea-contract-change` as well when stored or shared artifact shapes change. Use `appsea-security-review` when roles, grants, RLS, source policy, deletion, credentials, or deployment boundaries change.

## Allowed scope

This skill may change `packages/db`, directly affected contracts and producers, local/CI PostgreSQL infrastructure, tests, runbooks, architecture/status docs, and factual project memory. It does not authorize a production migration, role creation, credential change, deployment, retention change, or source activation.

## Procedure

1. Search existing migrations, constraints, repositories, contracts, tests, and decisions before designing a change.
2. Treat applied migrations as immutable. Use a new forward migration for shared or released history; only edit a migration proven to exist solely in a disposable development database.
3. Keep the no-login owner, migrator, and non-owner runtime roles separate. Grant the runtime only the table operations and update columns its reviewed workflows require.
4. Enforce workspace isolation with enabled and forced RLS. Set the workspace GUC only inside an authorized transaction and verify pooled connections fail closed after it ends.
5. Preserve immutable evidence, source policy, score, report, plan, audit, cost, and run-lineage history. Mutable current projections must retain explicit historical links.
6. Make cross-object ownership and run lineage database constraints, not repository conventions.
7. Gate source collection and evidence display against immutable approved policy metadata. Runtime paths may not override source kill switches.
8. Make idempotency safe under concurrent identical and conflicting starts. Preserve one run, one audit event, and one outbox event.
   For full-snapshot deletion reconciliation, keep staged data identifier-only,
   make page checkpoints immutable, and assert the source lease in the same
   transaction that compares active source items and enqueues tombstones.
   For authenticated downstream workflow starts, keep the admission ledger
   separate from source collection, store only digest/input-hash metadata,
   consume/release it in the same transaction as run persistence, and make the
   requesting actor immutable with an owner/editor membership check.
   For external object deletion, persist the complete workspace-bound object
   reference in a separate forced-RLS queue before invalidation commits; keep
   object marking/purge outside the database transaction and make claims,
   stale recovery, retention eligibility, and retries explicit.
   For durable dispatch queues, use `FOR UPDATE SKIP LOCKED`, PostgreSQL's
   clock for stale-claim eligibility, a bounded attempt limit, and a fixed
   terminal failure state for exhausted claims. Keep the downstream workflow
   identity deterministic so recovery cannot create a second run.
   For deletion propagation queues, retain the tombstone's immutable source
   identity and use a server-clock retry deadline plus a bounded attempt
   count. Recover stale processing claims, keep failed rows inspectable, and
   make exhausted failure metadata terminal through the trigger and grants;
   do not treat the first propagation exception as permanent deletion proof.
9. Add both a populated forward-upgrade test and a fresh-install test. Include negative privilege, RLS, policy, immutability, and cross-wire assertions.
10. Update the local runbook, source-of-truth docs, and memory in the same tranche.

## Validation

Run at minimum:

```bash
pnpm --filter @appsea/db lint
pnpm --filter @appsea/db typecheck
pnpm --filter @appsea/db test
pnpm verify:persistence:fresh
pnpm worker:fixture:persist
pnpm worker:fixture:persist
pnpm repo:check
```

`verify:persistence:fresh` deletes the repository's local Compose PostgreSQL volume. Use the non-fresh command when data must be retained, and record that the bootstrap path remains unverified.

## Failure behavior

Stop on migration-history drift, an ambiguous destructive target, missing role separation, an RLS gap, a policy-gate bypass, or unreconstructable legacy provenance. Do not weaken a constraint merely to make an upgrade pass. Record production provisioning and operational dependencies as explicit blockers.

## Completion proof

Report migrations and repositories changed, fresh and populated upgrade evidence, role/grant/RLS assertions, replay and concurrency results, documentation and memory updates, and every remaining production provisioning, deletion, workflow, or deployment gap.

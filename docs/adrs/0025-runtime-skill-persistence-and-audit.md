# ADR 0025: Persist runtime skill governance through an operator boundary

- Status: accepted
- Date: 2026-08-04
- Decision owners: AppSea repository maintainers

## Context

`packages/skill-registry` already creates and hydrates signed skill records in
memory, but a durable record and transition audit trail were missing. Persisting
plain JSON directly would allow copied or altered approval evidence to bypass
the registry, while granting the web, worker, or maintenance roles access would
turn a dormant governance contract into an autonomous permission path.

## Decision

Migration `0099_runtime_skill_governance.sql` adds global `runtime_skills` and
immutable `runtime_skill_events` tables with forced RLS. Only the migration
operator can execute security-definer persistence/read functions; direct table
privileges and function execution are revoked from service, maintenance, and
public roles. Persistence checks scalar identity, transition direction,
event-to-evidence actor binding, immutable permissions, and expected record
hashes. A privileged skill may become active only through an `operator:` actor.

`PostgresRuntimeSkillRepository` hydrates every input through `SkillRegistry`,
computes a canonical content hash, supports event-ID replay, and verifies the
hash and signed evidence again on read. The repository is an operator adapter;
no worker imports it, activates a skill, grants a permission, or activates a
source.

## Consequences

- Reviewed skill state and its transition history survive process replacement.
- Concurrent operator transitions fail closed instead of overwriting evidence.
- Service and maintenance credentials cannot inspect or mutate the global
  registry directly.
- An explicit operator identity and reviewed evidence are still required;
  persistence does not mean any skill is active.
- Provider identity, production deployment, and any future worker activation
  remain separate reviewed changes.

## Validation

- `pnpm --filter @appsea/db test`
- `pnpm verify:persistence:fresh`
- `pnpm verify:persistence`
- `pnpm repo:check --docs-only`

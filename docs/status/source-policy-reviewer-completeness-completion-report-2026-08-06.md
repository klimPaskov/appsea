# Source-policy reviewer completeness completion report — 2026-08-06

Status: repository tranche complete; public source activation remains blocked.

## What changed

- Migration `0115_source_policy_reviewer_role_completeness.sql` changes the
  source-policy review uniqueness boundary to retain one immutable approval per
  reviewer role and policy hash.
- The database derives the immutable reviewer-role set from policy metadata.
  CFPB and Stack Exchange therefore require `legal`, `privacy`, and `security`
  approvals for the same hash; legacy manual policies without the field retain
  the `independent_operator` default.
- Partial approvals are persisted as audit evidence while policy/source state
  remains `pending_review`/`disabled_pending_review`. Only the final declared
  role transitions the policy to `approved` and the source to `active`.
- Existing incomplete non-fixture activations are demoted during migration;
  fixture sources are unchanged. No third-party source is activated.

## Validation

- PostgreSQL's 57-test integration lifecycle proves the migration upgrade
  demotes an incomplete active policy, an undeclared role is rejected, missing
  permission evidence is rejected, one legal approval remains disabled, privacy
  remains partial, security activates the complete set, and replaying the final
  review is idempotent.
- `pnpm verify:persistence:fresh` passes through migration `0115`.
- `pnpm verify:backup-restore` passes through migration `0115`.
- Contract, connector, worker, database, formatting, repository, memory, and
  security checks remain green.

## Remaining boundary

This migration enforces the repository approval mechanics; it does not create
legal/privacy/security decisions, commercial permission, provider operation,
source activation authority, or public market coverage. CFPB and Stack Exchange
remain disabled until their external review and evidence gates are completed.

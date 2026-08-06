# Source-policy reviewer-role completion report — 2026-08-06

Status: repository tranche complete; third-party activation remains blocked.

## What changed

- `packages/contracts` now accepts an optional, unique `requiredReviewerRoles`
  policy field. Existing owner-import policies omit it intentionally.
- CFPB and Stack Exchange policy metadata declare the independent `legal`,
  `privacy`, and `security` roles. Their review manifests expose the same
  contract and remain pending/disabled.
- `packages/connectors` includes reviewer-role metadata in the immutable
  reviewed-policy comparison, so a connector cannot replace the reviewed role
  contract in memory.
- Migration `0114_source_policy_reviewer_roles.sql` adds a PostgreSQL
  security-definer approval trigger. It rejects a role not declared by the
  policy, validates declared role arrays, defaults legacy manual policies to
  `independent_operator`, and fails closed for other legacy policies.
- Integration tests prove that an `independent_operator` cannot approve the
  policy-declared legal/privacy/security fixture and that an allowed legal
  approval still activates the reviewed row. Existing manual and fixture
  paths remain covered.

## Validation

- `pnpm --filter @appsea/contracts test` — 113 tests passed.
- `pnpm --filter @appsea/connectors test` — 38 tests passed.
- `pnpm --filter @appsea/worker test` — 143 tests passed.
- `pnpm --filter @appsea/db test` — 182 tests passed.
- All affected package typechecks passed.
- `pnpm verify:persistence:fresh` — fresh PostgreSQL migration and integration
  lifecycle passed through `0114`.

## Remaining boundary

No source was activated and no external approval was inferred. CFPB still needs
independent legal/privacy/security and commercial-use review; Stack Exchange
also needs the written-consent or commercial-exception evidence required by its
policy. Hosted database, scheduler, provider deletion, and signed desktop
release evidence remain outside this repository tranche.

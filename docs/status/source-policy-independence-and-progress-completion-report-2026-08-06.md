# Source-policy independence and progress report — 2026-08-06

Status: complete for the repository tranche; external source approval and
deployment operations remain open.

## Delivered

- Migration `0116_source_policy_review_independence_and_collectibility.sql`
  rejects one canonical reviewer identity approving multiple roles for the
  same immutable policy hash and demotes active non-fixture rows that fail the
  complete-review invariant.
- The security-definer
  `appsea.source_policy_has_complete_reviews` helper requires every declared
  role, same-hash approval, independent attestation, required permission
  evidence, and distinct reviewer identities. Runtime source-registry,
  collection, campaign, reconciliation, owner-import, competitor, analysis,
  and health paths use that invariant.
- Migration `0117_source_policy_review_progress_read.sql` adds a
  migration/maintenance-role-only scalar read. It reports required, approved,
  and missing roles, permission-evidence state, completion, and collectibility;
  reviewer identities, notes, and approval references remain unavailable.
- Migration `0118_source_policy_collectibility_runtime_guards.sql` closes the
  remaining direct activation, lease replay/assertion, stale reconciliation
  claim, and production competitor/analysis lineage paths on the same helper.
  Existing active leases and queued/running reconciliation jobs that fail the
  invariant are revoked or terminalized with a fixed policy-denied result.
- `pnpm worker:source:policy:status` provides the bounded operator CLI. It
  never calls activation and emits only the parsed progress contract.
- Production Compose now blanks migration URL and role variables for every
  long-lived service. Preflight and migration retain the dedicated migration
  environment, and static release verification enforces the split.

## Proof

- `pnpm --filter @appsea/contracts test` — 114 tests passed.
- `pnpm --filter @appsea/db test` — 183 tests passed.
- `pnpm --filter @appsea/worker test` — 145 tests passed.
- `pnpm verify:persistence:fresh` — 59 PostgreSQL integration tests passed
  through migration `0118`, including same-identity rejection, populated
  upgrade demotion, wrong-hash progress, permission evidence, operator-only
  reads, final collectibility, and direct activation/lease/reconciliation
  fail-closed behavior.
- Compose static verification, release regression tests, and rendered config
  validation passed for migration-credential isolation.

## Remaining gates

CFPB and Stack Exchange remain disabled pending independent legal/privacy/
security/commercial approval. Production PostgreSQL/Temporal provisioning,
provider backup/restore, hosted scheduler ownership, and signed desktop
release evidence are not claimed.

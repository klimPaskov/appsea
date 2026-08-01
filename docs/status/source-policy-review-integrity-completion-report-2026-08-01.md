# Source-policy review integrity completion report — 2026-08-01

## Outcome

Source-policy activation now requires a canonical lowercase reviewer identity,
an allowed independent review role, and an explicit independence attestation.
The database rejects unattested and exact policy-owner self-approvals. Runtime
policy reads and production collection require an attested approved review.
The CFPB connector remains disabled pending external legal, privacy, security,
and deployment approval.

## Changed surfaces

- `packages/contracts`: strict operator approval input and reviewer-role
  contract with negative validation for uppercase identities and missing
  attestation.
- `packages/db`: migration `0054`, conservative legacy-approval backfill,
  integrity trigger, replaced operator approval function, and attested policy
  read/lineage queries.
- `apps/worker`: approval command now requires identity, role, and `true`
  independence attestation environment inputs.
- Integration fixtures and repository tests: explicit independent review
  metadata.
- Docs, ADR, plan, memory, source-policy runbook, and scoped guidance aligned.

## Validation

- `@appsea/contracts` tests: 67 passed.
- `@appsea/db` tests: 89 passed; lint and typecheck passed.
- `@appsea/worker` lint and typecheck passed.
- `pnpm format:check` passed after implementation.
- `pnpm verify` passed: 56 package tasks, fixture worker, report/plan samples,
  web smoke, and repository validation.
- `pnpm verify:persistence` was attempted and stopped before migration
  execution because the Docker Desktop Linux engine pipe is unavailable.
- Docker-backed PostgreSQL integration remains unavailable because the Docker
  Desktop Linux engine pipe is not running; trigger behavior, migration
  upgrade behavior, role grants, and concurrency still require that environment.

## Simplifications and remaining gaps

- Reviewer identity is an operator-supplied stable identifier; the repository
  does not implement an external identity provider or cryptographic signature.
- One approved review records one allowed review role; a future policy may
  require separate legal, privacy, and security approvals before activation.
- Exact policy-owner string matching prevents obvious self-approval but is not a
  substitute for an external independence registry.
- No source is activated and no legal or commercial-use conclusion is implied.

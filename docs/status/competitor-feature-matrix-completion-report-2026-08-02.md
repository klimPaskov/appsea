# Competitor feature matrix tranche — 2026-08-02

## Outcome

AppSea now carries an explicit competitor feature matrix from the shared
contract through normalized PostgreSQL persistence and the public/private
competitor routes. This is a reviewed fixture and seed-assumption slice, not a
claim of live competitor market coverage.

## Changed surfaces

- `packages/contracts` defines bounded feature entries with `supported`,
  `partial`, `missing`, or `unknown` status; explicit `fixture`,
  `reviewed-seed`, `source-observation`, or `mixed` evidence basis; bounded
  notes; and retained observation identifiers for source-backed entries.
- Production seed validation accepts only `reviewed-seed` matrix entries.
  Fixture catalog competitors are labelled synthetic and carry no source IDs.
- Migration `0063_competitor_feature_matrix.sql` adds a non-null JSONB matrix
  column and a 200-entry database shape guard. Fixture and production
  repositories write and read the matrix through the existing workspace/RLS
  boundary.
- Empty matrices retain the legacy competitor content-hash projection;
  populated matrices participate in immutable content identity.
- Existing opportunity seed-review digests also remain valid when their
  competitors have no matrix; populated matrices participate in new seed
  digests.
- Public and private competitor pages render a responsive, provenance-labelled
  matrix. The leaderboard remains unchanged and sparse.
- `schemas/competitor_feature_matrix_entry.schema.json` mirrors the persisted
  entry boundary for external contract review.

## Security and provenance

Raw provider payloads are not accepted in the matrix. Source-backed or mixed
entries must reference retained competitive observation identifiers, and the
existing independently approved `competitor-research` policy plus editor/owner
review gates remain in force. Imported content cannot write code, skills,
instructions, permissions, or repository memory. No connector was activated.

## Validation

The tranche includes contract, production-seed rejection, migration assertion,
hash-compatibility, catalog, and route-level build coverage. Targeted package
lint, typecheck, and tests pass. Full `pnpm verify` passed with 56 Turbo tasks,
fixture/plan/analysis samples, web smoke, formatting, and repository checks.
Fresh PostgreSQL and Temporal integration commands were attempted and remain
blocked by the unavailable Docker Desktop Linux engine pipe.

## Remaining gaps and simplifications

- No approved competitor-purpose live source exists in this repository, so
  source-backed feature rows remain an explicit future boundary.
- PostgreSQL fresh-install/populated-upgrade integration and durable workflow
  proofs still require a running Docker Desktop Linux engine; local unit tests
  cannot substitute for that deployment evidence.
- Matrix status is intentionally a bounded normalized claim, not an automated
  feature scraper or a universal competitor comparison.

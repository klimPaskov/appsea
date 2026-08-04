# Complaint deduplication provenance completion report — 2026-08-04

## Outcome

The complaint-analysis slice now records deterministic, provenance-linked
deduplication decisions. Safe source-native duplicates are removed, while
near-duplicate observations remain retained with a visible human-review state.
Legacy artifacts remain readable because the additive JSON field defaults to an
empty array.

## Changed surfaces

- `packages/contracts/src/index.ts` adds the versioned decision contract,
  artifact/report fields, cross-record validation, and private evidence read
  metadata.
- `packages/research/src/index.ts` adds normalized fingerprints, bounded token
  similarity, deterministic source-record handling, and artifact coverage-gap
  output.
- `packages/reports/src/index.ts` carries decisions into evidence reports and
  explains pending review.
- `apps/web/src/server/private-opportunity.ts` and the private evidence/report
  routes expose the review state without changing the sparse leaderboard.
- Contract, research, and report tests cover canonical, safe duplicate, near
  duplicate, replay, provenance, and legacy compatibility behavior.

## Validation

- `pnpm --filter @appsea/contracts test` — passed (102 tests)
- `pnpm --filter @appsea/research test` — passed (17 tests)
- `pnpm --filter @appsea/reports test` — passed (8 tests)
- `pnpm --filter @appsea/web test` — passed (190 tests)
- Package lint and typecheck checks passed for contracts, research, reports,
  and web.

## Simplifications and remaining gaps

- Similarity uses a deterministic token-Jaccard heuristic with a bounded
  candidate index; semantic paraphrase detection and author resolution remain
  unimplemented.
- Near-duplicate candidates are retained rather than merged automatically.
- No public connector was enabled and no fixture observation is presented as
  market research. External source approval, live calibration, production
  database/object-store operations, and hosted CI billing remain blockers.

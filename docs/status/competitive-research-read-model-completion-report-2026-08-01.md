# Competitive research read-model completion report — 2026-08-01

## Outcome

Private opportunity research now has a dedicated competitors/contrary-signals
route and a validated competitive-research coverage record. The page makes the
distinction between fixture records, human-reviewed opportunity seed
assumptions, and source-backed research visible to workspace members.

## Implementation

- `packages/contracts/src/index.ts` adds `competitiveResearchReadModelSchema`
  and `composeCompetitiveResearchReadModel`. Source-backed status requires
  non-synthetic data, permitted source identifiers, retained evidence
  identifiers, and an observation time. Reviewed seed-only status requires
  seed-review provenance.
- `packages/db/src/auth-repository.ts` and
  `apps/web/src/server/private-opportunity.ts` populate the read model for
  fixture and production-shaped private reads.
- `apps/web/src/app/workspace/[workspaceId]/opportunities/[slug]/competitors/page.tsx`
  renders research coverage, seed provenance, competitor relationships,
  weaknesses/strengths, related complaint categories, contrary signals, and
  visible gaps. The overview route links to the page.
- Production-shaped analysis artifacts add an explicit competitive-research
  coverage gap. No connector is activated by this change.

## Validation

- Contracts: 68 tests passed; typecheck passed.
- Web: 76 tests passed; typecheck passed.
- Research: 7 tests passed.
- Database package: 89 tests passed; typecheck passed.
- Existing competitor reference imagery was used as the visual reference. The
  new private route reuses the established sparse opportunity-page primitives;
  no public leaderboard content changed.

## Deliberate limits and remaining gaps

- Competitor records still originate from the reviewed seed contract. No live
  competitor directory, pricing, changelog, review, or contrary-signal source
  is connected, so production reads remain `reviewed-seed-only`.
- The read model preserves provenance state and coverage gaps but does not yet
  persist per-competitor source observations or a full competitor feature
  matrix.
- Docker-backed PostgreSQL integration remains environment-blocked when Docker
  Desktop's Linux engine is unavailable; repository tests do not replace that
  proof.

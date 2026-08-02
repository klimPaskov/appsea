# Competitive evidence observation completion report — 2026-08-02

## Outcome

Private opportunity research now retains one bounded, provenance-first
observation per competitive claim. Editors and owners can attach an existing
source-item/evidence pair through the private API and confirm or reject the
claim. Only a confirmed, non-synthetic observation can make the competitive
read model `source-backed`; fixture observations remain synthetic and never
become market evidence. The public leaderboard is unchanged.

## Implementation

- `packages/contracts/src/index.ts` adds strict observation, create, and review
  contracts. The competitive read model now includes observations and derives
  source/evidence IDs and observation time from confirmed non-synthetic rows.
- `packages/db/migrations/0059_competitor_research_observations.sql` adds a
  forced-RLS table with composite opportunity/competitor and source/evidence
  lineage, immutable claim fields, server-clock review transitions, and
  security-definer source-policy checks. Non-synthetic rows require an active
  source item collected under an independently approved
  `competitor-research` purpose and matching retained evidence.
- `packages/db/src/competitive-research-repository.ts` provides authenticated
  list/create/review operations. It returns source identifiers, source-native
  record IDs, capture/observation times, allowed representation, and review
  state without raw provider payloads.
- `apps/web/src/app/api/workspaces/[workspaceId]/opportunities/[slug]/competitor-observations/route.ts`
  and its observation review route expose the private read/write boundary with
  same-origin, membership, role, bounded-body, and policy-error handling.
- The private competitors page renders per-claim source/evidence provenance and
  review state. No leaderboard content or public market claim changed.

## Validation

- Contracts: `pnpm --filter @appsea/contracts test` — 72 tests passed.
- Database package: lint, typecheck, 103 tests passed, including migration
  assertions and repository boundary tests.
- Web package: lint, typecheck, and 100 tests passed, including the observation
  routes.
- PostgreSQL integration includes a fixture-backed observation policy/review
  test and migration history through `0059`; local execution remains blocked
  until Docker Desktop's Linux engine is available.
- `pnpm memory:status` and `pnpm agents:sync` pass. The UI reuses the existing
  opportunity reference primitives and now has the required
  `design/briefs/simple-interface.md` brief.

## Deliberate limits and remaining gaps

- No competitor or contrary-signal connector was activated. The existing CFPB
  source remains disabled and does not list `competitor-research`; a separately
  reviewed source policy is still required before any non-synthetic row can be
  created.
- The slice stores bounded paraphrases, not a full competitor feature matrix,
  pricing history, changelog, or live review directory.
- Review actions are owner/editor transitions; richer field correction,
  report regeneration from competitive observations, deployed scheduling,
  production PostgreSQL, and deployment security proof remain open.

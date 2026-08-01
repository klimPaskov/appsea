# Production output governance read completion report — 2026-08-01

## Outcome

Private production opportunity reads now preserve the current approval state of
the linked report and coding plan. A later review transition is visible on the
private report and plan pages; the mapper no longer substitutes `draft` and
`unreviewed` for every production output.

This is a read-model correction. It does not approve a report or plan, weaken
the existing owner/editor transitions, or change export authorization.

## Changed surfaces

- `packages/contracts` adds the strict
  `productionAnalysisGovernanceSchema` and requires it on
  `productionAnalysisReadModelSchema`.
- `packages/db` reads report and plan approval states from the workspace-bound
  governance projections alongside production analysis rows. Missing linked
  governance state fails closed as an unavailable analysis.
- `apps/web` maps those states into the private opportunity report and plan
  read models; the authenticated analysis route passes the model through.
- Contract, database package, and web route tests cover the bounded state
  contract and API pass-through.

## Security and policy review

- The state query stays inside the existing authenticated or workspace-bound
  PostgreSQL transaction and uses workspace-qualified report/plan identifiers.
- No complaint text, source payload, raw idempotency key, or approval actor is
  added to the read model.
- Report and plan export routes remain the authoritative approved-only gates;
  this change cannot promote an output.
- No source connector is activated and no retention, deletion, or role policy
  changes.

## Validation

- `pnpm --filter @appsea/contracts typecheck` passed.
- `pnpm --filter @appsea/db typecheck` passed.
- `pnpm --filter @appsea/web typecheck` passed.
- `pnpm --filter @appsea/contracts test` passed (66 tests).
- `pnpm --filter @appsea/db test` passed (86 tests).
- Docker-backed PostgreSQL/Temporal integration remains an environment gate;
  Docker Desktop's Linux engine is unavailable on this host.

## Remaining gaps

Production PostgreSQL/Temporal deployment, source-policy approval, cloud object
storage and backup purge, identity-provider approval, scheduler ownership, and
legacy v1 history draining remain open. This tranche does not claim production
readiness or live market research.

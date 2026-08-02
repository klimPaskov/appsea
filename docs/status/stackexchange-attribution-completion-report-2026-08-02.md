# Stack Exchange attribution-bound source tranche

Date: 2026-08-02
Status: implemented as a disabled, fixture-backed candidate; not production-ready

## Delivered

- Added the disabled `stackexchange-stackoverflow` policy draft and a
  policy-first connector using only the official Stack Exchange API v2.3
  `search/advanced` and exact question routes.
- Bounded requests to Stack Overflow, fixed the network site in code, enforced
  request/run quotas, capped response bytes, pinned the official HTTPS origin,
  minimized records to sanitized question title/body excerpts, and kept API
  keys runtime-only.
- Preserved stable source IDs, capture/publication times, and HTTPS canonical
  locators. Private evidence and competitor views render the locator as an
  attribution link; the public leaderboard remains unchanged.
- Added database migration `0060` so direct database writers cannot persist a
  non-HTTP(S) canonical locator that could later be rendered as a link.
- Added fixture-backed connector tests for policy disablement, HTML/script
  stripping, bounded query/exact-ID routes, quota behavior, attribution, and
  visible deletion/coverage gaps.

## Source-policy evidence

The policy draft links the official [Stack Exchange API Terms of
Use](https://engineering.stackexchange.com/legal/api-terms-of-use), the
official [advanced-search API contract](https://api.stackexchange.com/docs/advanced-search),
and Stack Overflow's [licensing guidance](https://stackoverflow.com/help/licensing).
The draft treats commercial use as restricted until an independent review
records the exact CC BY-SA/share-alike, attribution, retention, and report
display treatment.

## Validation

- `@appsea/connectors`: 22 tests, lint, and typecheck passed.
- `@appsea/contracts`: 73 tests, lint, and typecheck passed.
- `@appsea/db`: 103 tests, lint, and typecheck passed, including migration
  ordering and the `0060` constraint assertion.
- `@appsea/reports`: 8 tests, lint, and typecheck passed.
- `@appsea/web`: 100 tests, lint, and typecheck passed.
- `pnpm verify` passed: 56 Turbo tasks, fixture research, plan sample,
  production-shaped analysis sample, web smoke, formatting, and repository
  validation all passed.

## Blockers and deliberate simplifications

- The Stack Exchange policy is disabled and is not registered in the
  production source registry. The connector is not wired into the production
  worker runner, so it cannot create non-synthetic production evidence.
- Independent legal, privacy, security, deployment, quota-ledger, retention,
  deletion, attribution, and rollback review remains required before any
  activation. This engineering draft is not legal advice.
- Stack Exchange exposes no deletion tombstone feed to this connector. Search
  results and exact-question recollection therefore emit no tombstones and
  retain a visible coverage gap; absence is never treated as deletion proof.
- Docker Desktop's Linux engine is unavailable in this environment, so fresh
  PostgreSQL/Temporal integration proof remains a blocker.
- CFPB remains disabled as before. No source is represented as active market
  research, and fixture rankings remain explicitly synthetic.

This tranche improves the provenance and source-boundary contracts but does
not complete the broader AppSea production-readiness goal.

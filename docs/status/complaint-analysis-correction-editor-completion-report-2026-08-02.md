# Complaint-analysis correction editor completion report

Date: 2026-08-02

## Outcome

The private production evidence view now provides a structured correction
editor for every field allowed by `complaintAnalysisCorrectionSchema`:
classification, problem interpretation, severity and intent signals,
confidence values, privacy flags, and product/company/feature/substitute/
competitor entity references.

The editor maps list values deterministically, rejects malformed required or
bounded values before the request, and preserves entity evidence basis from the
stored snapshot. The API and database remain the authority; source text,
provenance, policy flags, redaction state, capture times, and derivation
metadata cannot be edited. Corrections still invalidate stale outputs and use
the deferred durable recomputation queue from migration `0062`.

## Changed surfaces

- `apps/web/src/app/workspace/complaint-correction-form.tsx` adds the field-level
  client editor and pure draft-to-contract mapping.
- `apps/web/src/app/workspace/production-complaint-review-actions.tsx` replaces
  the raw JSON textarea with the structured editor while retaining the existing
  authenticated review route and invalidation messaging.
- `apps/web/src/app/globals.css` adds responsive controls, entity cards, and
  visible focus states.
- `apps/web/src/app/complaint-correction-form.test.ts` covers round-trip
  mapping, list normalization, immutable metadata exclusion, and fail-fast
  validation.

## Security review

The existing same-origin, authenticated route and workspace role checks remain
the server-side boundary; the form adds no authorization path. The mapper
excludes source/policy/derivation metadata and retains entity evidence basis
from the stored snapshot. The API contract and repository correction function
still validate the complete payload, record immutable hashes, and enqueue only
the existing workspace-scoped repair path. No imported complaint text is
executed or written to repository guidance, skills, or memory.

## Validation

- `pnpm --filter @appsea/web lint`
- `pnpm --filter @appsea/web typecheck`
- `pnpm --filter @appsea/web test` (32 files, 107 tests)
- `pnpm format:check`
- `pnpm verify` (56 Turbo tasks, fixture/plan/analysis samples, web smoke,
  repository validation)

PostgreSQL and Temporal integration proof remains environment-blocked when
Docker Desktop's Linux engine is unavailable.

## Simplifications and remaining gaps

Entity evidence basis is intentionally read-only; changing it would alter
provenance rather than derived interpretation. The competitor feature matrix,
live competitor-purpose source approval, and production deployment controls
remain open. The public leaderboard remains sparse and synthetic.

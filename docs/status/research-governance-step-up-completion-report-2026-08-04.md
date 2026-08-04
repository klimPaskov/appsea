# Research-governance step-up completion report — 2026-08-04

Status: implemented and locally validated; AppSea remains not production-ready.

## Scope

This tranche closes the repository-owned gap where evidence-derived research
governance mutations had role and same-origin checks but no session-bound
password proof. The shared `requireRecentMutationStepUp` gate now runs
immediately before these private mutation repositories:

- report approval;
- coding-plan approval;
- opportunity-seed review transitions;
- production complaint review and derived corrections;
- competitor observation creation and review; and
- complaint-evidence redaction (refactored without changing its policy).

The gate requires the existing fifteen-minute password marker and the
conditional MFA marker. Missing or stale proof returns the existing bounded
`401`/`428` response. Imported content and request bodies cannot satisfy the
gate. Accounts without enabled MFA retain the reviewed password-only path.

## Implementation evidence

- `apps/web/src/server/auth-session.ts` owns the shared server-side gate.
- The six affected route families call it after strict input validation and
  before the mutation repository.
- Route tests cover stale password and stale MFA rejection without repository
  calls. The helper test covers absent cookies, password failure, MFA failure,
  and successful conditional compatibility behavior.
- ADR 0024 and the MFA runbook define the route set and deliberate boundary.

## Validation

- `pnpm --filter @appsea/web test -- ...` — 50 files, 189 tests passed (the
  package command runs the complete web suite, including all affected routes).
- `pnpm --filter @appsea/web typecheck` — passed.
- Prettier formatting and `git diff --check` — passed for the tranche.

Repository-wide verification remains required before integration. The hosted
GitHub Actions gate is currently unavailable because the repository account's
payments/spending-limit check prevents jobs from starting; this is an external
CI blocker, not a test failure.

## Remaining blockers and simplifications

- This slice does not invent a step-up contract for source-policy changes,
  deployment controls, provider operations, or other mutations that never had
  a password boundary. Those remain separately reviewed work.
- Provider-backed identity, delivery, live source approval, production
  PostgreSQL/Temporal/object storage, deployment operations, and signed desktop
  releases remain open. No source was activated and no synthetic fixture was
  presented as market research.
- No image assets were changed; this was a backend security tranche, so
  imagegen was not applicable and no Python geometry was used.

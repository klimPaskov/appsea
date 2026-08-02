# Research campaign run completion report - 2026-08-02

## Outcome

The private campaign configuration slice now has an authenticated production
collection start boundary. A workspace owner/editor can start a run from a
persisted campaign without supplying source, query, purpose, display mode,
limit, or budget overrides. The current workflow contract deliberately
supports exactly one non-synthetic source.

## Implementation evidence

- `packages/contracts` validates the run/idempotency envelope and exposes the
  approved source display mode in the campaign read model.
- `packages/db` derives source readiness from the active lifecycle and approved
  policy snapshot, not from an immutable draft flag.
- `apps/web/src/app/api/workspaces/[workspaceId]/campaigns/[campaignId]/run/route.ts`
  authenticates same-origin requests, reads the private campaign, checks state,
  source policy, approved purpose/display mode, expiry, budget, and optional
  seed-review approval, then admits before Temporal.
- The campaign page exposes a small start action and keeps pending policy as a
  visible readiness message.
- Route tests cover bounded input derivation, policy/display failures,
  multi-source rejection, approved-seed requirements, and admission error
  mapping without starting Temporal.

## Security and policy review

The route never activates a connector, accepts imported instructions, or writes
source content to logs or workflow history. It uses the existing workspace
authorization, RLS repository, digest-only admission ledger, and sanitized
Temporal start boundary. The CFPB connector remains disabled pending external
legal, privacy, and security approval.

Findings: no critical or high issue was identified in this boundary. The
Docker-backed persistence proof is a release blocker owned by deployment
operations, and CFPB policy activation remains an external legal/privacy/
security approval item. Neither blocker is bypassed by this route.

## Validation

- Contract tests/typecheck: passed.
- Database repository tests/typecheck/lint: passed.
- Web tests, typecheck, and lint: passed.
- `pnpm verify`: passed, including all package lint/typecheck/test/build
  checks, fixture/plan/analysis samples, web smoke, and repository validation.
- Deterministic UI references regenerated, including campaign desktop/mobile
  SVG sources; PNG export remains unavailable because local `cairosvg` is not
  installed.
- `pnpm verify:persistence`: blocked because the Docker Desktop Linux engine
  pipe is unavailable (`//./pipe/dockerDesktopLinuxEngine`).

## Deliberate simplifications and remaining work

This tranche does not implement multi-source fan-out, campaign edit/delete,
scheduled refresh, a registry picker, connector activation, or live market
research. Those remain separately reviewed work; a campaign with more than one
source fails closed rather than being silently reduced or fanned out.

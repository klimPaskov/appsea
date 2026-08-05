# Deep-research gate review UI completion report — 2026-08-05

Status: repository slice complete; production activation and source approval
remain blocked by the existing external policy and deployment gates.

## Outcome

The private opportunity competitors route now exposes the persisted deep-
research checklist instead of only showing a status and withdrawal control.
Editors can submit a reviewed checklist, owners can attempt promotion, and
owners can withdraw a passed gate. The route remains a governance surface for
private research; the public leaderboard is unchanged.

## Implementation

- `apps/web/src/app/workspace/deep-research-gate-actions.tsx` renders the
  twelve contract-defined checks, bounded notes, evidence-ID references, and
  role-specific transitions.
- `apps/web/src/app/workspace/[workspaceId]/opportunities/[slug]/competitors/page.tsx`
  passes the complete persisted gate into the client review surface.
- `apps/web/src/app/globals.css` adds responsive checklist, blocker, and form
  styles with visible focus states and a single-column mobile reflow.
- `apps/web/src/app/deep-research-gate-actions.test.ts` covers checklist
  initialization, defensive cloning, and evidence-ID normalization.

The browser remains a client for the existing same-origin API. Membership,
role, recent step-up, active analysis, object-backed artifact, retained source
evidence, snapshot hash, and database transition checks remain server-owned.
Incomplete checks, missing contrary evidence, stale snapshots, and disabled
sources cannot be promoted by this UI.

## Validation

- `pnpm --filter @appsea/web exec vitest run src/app/deep-research-gate-actions.test.ts src/app/deep-research-gate-routes.test.ts --reporter=dot`
  — 6 tests passed.
- `pnpm --filter @appsea/web test` — 53 files and 196 tests passed.
- `pnpm --filter @appsea/web typecheck` — passed.
- `pnpm --filter @appsea/web lint` — passed.
- `pnpm --filter @appsea/web build` — passed; the private gate API and pages
  remain in the production route manifest.
- `git diff --check` and targeted Prettier check — passed.

## Deliberate limits

- No source was activated, no policy was approved, and no fixture was relabeled
  as market evidence.
- No new bitmap/icon asset was needed for this interaction; existing reviewed
  product assets remain unchanged.
- A hosted browser capture is not claimed here because the production
  PostgreSQL/Temporal/object-store deployment is still external work.

## Remaining blockers

Independent legal/privacy/security approval for a public source, production
role-separated infrastructure, hosted Temporal and scheduler ownership,
provider-backed identity/delivery, object-store/backup deletion controls,
alert routing, billing, and signed desktop releases remain open. The local
Docker Linux engine was unavailable in this environment for fresh persistence
proof, as recorded in the active audit.

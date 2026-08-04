# Private workspace Usage page completion report — 2026-08-04

## Outcome

Private workspace members can now inspect persisted research cost totals and
settled source-quota reconciliation cases without receiving maintenance-role
mutation powers.

## Implementation

- `apps/web/src/app/workspace/[workspaceId]/usage/page.tsx` authorizes a
  private workspace member through the existing session boundary, reads the
  existing cost and reconciliation repositories, and renders exact currency-
  separated totals, estimated/actual split, and bounded case metadata.
- `apps/web/src/app/workspace/page.tsx` links the Usage route only for private
  workspaces; the public leaderboard remains unchanged.
- `apps/web/src/app/globals.css` adds responsive cards, metadata grids, focus-
  compatible links, and reduced-motion-compatible layout rules.
- `design/references/source/workspace-usage.svg` and its mobile companion
  define the deterministic reference hierarchy. They are hand-reviewed SVG
  sources; no Python geometry generator or decorative raster asset was added.

The page intentionally has no resolve, refund, re-fetch, or mutation control.
Quota resolution remains a dedicated maintenance-role operation, and each
repository query continues to enforce membership through the authenticated
workspace transaction.

## Validation

- `pnpm --filter @appsea/web lint` passed.
- `pnpm --filter @appsea/web typecheck` passed.
- `pnpm --filter @appsea/web test` passed, including page authorization,
  read-model rendering, and dependency-failure redaction cases.
- `pnpm ui:references` passed after adding the desktop/mobile SVG sources;
  PNG export remains dependent on optional local `cairosvg` availability.
- `pnpm docs:check` and `pnpm memory:check` passed.

## Deliberate limits and remaining gates

- Cost totals are ledger observations, not billing or spending authorization;
  currencies are never combined and no threshold action is taken in the page.
- Reconciliation is inspection-only. Production scheduler ownership, operator
  identity, source approvals, refunds, and re-fetch decisions remain external
  or maintenance-role controls.
- An authenticated desktop/mobile browser capture is not included in this
  command-only validation run; the route requires a live private session.
- No imagegen asset was used because this is a dense, text-first operational
  surface where decorative imagery would conflict with the sparse interface
  brief.

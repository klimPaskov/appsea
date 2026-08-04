# MCP agent-access UI completion report — 2026-08-04

## Outcome

Private workspace owners can now manage the existing, read-only MCP agent
access boundary from the website. The new page does not add write capability,
change token persistence, or weaken the existing password/MFA step-up checks.

## Implementation

- `apps/web/src/app/workspace/[workspaceId]/agent-access/page.tsx` adds an
  owner-only private route with an explicit read-only policy explanation.
- `apps/web/src/app/workspace/agent-access-actions.tsx` provides least-
  privilege scope selection, bounded expiry choices, metadata-only token
  listing, revocation, and a one-time copy action for the raw create response.
- `apps/web/src/app/workspace/page.tsx` links the page only for private
  workspace owners; the public leaderboard remains unchanged.
- `apps/web/src/app/globals.css` adds responsive, keyboard-visible focus and
  reduced-motion-compatible layout rules without decorative assets.
- `design/references/source/agent-access.svg` and its mobile companion define
  the deterministic reference hierarchy. The reference renderer validates and
  rasterizes these hand-reviewed sources when the optional local renderer is
  installed; no Python geometry generator or decorative icon was added.

The page calls the existing `/api/workspaces/:workspaceId/agent-tokens`
endpoints. Raw credentials are held only in client state after creation and
are never loaded by the list endpoint. The MCP endpoint remains bearer-only,
workspace-bound, read-only, and approval-gated for non-synthetic reports and
plans.

## Validation

- `pnpm --filter @appsea/web lint` — passed.
- `pnpm --filter @appsea/web typecheck` — passed.
- `pnpm --filter @appsea/web test` — 168 tests passed, including the owner/
  viewer page guard and existing token route security cases.
- `pnpm ui:references` — passed; 28 deterministic SVG references generated,
  with PNG export skipped because `cairosvg` is not installed in this
  environment.
- `pnpm docs:check` — passed after the documentation checkpoint.

## Deliberate limits

- This is a convenience UI over the existing token API, not a ChatGPT Sites
  deployment or an OAuth/MCP dynamic-client registration flow.
- Production HTTPS termination, rate limiting, secret-store integration,
  provider-backed identity/MFA, and deployment operations remain external
  gates.
- An authenticated desktop/mobile browser capture is not included in this
  command-only validation run; the private route requires a live owner session.
- No image asset was generated: this is a text-first security/settings surface
  and adding decorative imagery would conflict with the sparse product brief.

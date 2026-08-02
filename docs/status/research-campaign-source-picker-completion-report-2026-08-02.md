# Research campaign source picker completion report

Date: 2026-08-02

## Outcome

Private campaign create/edit forms now read the authenticated workspace source
registry and present a keyboard-accessible source allowlist. Selected IDs are
written back into the validated `campaign-v1` configuration; pending, expired,
revoked, fixture-only, and collectible states remain visible.

The picker is presentation-only. Drafts can name a pending source for planning,
but the existing server-side policy, purpose, quota, display, and admission
gates still decide whether a run can start. No connector activation or
multi-source orchestration was added.

## Changed surfaces

- `apps/web/src/app/workspace/campaign-actions.tsx` adds source selection and
  pure configuration helpers.
- `apps/web/src/app/workspace/[workspaceId]/campaigns/page.tsx` supplies the
  membership-authorized source registry to both forms.
- `apps/web/src/app/globals.css` adds responsive picker styles with visible
  focus states.
- `design/references/source/campaigns.svg` and its mobile source are regenerated
  from `scripts/render_references.py`.

## Validation

- `pnpm --filter @appsea/web lint`
- `pnpm --filter @appsea/web typecheck`
- `pnpm --filter @appsea/web test` (31 files, 104 tests)
- `pnpm ui:references`

Full repository verification remains required before release. PostgreSQL and
Temporal integration proof is still environment-blocked when Docker Desktop's
Linux engine is unavailable.

## Remaining gaps

Pagination, reviewed multi-source orchestration, live source activation, and
external legal/privacy/security approval remain open. The public leaderboard
stays sparse and synthetic.

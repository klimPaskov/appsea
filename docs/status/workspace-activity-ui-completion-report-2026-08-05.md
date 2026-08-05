# Workspace activity UI completion report

Date: 2026-08-05

## Outcome

The private workspace now exposes the existing audit-history contract at
`/workspace/:workspaceId/activity`. Members of private workspaces can inspect
bounded, cursor-paginated receipts for research and access changes without
receiving raw source payloads or mutation controls. The public leaderboard keeps
the same sparse contract while using the dark reference-system palette and
score-meter treatment.

## Implementation

- Added the server-rendered activity page at
  `apps/web/src/app/workspace/[workspaceId]/activity/page.tsx`.
- Added a private-workspace navigation link from
  `apps/web/src/app/workspace/page.tsx`.
- Reused `PostgresAuditEventRepository` and the existing
  `auditEventHistoryPageQuerySchema`; unsupported or repeated query parameters
  fail closed at the page boundary.
- Added responsive audit receipt styles in `apps/web/src/app/globals.css`.
- Added desktop/mobile hand-authored reference sources and reference-map wiring
  under `design/references/` and `scripts/render_references.py`.
- Aligned generated and hand-authored reference sources with the reviewed dark
  navy/violet/cyan visual system; the existing generated AppSea mark remains the
  only brand bitmap.
- Added `workspace-audit-page.test.ts` for authorization, bounded query parsing,
  pagination, generic dependency failure handling, and action formatting.

## Visual review

The production-built website was exercised locally at `localhost:3001` with
desktop (1440x1000) and mobile (390x844) captures treated as separate viewport
reviews; the mobile composition is not used at desktop width. The leaderboard,
opportunity overview, complaints, and competitor routes were opened and
inspected. Mobile tab overflow was corrected
by hiding the one-pixel vertical overflow on the horizontally scrollable
opportunity navigation. Body horizontal overflow stayed false on the mobile
competitor route; its feature tables remain intentionally scroll-safe inside a
bounded container.

The browser extension reported a React hydration warning caused by its injected
`data-swiftread-extension-automation-bridge-ready` attribute in development;
the production-built page had no AppSea console error. This is an external
browser-extension condition, not an application rendering branch.

No new decorative icon or generated bitmap was needed for this read-only audit
surface; the existing AppSea mark remains the only product brand asset.

## Validation

- `pnpm --filter @appsea/web exec vitest run src/app/workspace-audit-page.test.ts --reporter=dot`
- `pnpm --filter @appsea/web typecheck`
- `pnpm --filter @appsea/web lint`
- `pnpm --filter @appsea/web build`
- Chrome production visual review at desktop and mobile widths

## Deliberate limits and remaining blockers

This page does not create, approve, withdraw, export, purge, or otherwise
mutate audit records. The API, database membership/RLS boundary, server-side
scalar projection, and provider retention controls remain authoritative.
Hosted PostgreSQL, Temporal, object storage, external alerting, third-party
source approval, and signed desktop release evidence remain external production
gates. The fixture leaderboard and owner-import path remain clearly synthetic
or tenant-private and are not public market research.

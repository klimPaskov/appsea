# UI reference-loop completion report — 2026-08-06

## Outcome

The public reference-loop route is now canonical at `/leaderboard`. The root
route remains a backwards-compatible alias, and both routes render the same
database-free, synthetic-disclosed sparse leaderboard view.

The local capture workflow now runs the built web app on loopback and captures
the public leaderboard and opportunity detail routes at 1280, 1024, 768, and
480 pixels. Desktop captures use the desktop layout; only the 480-pixel case
uses the responsive layout. A narrow-header overflow found in the 480 capture
was fixed by constraining the mobile navigation and presenting the sign-in
action as an accessible compact icon while retaining its text label in the
HTML. The authenticated capture workflow now uses the disposable local
PostgreSQL/Temporal/MinIO stack, creates an isolated owner session, and captures
the private workspace and account-security routes without using the user's
browser. A read-only transaction lock bug found by that capture was fixed, and
the mobile password step-up form now collapses to one column.

## Evidence

- `artifacts/ui-reference-loop/2026-08-06/leaderboard-1280.png`
- `artifacts/ui-reference-loop/2026-08-06/leaderboard-1024.png`
- `artifacts/ui-reference-loop/2026-08-06/leaderboard-768.png`
- `artifacts/ui-reference-loop/2026-08-06/leaderboard-mobile.png`
- `pnpm ui:capture` generated the full five-route × four-viewport set under
  `.appsea/ui-reference-loop/` during this review.
- The persisted public set now includes
  `artifacts/ui-reference-loop/2026-08-06/public-capture-manifest.json`; all
  20 public captures passed the same scalar runtime/title/main/overflow audit.
- `pnpm ui:capture:private` generated the nine-route × four-viewport private set
  under `artifacts/ui-reference-loop/2026-08-06/` against the local stack. The
  manifest uses a `<workspaceId>` placeholder and contains no session cookie or
  real workspace identifier. Every capture passed the scalar browser audit:
  no explicit runtime-error page, missing title/`<main>`, or horizontal overflow
  at 1280, 1024, 768, or 480 pixels.
- `pnpm exec vitest run scripts/capture_ui_reference.test.mjs` passed the
  route and viewport contract checks.
- `pnpm --filter @appsea/db test -- auth-repository.test.ts` passed after adding
  the read-only external-identity regression coverage; the local private
  capture passed all routes and viewports without a Next runtime error.
- `pnpm smoke:web` now checks both `/` and `/leaderboard` plus the existing
  opportunity, complaint, competitor, and plan routes.

The first audit implementation was corrected after a local run showed that a
hidden Next development portal is present on healthy pages. The final guard
matches only the error dialog or explicit error-page text, so it does not treat
the normal development portal as a failure.

## Contract and accessibility decisions

- The leaderboard still contains only minimal navigation, rank, opportunity,
  complaint count, score, and the synthetic fixture disclosure. Reference
  artwork that contains category, momentum, confidence, or promotional panels
  is not copied into the product because the repository contract keeps the
  public page single-purpose.
- Opportunity research remains on separate detail routes.
- The sign-in action remains keyboard and screen-reader discoverable; its
  compact mobile presentation is CSS-only and does not rely on color alone.
- Imported content is not used to generate markup or styles.

## Remaining gap

The local authenticated screenshot/compare loop is complete for the current
website routes. Signed Windows/macOS installers, hosted-origin review, and
provider-backed deployment evidence remain separate release gates; this local
capture does not claim those controls or public market research coverage.

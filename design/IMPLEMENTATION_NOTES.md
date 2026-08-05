# Implementation notes for coding agents

## Reference-first loop

1. Implement the route with production components and deterministic fixtures.
2. Capture desktop at 1440 × 1000.
3. Capture mobile at 390 × 844.
4. Compare structure, spacing, typography, density, color balance, and responsive transformation.
5. Fix the largest differences first.
6. Repeat until the route matches the intended character.
7. Test keyboard navigation, contrast, screen-reader labels, text scaling, and reduced motion.

## Route rules

- `/leaderboard` contains only the ranked list and small heading area.
- Opportunity, complaints, competitors, and plan stay separate.
- The private competitors route keeps deep-research governance in a compact
  checklist panel above competitive evidence. Editors may submit a reviewed
  checklist; only owners may pass or withdraw promotion. Keep the checklist
  keyboard-complete, explicit about blockers, and visually subordinate to the
  evidence sections.
- Private report and coding-plan routes place a small governance panel beside
  each generated artifact. Editors can mark an artifact reviewed, owners can
  approve or withdraw it, viewers remain read-only, and plan readiness is shown
  before an approval attempt. The approval API and database remain authoritative
  for linked-report and export constraints. Hand-authored `artifact-approval`
  SVG references cover the desktop and mobile interaction; no decorative icon
  asset is needed for this control.
- Workspace member settings may contain owner-only lifecycle controls. Keep
  archival in the existing calm risk-block pattern, require visible step-up
  state, and explain retained lineage versus destructive purge in text.
- Do not repeat the full research report on every screen.
- Desktop and mobile use the same data contract even when presentation differs.

## Dark reference system

- The checked-in reference sources and the website share the near-black navy canvas, layered navy surfaces, cool blue-gray text, violet/cyan accents, and restrained glow treatment shown by the reviewed PNG references.
- The public leaderboard keeps the product contract intentionally sparse: rank, opportunity name, complaint count, score, and a synthetic-fixture disclosure. Reference-only category, momentum, confidence, and decorative icon columns are not product fields and remain omitted.
- The existing generated AppSea mark remains the only brand bitmap. No decorative icon asset is required for the leaderboard or private activity surface.

## Suggested components

`AppHeader`, `PageHeading`, `Surface`, `ScoreBar`, `StatusBadge`, `SourceFilter`, `LeaderboardTable`, `LeaderboardCardList`, `ComplaintList`, `CompetitorTable`, `CompetitorCardList`, and `PlanSection`.

## Image boundary

Use reviewed icons, approved brand assets, and real copy. The references may contain generated icon or text artifacts. Treat them as layout and visual-direction targets only.

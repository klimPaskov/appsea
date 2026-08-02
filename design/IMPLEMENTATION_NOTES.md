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
- Workspace member settings may contain owner-only lifecycle controls. Keep
  archival in the existing calm risk-block pattern, require visible step-up
  state, and explain retained lineage versus destructive purge in text.
- Do not repeat the full research report on every screen.
- Desktop and mobile use the same data contract even when presentation differs.

## Suggested components

`AppHeader`, `PageHeading`, `Surface`, `ScoreBar`, `StatusBadge`, `SourceFilter`, `LeaderboardTable`, `LeaderboardCardList`, `ComplaintList`, `CompetitorTable`, `CompetitorCardList`, and `PlanSection`.

## Image boundary

Use reviewed icons, approved brand assets, and real copy. The references may contain generated icon or text artifacts. Treat them as layout and visual-direction targets only.

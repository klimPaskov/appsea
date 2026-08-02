# AppSea dark responsive UI references

Version 5 combines the five dark desktop references with five matching mobile layouts. It also includes the higher-resolution mobile source exports, responsive implementation guidance, route mapping, and integrity manifests.

## Route map

| Route                                  | Desktop                                     | Mobile                                             | Purpose                        |
| -------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ------------------------------ |
| `/leaderboard`                         | `design/references/desktop/leaderboard.png` | `design/references/mobile/leaderboard.png`         | Ranked app opportunities only  |
| `/opportunities/:slug`                 | `design/references/desktop/opportunity.png` | `design/references/mobile/opportunity.png`         | Focused opportunity summary    |
| `/opportunities/:slug/complaints`      | `design/references/desktop/complaints.png`  | `design/references/mobile/complaints.png`          | Curated complaint evidence     |
| `/opportunities/:slug/competitors`     | `design/references/desktop/competitors.png` | `design/references/mobile/competitors.png`         | Competitor comparison          |
| `/opportunities/:slug/plan`            | `design/references/desktop/plan.png`        | `design/references/mobile/plan.png`                | Coding-agent build plan        |
| `/account/security`                    | `design/references/desktop/security.png`    | `design/references/mobile/security.png`            | Private session review         |
| `/workspace/:workspaceId/seed-reviews` | `design/references/source/seed-reviews.svg` | `design/references/source/seed-reviews-mobile.svg` | Private reviewed seed registry |
| `/workspace/:workspaceId/campaigns`    | `design/references/source/campaigns.svg`    | `design/references/source/campaigns-mobile.svg`    | Private campaign configuration |

Desktop references use 1440 × 1000. Normalized mobile references use 390 × 844. Original 853 × 1844 mobile exports are under `design/references/mobile/source/`.

## Main interface rule

Every route has one primary job. The leaderboard contains the heading and ranked list only. Do not add an opportunity preview, chart, research feed, source summary, activity panel, metric dashboard, or side rail.

## Coding-agent workflow

1. Read `VISUAL_DIRECTION.md`, `MOBILE_BEHAVIOR.md`, `DESIGN_TOKENS.md`, and `IMPLEMENTATION_NOTES.md`.
2. Implement one route using deterministic seeded data.
3. Capture it at 1440 × 1000 and 390 × 844.
4. Compare hierarchy, spacing, type, density, surface depth, and responsive transformation.
5. Correct the largest differences first.
6. Verify keyboard access, contrast, focus states, text zoom, and reduced motion.
7. Record intentional deviations.

The images are design references. Do not copy malformed generated icons, uncertain brand marks, or accidental image text into production.

The seed-review reference remains deterministic SVG source until the local
`cairosvg` renderer is available; the renderer always writes the source and
will add PNG exports on the next full reference pass.

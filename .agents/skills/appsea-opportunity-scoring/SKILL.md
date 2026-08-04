---
name: appsea-opportunity-scoring
description: Use when changing opportunity factors, weights, penalties, calibration, ranking, or score explanations.
---

# AppSea opportunity scoring

The scoring source of truth is `packages/scoring`.

## Rules

- Scores are deterministic and versioned.
- Store factor values, weights, penalties, calculation time, and score version.
- Models may suggest factor values with evidence, but code calculates the final score.
- Complaint volume is deduplicated evidence, not raw mentions.
- Evidence quality and coverage gaps affect confidence.
- Contrary evidence reduces the score explicitly.
- Build feasibility must reflect the first wedge, not a hypothetical full platform.
- The balanced v1 envelope uses reviewed seed inputs for its five positive
  dimensions and six bounded risk penalties; it must not infer independent
  users, source diversity, velocity, or confidence from complaint text.
- Keep legacy `score` as the raw-score compatibility field. Use `rankingScore`
  for private ordering when a v1 snapshot is present; never silently redefine
  historical `.score` semantics.
- Every v1 snapshot retains evidence snapshot ID, coverage, freshness,
  confidence, uncertainty, profile/model version, and component explanations.

## Procedure

1. Define the decision the score supports.
2. Add or change factors only with a clear meaning and measurable input.
3. Calibrate against a labeled set of opportunities.
4. Test monotonic behavior and edge cases.
5. Version any change that can reorder the leaderboard.
6. Preserve historical snapshots.
7. Explain large rank changes.
8. Persist nullable v1 fields additively and keep the public fixture leaderboard
   on its existing database-free contract until an approved source-backed
   publication projection exists.

Do not tune weights to force a preferred idea to the top.

## Completion

The same inputs produce the same result, the ranking is explainable, historical scores remain interpretable, and calibration evidence is documented.

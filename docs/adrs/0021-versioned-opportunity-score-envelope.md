# ADR 0021: Preserve legacy scores while adding the balanced v1 envelope

- Status: accepted
- Date: 2026-08-04
- Owner: main coding agent

## Decision

AppSea keeps the fixture and historical `opportunity-score-v0.2.0` snapshot
shape unchanged. Production analysis may opt into the reviewed-input
`opportunity-score-v1.0.0` balanced profile through an additive
`balancedScoreInput` seed envelope.

The v1 scorer owns the deterministic calculation from the scoring specification:
positive demand, pain, market-opening, business-quality, and execution-quality
dimensions are weighted to a 0..100 raw score; bounded source/legal and market
risk penalties are subtracted; evidence confidence produces an uncertainty
margin; and the persisted `rankingScore` is the risk-adjusted score less that
margin. `score` remains the raw-score compatibility alias and is never silently
changed to ranking semantics.

Every v1 snapshot stores its profile/model version, evidence snapshot identifier,
coverage/freshness summaries, reviewed positive/risk/confidence inputs, and
component-level explanations. Each factor explanation now also carries an
explicit `source-evidence` or `reviewed-seed` binding; source bindings must
match retained complaint evidence at production analysis validation, while
reviewed-seed bindings remain visibly non-market assumptions. Complaint text
and deterministic complaint classification cannot invent these reviewed market
signals. Seeds without the v1 envelope continue through the legacy path and
receive a visible coverage gap. The binding details are defined in
[`0027-score-factor-provenance.md`](0027-score-factor-provenance.md).

PostgreSQL migration `0096` adds nullable queryable v1 columns and a ranking
index. Legacy rows remain valid; v1 rows must provide the complete envelope.
Reports carry the unchanged snapshot and expose raw, risk-adjusted, ranking, and
confidence semantics in their rationale. The public leaderboard remains the
database-free synthetic fixture projection until an approved source-backed
publication path exists.

## Consequences

- Replays are version-specific and tamper-detectable without rewriting old rows.
- Private workspace ordering can use `COALESCE(ranking_score, score)` while
  legacy fixture displays retain their existing raw score.
- Profiles beyond balanced, calibration/benchmark evidence, and live source
  activation remain separate reviewed work.

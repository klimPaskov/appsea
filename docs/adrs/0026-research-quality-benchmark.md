# ADR 0026: Keep research-quality calibration synthetic and versioned

- Status: accepted
- Date: 2026-08-04

## Decision

AppSea records deterministic research-pipeline quality checks as a versioned,
immutable `research-quality-v1.0.0` snapshot. The checked-in benchmark is
synthetic, redacted, and reviewed-input-only. It covers classifier/entity
labels, duplicate and cluster grouping, duplicate injection/source ablation,
reviewed ranking labels, and bounded probability calibration. Artifact and
report snapshots retain the benchmark/evaluator/content hashes and explicit
`sourceCoverage: not-derived` provenance.

## Rationale

Quality regression evidence is useful before a permitted live connector is
activated, but a fixture corpus cannot establish market demand or calibrate a
source. Making the boundary explicit prevents perfect fixture metrics from
being presented as real research and lets later source-backed evaluation use a
new reviewed benchmark version without changing old artifacts.

## Consequences

- The benchmark can fail closed on imported/non-fixture cases and its hashes
  make replay deterministic.
- Reports can show quality warnings alongside evidence, inference, and
  recommendation without changing the sparse leaderboard.
- Live calibration, evidence-bound score-factor derivation, semantic
  near-duplicate handling, and source-backed competitor research remain later
  reviewed work; no source activation is implied.

# 2026-08-04 research quality benchmark

Implemented the deterministic `research-quality-v1.0.0` synthetic/redacted
benchmark and optional artifact/report quality snapshots.

## Changed

- Added bounded benchmark, ranking-case, and quality-snapshot contracts with
  explicit synthetic, reviewed-input-only, and `sourceCoverage: not-derived`
  provenance.
- Added the checked-in eight-case corpus and deterministic evaluator for
  classification/entity labels, duplicate and cluster pair metrics, purity,
  duplicate injection, two-source ablation, reviewed ranking labels, ECE, and
  Brier score. Benchmark and snapshot hashes are replayable.
- Added pure scoring calibration/ranking helpers and report/artifact exposure.
- Updated ADR, plan, status, audit, memory, generated artifacts, and tests.

## Proof

`pnpm verify`, affected package tests/lint/typecheck, `pnpm security:audit`,
`pnpm memory:check`, and `pnpm docs:check` pass. The latest hosted workflow is
blocked before repository steps by the GitHub account payment/spending-limit
gate, not a repository assertion.

## Resume / remaining

The benchmark is regression evidence only. No public source is activated and no
live calibration, factor-level score evidence binding, cloud purge, provider
deployment, or signed desktop release is claimed. Resume with independent
source approvals and provider/deployment evidence, then add source-backed
quality evaluation as a separately reviewed benchmark version.

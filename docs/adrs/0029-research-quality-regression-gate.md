# ADR 0029: Versioned research-quality regression gate

Status: accepted (2026-08-05)

## Context

AppSea already computes a small synthetic, redacted research-quality snapshot.
Those metrics detect deterministic drift, but callers had no bounded contract
that said whether the checked-in benchmark still met its reviewed floors. A
passing fixture benchmark must not be confused with live source calibration or
market evidence.

## Decision

Add an additive `research-quality-gate-v1.0.0` object to quality snapshots.
The gate records explicit thresholds, a `pass`/`fail` status, and bounded
failure descriptions. The evaluator checks classifier accuracy, complaint-type
accuracy, high-impact entity wrong-link rate, deduplication F1, clustering F1,
ranking top-k precision, and expected calibration error. The thresholds and
comparison direction are owned by the versioned TypeScript evaluator, while
the shared contract validates the serialized result.

The worker command `pnpm research:quality` prints the benchmark/evaluator/gate
versions, metrics, and gate as deterministic JSON and exits non-zero on a
failed gate. The root `pnpm verify` command runs it. Private report routes show
the gate status when a report carries a quality snapshot; the public
leaderboard remains unchanged and sparse.

`qualityGate` is optional so existing artifact and report JSON remains readable.
The gate is a synthetic regression safeguard only. It never authorizes a source,
derives coverage, estimates unique authors, calibrates live traffic, or turns
reviewed inputs into market evidence.

## Consequences

- Pipeline changes that regress the checked-in labels fail the deterministic
  quality command and are visible in private report detail.
- Threshold changes require a new gate version and reviewed documentation.
- A future live calibration program remains a separate policy, data, and
  evidence decision; this ADR does not claim production readiness.

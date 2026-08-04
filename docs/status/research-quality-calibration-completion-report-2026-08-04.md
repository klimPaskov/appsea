# Research quality and calibration v1

Status: repository slice complete; this is synthetic regression evidence, not
market research or production calibration.

## What changed

- `packages/contracts` now defines bounded benchmark-case, benchmark-corpus,
  ranking-case, and immutable quality-snapshot contracts. Snapshots are marked
  synthetic, reviewed-input-only, and `sourceCoverage: not-derived`.
- `packages/research/src/quality-benchmark.ts` adds a small checked-in corpus of
  redacted synthetic labels covering duplicate/repost behavior, classification,
  entity abstention, clustering, two-source ablation, and reviewed ranking
  labels. It computes deterministic benchmark and snapshot hashes.
- `packages/scoring` adds pure expected-calibration-error, Brier-score, and
  top-k ranking helpers with bounded deterministic tie-breaking.
- Production and fixture research artifacts include the optional quality
  snapshot. Generated reports expose it in both the top-level report metadata
  and deterministic inference section while keeping the warnings visible.

## Validation

- `pnpm --filter @appsea/contracts test` — 99 tests passed.
- `pnpm --filter @appsea/research test` — 12 tests passed.
- `pnpm --filter @appsea/scoring test` — 8 tests passed.
- `pnpm --filter @appsea/reports test` — 8 tests passed.
- Affected package lint and typecheck passed.
- The snapshot replay test proves stable benchmark/content hashes for a fixed
  evaluator timestamp; the schema tests reject non-synthetic and source-derived
  provenance.

## Interpretation and limits

The corpus contains no imported complaints, source URLs, personal data, or
market observations. Perfect or imperfect metrics only describe the current
deterministic rules against these deliberately small labels. They do not
measure live source quality, unique authors, semantic near-duplicates,
competitor research, source coverage, score-factor provenance, or market
demand. The balanced opportunity score remains a reviewed-input checkpoint;
factor-level evidence binding and derived coverage are still open.

This slice does not activate CFPB, Stack Exchange, or any other third-party
source, and it does not change authentication, deployment, retention, billing,
Temporal authorization, or desktop release status.

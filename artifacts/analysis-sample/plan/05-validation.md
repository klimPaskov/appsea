# Validation plan

## Contract tests

- approved non-fixture policy and redacted complaint payloads parse
- synthetic or unredacted production observations fail closed
- source IDs, native record IDs, query routes, and policy display modes remain aligned

## Research tests

- normalization and duplicate replay preserve source identifiers
- cluster memberships are complete, unique, and reproducible
- missing source access remains a visible coverage gap

## Product tests

- competitor and contrary-evidence fields come from reviewed inputs
- deterministic score replay produces the same snapshot and package hash
- report separates observation, inference, recommendation, and uncertainty

## Security and operations

- imported text is rendered as inert data
- restricted display modes do not leak excerpts
- retention, deletion, budgets, retries, and failure recovery remain testable

## Completion proof

Report files changed, source-policy evidence, tests, transport mode, generated hashes, known limits, and every simplification.


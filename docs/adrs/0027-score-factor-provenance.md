# ADR 0027: Bind balanced score factors to explicit provenance

- Status: accepted
- Date: 2026-08-04
- Owner: main coding agent

## Decision

Every factor in the reviewed-input `opportunity-score-v1.0.0` envelope carries
an explicit factor key, provenance basis, and one or more identifiers. The
supported bases are `source-evidence` and `reviewed-seed`.

`source-evidence` bindings must reference retained complaint evidence IDs at
the production analysis boundary. `reviewed-seed` bindings must use the
immutable seed-review prefix and are displayed as reviewed assumptions, never
as source evidence. The root evidence snapshot remains available for coverage
and freshness context, but it is no longer reused as the evidence reference
for every explanation.

The v1 snapshot persists the complete factor-binding map and each component
explanation records the binding basis and IDs. The JSON explanation column is
the durable storage for the full envelope; no additive PostgreSQL column is
needed. Replay reconstructs the exact binding map before comparing the
deterministic snapshot.

## Consequences

- A v1 score cannot silently claim that one broad snapshot proves every factor.
- A source-backed factor cannot point at an unretained or unrelated record.
- Current reviewed seed inputs remain usable, but their non-market provenance
  stays visible and separate from future permitted source evidence.
- Read-only workspace inspection keeps pre-provenance v1 seed rows readable;
  strict new-write and analysis admission paths require a replacement revision
  before those rows can drive a new analysis.
- Legacy v0.2 snapshots and fixture leaderboard behavior remain unchanged.
- Future seed revisions must carry the complete factor map; changing a binding
  changes the immutable seed content hash and score snapshot hash.

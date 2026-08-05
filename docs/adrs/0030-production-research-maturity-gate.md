# ADR 0030: Keep production opportunities at candidate until deep research is proven

- Status: accepted
- Date: 2026-08-05
- Owner: main coding agent

## Decision

Production analysis is a candidate-producing workflow. A production opportunity
may use the `researched` lifecycle state only after an explicit deep-research
gate has been recorded and the read boundary can show source-backed competitive
research with a current valid gate. The gate record and checklist are defined
by [ADR 0031](0031-deep-research-gate.md). The current disabled source registry
means new production rows still resolve to `candidate`.

Fixture opportunities remain synthetic and keep their existing fixture
`researched` state so the regression path remains useful. The private
competitors route and coverage fields continue to show reviewed seed assumptions
separately from permitted market evidence.

## Implementation

- `resolveOpportunityStateForRead` fails closed when a production row is
  persisted as `researched` without the gate signals.
- Production analysis persistence writes `candidate`.
- Migration `0100_research_maturity_gate.sql` repairs already-persisted
  non-synthetic `researched` projections while leaving synthetic rows intact.
- The deep-research gate remains a separate reviewed handoff; this change does
  not activate a source or invent competitor, contrary-signal, unique-author,
  or market evidence.

## Consequences

Private APIs, MCP opportunity reads, and opportunity routes cannot overstate a
seed-only analysis as researched. The gate persists the reviewed dimensions,
audit/outbox proof, and snapshot staleness checks; broader search workflows,
production provisioning, and independent source-policy approval remain
separate blockers.

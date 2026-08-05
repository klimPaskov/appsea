# ADR 0030: Keep production opportunities at candidate until deep research is proven

- Status: accepted
- Date: 2026-08-05
- Owner: main coding agent

## Decision

Production analysis is a candidate-producing workflow. A production opportunity
may use the `researched` lifecycle state only after an explicit deep-research
gate has been recorded and the read boundary can show source-backed competitive
research with no unresolved coverage gaps. The current production analysis
artifact does not carry that gate, so new and legacy non-synthetic rows resolve
to `candidate`.

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
- The future deep-research package must supply the gate evidence; this change
  does not activate a source or invent competitor, contrary-signal, unique-
  author, or market evidence.

## Consequences

Private APIs, MCP opportunity reads, and opportunity routes cannot overstate a
seed-only analysis as researched. A future researched transition needs a
reviewed contract for the deep-research dimensions in the product
specification, plus persistence, audit, and regression proof. Production
provisioning and independent source-policy approval remain separate blockers.

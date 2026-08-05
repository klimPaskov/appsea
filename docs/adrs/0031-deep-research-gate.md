# ADR 0031: Persisted deep-research readiness gate

- Status: accepted for the first production tranche
- Date: 2026-08-05
- Owners: AppSea maintainers

## Decision

AppSea persists an append-only `deep_research_gate_reviews` record for each
private production opportunity review. The record stores only a versioned
checklist, compact source/evidence/observation identifiers, the analysis
snapshot hash, coverage gaps, and identifier-only audit/outbox metadata.

The gate is separate from the lighter `source-backed` competitive read. A
source-backed observation proves that one permitted claim exists; it does not
prove contrary evidence, substitute coverage, author independence, copied
content influence, policy-risk review, or reproducibility. The gate evaluator
therefore derives deterministic blockers from the current production artifact
and active confirmed observations, while a human supplies the bounded review
checklist.

Only an owner may pass or withdraw the gate. Editors may submit a not-ready
review with bounded notes; pass and withdraw actions carry no mutable notes.
A passed row must bind to a completed, active, non-synthetic production
analysis, at least one active confirmed non-synthetic observation with retained
evidence, a confirmed contrary signal, and workaround or do-nothing coverage.
The read repository recomputes the snapshot hash; changes to the analysis,
source deletion state, retained evidence, or confirmed observations produce a
`stale` read state. Coverage gaps remain visible after a pass and are not
interpreted as universal source coverage.

The opportunity lifecycle resolver promotes a production row to `researched`
only when the current private read is source-backed and the current gate is
passed. Fixture rows remain synthetic and retain their fixture lifecycle.

## Consequences

- The app can show a precise readiness blocker instead of silently treating a
  generated report or reviewed seed as deep research.
- The gate cannot activate a source, create market evidence, or replace legal,
  privacy, security, provider, or deployment approval.
- The current environment still cannot pass a production gate because the
  approved competitor-purpose source and contrary-signal evidence are not
  enabled. That is an intentional visible gap, not a synthetic success.
- Deep-research report/package generation and unique-author estimation remain
  later slices; this record is the reviewed handoff boundary for them.

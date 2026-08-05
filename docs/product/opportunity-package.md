# Opportunity package

Each ranked opportunity has separate routes for:

- overview
- evidence and source coverage
- competitors and workarounds
- evidence-backed report
- coding plan

A generated coding-agent package contains:

- package README
- product brief
- MVP scope
- architecture direction
- dependency-aware task graph
- validation and acceptance plan

Production seed reviews must declare the canonical six-file manifest in the
shared contract: `README.md`, `01-product-brief.md`, `02-mvp-scope.md`,
`03-architecture.md`, `04-task-graph.json`, and `05-validation.md`. The
boundary rejects missing, duplicate, or unsupported paths before an approved
seed can start analysis, so a malformed plan cannot fail later inside a worker.
Previously stored portable-path seed rows remain inspectable for migration
planning, but they are rejected at analysis admission until replaced.

Claims in the package must point back to evidence or state that they are inference. The fixture generator writes a complete sample under `artifacts/plans/`.

Evidence observations include a versioned derived-analysis record with
classification, severity, recurrence, switching signals, entity confidence,
and unresolved market dimensions. It is an inference checkpoint with explicit
review state; it never substitutes for source provenance or separately
reviewed competitor research.

The private competitors route exposes the attached relationship records,
contrary signals, and per-claim observations with a validated competitive-
research coverage state. Fixture records are synthetic/unresolved, production
seed values are reviewed-seed-only, and source-backed status requires a
confirmed non-synthetic observation with permitted source/evidence identifiers
and an observation time. Reviewed seed values are never presented as market
research. Migration `0059` keeps observation claims bounded and human-
reviewable; it does not activate a source or copy raw provider payloads.

Fixture report versions are deterministic and keep retained observations,
versioned score inference, contrary evidence, recommendation, coverage gaps, and
source-policy metadata distinct. They are not market research and do not imply
coverage from disabled sources.

Production-shaped analysis artifacts now use the same evidence/inference/
recommendation separation and can produce a generic report and coding package
from a validated offline payload. They carry `testOnly` transport metadata when
composed without a live persisted collection; this checkpoint is not a market
research result and does not replace durable storage, review, or source
activation.

Production opportunities remain in the `candidate` lifecycle state until the
explicit deep-research gate passes. Reviewed seed values, complaint analysis,
and a generated report are not sufficient to mark an opportunity `researched`;
the private read boundary fails closed for legacy rows that predate this gate.

The deep-research gate is an append-only, owner-reviewed checklist bound to a
completed production analysis snapshot. It records only compact source,
evidence, observation, competitor-relation, and snapshot-hash provenance. The
evaluator blocks promotion when confirmed contrary evidence, workaround or
do-nothing coverage, complaint-review state, copied-content/author review,
policy-risk review, or reproducibility is missing. A changed analysis,
source/evidence deletion, or changed confirmed observation marks a previously
passed gate stale. Coverage gaps remain visible after a pass; the gate never
means universal source coverage. Editors may submit a not-ready review, while
only owners may pass or withdraw one through the step-up-protected private API.

Private report versions move through `draft` → `reviewed` → `approved` (or
`withdrawn`). Owners may approve or withdraw a report; owners and editors may
mark a draft reviewed. The database records each transition as an
identifier-only audit/outbox receipt. The private export route returns the
validated report read model only after approval and keeps the report's manifest
hash and synthetic disclosure attached.

Production analysis reads carry the linked report and plan approval states from
their PostgreSQL governance projections. Private opportunity pages therefore
show the actual current state (including after a later approval transition)
instead of inferring `draft` or `unreviewed` from the immutable object payload.
The report and plan export routes remain the authoritative approval gates.

## Lifecycle decisions

Private editors and owners can record a bounded reason to watch, reject, or
archive an opportunity; only an owner can approve a planned, source-backed
opportunity after its current deep-research gate, report, and plan gates pass.
Each decision is append-only, idempotent, stale-state protected, and linked to
the current source-run evidence identifiers and analysis lineage. The Overview
route renders the decision history and requires recent password/MFA step-up for
mutations. Archived opportunities cannot be reopened in this tranche. Fixture
opportunities remain read-only and visibly synthetic, and the MCP surface stays
read-only.

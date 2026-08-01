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

Claims in the package must point back to evidence or state that they are inference. The fixture generator writes a complete sample under `artifacts/plans/`.

Evidence observations include a versioned derived-analysis record with
classification, severity, recurrence, switching signals, entity confidence,
and unresolved market dimensions. It is an inference checkpoint with explicit
review state; it never substitutes for source provenance or separately
reviewed competitor research.

The private competitors route exposes the attached relationship records and
contrary signals with a validated competitive-research coverage state. Fixture
records are synthetic/unresolved, production seed values are reviewed-seed-only,
and source-backed status requires permitted source identifiers, retained
evidence identifiers, and an observation time. Reviewed seed values are never
presented as market research.

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

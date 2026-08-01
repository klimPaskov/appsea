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

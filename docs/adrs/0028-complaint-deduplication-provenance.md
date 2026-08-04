# ADR 0028: Provenance-linked complaint deduplication decisions

- Status: accepted
- Date: 2026-08-04
- Scope: complaint analysis artifacts, private evidence reads, and opportunity reports

## Decision

Complaint analysis emits an additive `deduplication` array in the validated
research artifact and opportunity-report JSON. Each decision carries the
versioned algorithm identifier, source/native record lineage, optional
production evidence/source-item references, canonical complaint identity,
relationship, similarity, and an explicit decision state.

The deterministic v1 implementation automatically removes only a repeated
source-native record. It may also remove normalized-exact text when the same
source provides the same canonical locator. Distinct source records with high
token-Jaccard similarity (threshold `0.9`, bounded to 64 indexed candidates)
remain retained and are marked `review-required`. The candidate relationship
is visible in private evidence and report views. It never becomes an author
count, and it does not infer that two observations came from different people.

The field is stored inside the existing validated JSONB artifact snapshot, so
no relational migration is required. Legacy artifacts parse with
`deduplication: []` and remain readable. New artifact builders include one
canonical decision per retained complaint plus decisions for dropped native
duplicates; production decisions keep evidence and source-item references.

## Rationale and limits

This preserves replayability and the original observation lineage while
avoiding a false merge based only on similar wording. The bounded token index
is intentionally conservative and can miss semantically similar complaints
with little token overlap. Human review, semantic author handling, source
policy approval, and live calibration remain separate work.

## Consequences

- Reports and private evidence inspection can explain why an observation was
  retained, deduplicated, or held for review.
- Coverage gaps explicitly call out pending near-duplicate review.
- Existing PostgreSQL rows and object-store payloads do not need backfill.
- Any future automatic merge must introduce a reviewed algorithm version and
  preserve the same provenance and deletion/redaction boundaries.

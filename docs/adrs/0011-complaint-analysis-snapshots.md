# ADR 0011: Persist derived complaint-analysis snapshots

- Status: accepted
- Date: 2026-08-01

## Decision

AppSea stores deterministic complaint classification and entity-resolution
output as a validated `analysis_snapshot` on each complaint observation. The
source complaint and evidence identifiers remain immutable; a derived
snapshot carries its extraction, skill, model, and prompt versions plus human
review state. Explicitly framed outcomes, consequences, workarounds, and user
hints are retained only when bounded source text supports them.

The snapshot resolves only what the retained source fields support. Products,
companies, and features can be exact or normalized matches. A bounded
source-context extractor may resolve a substitute or competitor name only when
the complaint explicitly labels that name (for example, a quoted alternative
or a delimiter-bound `competitor:` value); those references carry
`source-context` evidence and `contextual` resolution. Unmentioned dimensions
remain unresolved. These complaint-level mentions never make a competitive
relationship source-backed: that still requires a separately reviewed
`competitor-research` stage with permitted evidence.

## Rationale

The previous persistence path stored a few classifier-shaped columns but the
research artifact and private evidence views could not inspect classification
confidence or entity ambiguity. A versioned JSONB snapshot keeps the derived
observation auditable without rewriting source evidence or pretending that a
missing lookup is a negative market signal.

## Consequences

- Fixture and production-shaped artifacts must contain one analysis per
  retained complaint.
- Migration `0053_complaint_analysis_snapshots.sql` adds the snapshot column
  and upgrades historical run snapshots conservatively.
- The deterministic rules are a checkpoint, not a claim of model-quality
  classification. Reviewer correction and richer model/entity enrichment are
  still separate work.
- Private evidence, collection, reports, and coding packages can show the
  analysis confidence and unresolved market dimensions.

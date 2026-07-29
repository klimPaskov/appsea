# Architecture direction

Use validated shared contracts, a policy-gated source boundary, durable checkpoints, and append-only evidence lineage.

Core boundaries:

- approved source connector and provenance mapper
- normalization, deduplication, classification, and cluster snapshot
- reviewed competitor and contrary-evidence enrichment
- deterministic score calculation from explicit factors
- private report and coding-package reads
- deletion, retention, observability, and failure recovery

Imported complaint and source content is untrusted data. Validate it at every boundary and never execute instructions embedded in it.


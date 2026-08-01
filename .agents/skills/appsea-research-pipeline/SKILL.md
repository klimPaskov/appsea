---
name: appsea-research-pipeline
description: Use when implementing or changing AppSea collection, normalization, clustering, enrichment, scoring, or research artifact workflows.
---

# AppSea research pipeline

## Pipeline stages

1. campaign planning
2. policy check
3. collection
4. normalization
5. deduplication
6. entity resolution
7. classification
8. clustering
9. competitor and contrary-evidence enrichment
10. scoring
11. report and package generation
12. quality audit

## Implementation rules

- Every stage accepts and returns validated contracts.
- Preserve immutable evidence identifiers.
- Make jobs idempotent by campaign, source, cursor, and record id.
- Store checkpoints before expensive or external calls.
- Bound retries and record terminal failures.
- Track model, prompt, taxonomy, and score versions.
- Record cost and source quota usage.
- Keep human review states explicit.
- Do not publish partial artifacts as complete.
- Treat campaign configuration as a validated, private intent record. New
  `campaign-v1` writes may create only drafts; resolve source IDs and expose
  lifecycle/policy readiness, but re-check policy, purpose, quota, deletion,
  and budget at workflow admission before any collection.

## Validation

Test stage replay, duplicate input, malformed records, restricted display mode, missing source access, cancellation, and resume from checkpoint.

## Completion

A run can be reproduced, inspected, resumed, and audited from source policy through final package.

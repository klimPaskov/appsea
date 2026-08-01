---
name: appsea-complaint-analysis
description: Use when normalizing, deduplicating, classifying, clustering, or curating complaint evidence.
---

# AppSea complaint analysis

## Procedure

1. Validate provenance and permitted representation.
2. Normalize whitespace and obvious formatting without changing meaning.
3. Detect exact duplicates, reposts, quoted copies, and near-duplicates.
4. Preserve links from clusters to every retained observation.
5. Classify product, company, feature, problem category, user role, severity signal, and workaround signal.
6. Separate symptoms from root-problem hypotheses.
7. Keep clusters narrow enough to guide a product response.
8. Record cluster confidence and ambiguity.
9. Route sensitive or identifying content through redaction.
10. Sample clusters manually before using them in scoring.
11. Persist a versioned `complaintAnalysisSchema` snapshot for every retained
    complaint before reports or opportunity scoring consume derived fields.
12. Keep substitutes and competitors empty unless supported by explicit
    evidence; record unresolved entity types instead of inferring them.

A cluster must not merge different jobs merely because they mention the same product. A complaint count must not count copies as independent demand.

## Validation

Use labeled fixtures for deduplication and cluster boundaries. Review false merges and false splits.
Validate analysis coverage, derivation version, entity confidence, and explicit
unresolved states for every retained complaint.

## Completion

Each cluster has a clear title, summary, observation ids, unique count, source count, confidence, and unresolved ambiguity. Each retained complaint also has a
replayable, provenance-linked analysis snapshot; synthetic fixtures remain marked
as synthetic and unresolved entity types remain visible.

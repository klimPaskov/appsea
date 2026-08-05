# Complaint-cluster review

AppSea keeps deterministic complaint clusters as versioned analysis evidence,
then asks a workspace editor or owner to curate the boundary before deep
research can pass. The private Evidence route shows the bounded cluster label,
problem statement, product/category candidates, complaint and source counts,
membership identifiers, current review state, and review history.

Review actions are `confirm`, `reject`, `split`, and `merge`. Confirm and reject
update the current cluster and all of its memberships in one transaction. Split
and merge record related cluster-version identifiers as lineage; this first
slice does not invent new versions or silently redistribute complaints. Every
write includes the current cluster input hash, an idempotency key, a bounded
review note, and an identifier-only snapshot. Raw complaint text, author
identity, and imported instructions never enter the review ledger.

Fixture clusters are visible for orientation and explicitly read-only. A
non-synthetic cluster with a provisional, split, merged, or rejected state
blocks the deep-research gate; only a current `reviewed` or `confirmed` state
can satisfy the cluster-review requirement. Privacy redactions mask narrative
cluster fields in private read projections while preserving provenance and
immutable analysis lineage.

# ADR 0016: Controlled Temporal legacy-history drain

- Status: accepted
- Date: 2026-08-03

## Context

The identifier-only production-analysis workflow is now `v2`, but histories
created by the earlier `v1` input shape can contain complaint-bearing data.
Temporal visibility does not provide a safe reason to decode those arguments,
and removing the old worker before those executions are accounted for can make
running work unrecoverable.

## Decision

New production-analysis starts write a strict, non-sensitive memo identifying
`production-analysis-v2` and `historyClass: identifier-only`. AppSea provides a
bounded visibility-only checker and a validated operator manifest. The checker
classifies tagged v2 executions as safe, treats unknown metadata as legacy-risk,
requires a reviewed retention or drain disposition for every visible legacy
execution, and exits non-zero for unresolved, expired, or truncated results.

The checker never fetches workflow history, prints arbitrary memo values,
cancels or terminates executions, deletes Temporal history, or activates a
source. Archive/deletion and namespace retention remain explicit deployment
operations with their own approval and audit evidence.

## Consequences

- Future v2 histories can be audited without reading complaint text.
- Old histories remain recoverable while an approved retention manifest says the
  v1 worker is still required.
- A deployment cannot silently remove the v1 worker based on an incomplete scan.
- The repository still cannot claim a production Temporal drain until an
  authenticated deployment runs the checker and completes the external
  archive/deletion procedure.

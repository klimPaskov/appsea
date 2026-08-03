# Temporal legacy-history drain safety completion report — 2026-08-03

Status: repository safety boundary implemented. This does not claim that a
production Temporal namespace has been drained or that AppSea is production-
ready.

## Delivered

- New production-analysis `v2` starts write a strict, non-sensitive memo that
  identifies the identifier-only history class.
- Added a validated legacy-history manifest contract with unique workflow/run
  entries, explicit approval references, retention deadlines, and drained vs
  retained dispositions.
- Added `pnpm worker:workflow:analysis:history:check`, a bounded visibility-only
  checker that never fetches history or logs arbitrary memo content. It fails
  closed for unclassified executions, missing/expired dispositions, drained
  executions still visible, and truncated scans.
- Added the operator runbook and ADR 0016.

## Validation

- Contract tests cover the safe memo, manifest deadline rules, and duplicate
  entries.
- Worker tests cover v2/legacy/unknown classification, fail-closed output
  redaction, reviewed retention, and invalid manifest handling.
- Workflow client tests prove the v2 memo is the only history metadata added by
  the start boundary.

## Remaining deployment gate

Run the checker against the authenticated production Temporal namespace, retain
the v1 worker for any reviewed legacy histories, complete separately approved
archive/deletion, and rerun until the result is `clear`. The repository does
not perform that destructive operation automatically.

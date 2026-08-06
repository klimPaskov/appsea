# Campaign date-window enforcement completion report

Date: 2026-08-06

## Outcome

The campaign `dateRange` field is now an enforced, provenance-visible input to
production collection. It is carried from authenticated campaign starts and
scheduled refresh/orchestration dispatch through sanitized Temporal input,
worker activity reconstruction, connector requests, and the immutable
collection snapshot. The field is additive, so historical snapshots without a
window remain replayable.

## Source semantics

- CFPB maps the inclusive bounds to the official `date_received_min` and
  `date_received_max` calendar filters. CFPB `date_received` remains an
  intake date and is not written as `publishedAt`.
- Stack Exchange maps the inclusive bounds to the official `fromdate` and
  `todate` question-creation filters. The candidate remains disabled pending
  its independent policy and permission review.
- Owner imports filter by normalized `publishedAt`, falling back to
  `capturedAt`, before applying the run limit. The active owner-import path is
  tenant-private and is not public market coverage.
- Fixture collection applies the same contract to its synthetic publication
  timestamps and retains the synthetic disclosure.

Every filtered result emits a bounded coverage warning. Exact tombstone-bound
re-collection does not apply a campaign window and says so explicitly; filtered
results never imply deletion absence.

## Evidence

Implementation and tests:

- `packages/contracts/src/index.ts`
- `packages/workflows/src/client.ts`
- `packages/workflows/src/workflows.ts`
- `apps/worker/src/campaign-refresh-runner.ts`
- `apps/worker/src/campaign-orchestration-runner.ts`
- `apps/worker/src/production-workflow-activities.ts`
- `apps/worker/src/production-cfpb-runner.ts`
- `packages/connectors/src/index.ts`
- `packages/connectors/src/manual-import.ts`
- `packages/db/src/production-collection-repository.ts`
- `packages/connectors/src/connectors.test.ts`
- `packages/contracts/src/contracts.test.ts`
- `packages/workflows/src/workflows.test.ts`

Targeted checks passed on 2026-08-06:

- `pnpm --filter @appsea/connectors test` (37 tests)
- `pnpm --filter @appsea/contracts test` (112 tests)
- `pnpm --filter @appsea/workflows test` (31 tests)
- contracts, connectors, workflows, db, worker, and web typechecks

Repository-wide verification and local UI capture passed before the tranche
was committed: `pnpm verify` passed all repository, fixture, plan, quality,
smoke, release-boundary, and documentation checks, and `pnpm ui:capture`
reported 20 desktop/mobile captures with no runtime errors or horizontal
overflow. No third-party source was enabled by this change.

## Remaining gaps

The date window does not turn a source into a representative sample, does not
provide deletion evidence, and does not close the external CFPB or Stack
Exchange approval gates. Provider deployment, scheduler ownership, and hosted
recovery evidence remain external release requirements.

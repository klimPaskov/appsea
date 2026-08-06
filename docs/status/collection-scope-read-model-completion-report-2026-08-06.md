# Collection scope read-model completion report

Date: 2026-08-06

## Outcome

The authenticated completed-collection result now returns the query and a
validated inclusive source-date range copied from the immutable collection
snapshot. Historical snapshots without `dateRange` are normalized to an
explicit unbounded `{ from: null, to: null }` read value; no source payload or
caller secret crosses the boundary.

The private evidence-inspection page renders that scope beside source coverage
gaps and collection warnings. A user can therefore distinguish an unbounded
run from a date-filtered run without interpreting records outside the window
as evidence of absence.

## Evidence

- Contract: `productionCollectionResultSchema` requires `query` and
  `dateRange`.
- Persistence: `resultFromRun` copies both fields from the immutable snapshot
  and defaults legacy snapshots to an unbounded range.
- UI: `/workspace/:workspaceId/research/:runId` renders query and normalized
  window in its collection-status section.
- Tests: contract, repository, workflow, worker, and private API route tests
  cover the new fields and legacy-compatible unbounded reads; the local-stack
  smoke now asserts the rendered `Collection scope` section.
- Visual proof: `pnpm ui:capture:private` completed 36 authenticated local
  captures across desktop widths and a separate responsive check, with every
  audit reporting `status: ok`; the dynamic collection route was also rendered
  and checked by the local-stack smoke. No public leaderboard content was
  added.

## Scope and remaining gaps

This is a private provenance/read-model improvement. It does not activate a
source, make owner imports public market research, add broad competitor search,
or change deletion/reconciliation semantics. CFPB and Stack Exchange remain
disabled pending independent review, and hosted deployment, provider purge,
and signed desktop release evidence remain external gates.

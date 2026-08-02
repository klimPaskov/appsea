# Research campaign run history completion report - 2026-08-02

## Outcome

Private workspace members can inspect the latest production collection runs
for a campaign and follow a completed run into source evidence and coverage.
The read path reuses the existing PostgreSQL production workflow projection;
it does not create a second job ledger or expose workflow secrets.

## Implementation evidence

- `packages/contracts` defines `researchCampaignRunReadModelSchema` with bounded
  state, checkpoint, source/policy identifiers, counters, and timestamps.
- `packages/db` lists at most 100 campaign-scoped production workflow rows in
  an authenticated workspace transaction and omits idempotency/input hashes,
  actor details, and payloads.
- The private runs API returns the safe projection for non-fixture workspaces.
- The campaign page renders recent runs with status and completed-evidence
  links; the workflow status page reads the same projection and shows only
  operational fields.
- Completed runs continue to use the existing policy-filtered collection page
  for evidence, coverage gaps, warnings, and complaint review.

## Security review

Workspace membership and private non-fixture checks happen at the web boundary
and again in the RLS-backed repository. The query is read-only, bounded to 100
rows, and excludes idempotency digests, input hashes, actor metadata, and raw
source content. No workflow or connector is started by a read.

## Validation and limitations

The full `pnpm verify` suite passed on 2026-08-02: all 56 package
lint/typecheck/test/build tasks, fixture research, plan and analysis samples,
web smoke, formatting, and repository validation. Deterministic campaign and
campaign-status reference SVG sources were regenerated; local PNG export is
still unavailable because `cairosvg` is not installed. `pnpm verify:persistence`
remains blocked because the Docker Desktop Linux engine pipe is unavailable.
The history is production-collection-only; fixture workflow history,
pagination, multi-source orchestration, and scheduling remain separate work.

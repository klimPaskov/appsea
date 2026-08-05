# Source health completion report - 2026-08-05

## Outcome

The authenticated source registry now exposes a bounded connector-health
projection at `/workspace/:workspaceId/sources`. The projection is derived from
existing PostgreSQL workflow-job, retained source-item, and deletion-tombstone
rows; no migration or new mutable health store was introduced.

The public leaderboard is unchanged. This slice does not activate a source,
claim public market coverage, start or retry collection, resolve quota issues,
or perform deletion. CFPB and Stack Exchange remain disabled pending their
independent legal, privacy, attribution, commercial-use, and security review.

## Read boundary

Each source card shows only:

- fixed `healthy`, `degraded`, `blocked`, or `unknown` state;
- safe timestamps for the latest attempt and successful collection;
- bounded record, cost, and open-deletion counters;
- a fixed safe note and failure code.

Raw failure text, source payloads, credentials, reviewer identity, hashes,
retry controls, activation controls, quota mutation, and deletion mutation stay
outside the workspace read model.

## Changed surfaces

- `packages/contracts/src/index.ts` adds the strict health read model and a
  backward-compatible default on `workspaceSourceReadModel`.
- `packages/db/src/source-policy-repository.ts` derives and bounds health from
  existing tables and fails closed on unsafe counters.
- `packages/db/src/source-policy-registry-repository.test.ts` covers SQL
  projection, safe mapping, redaction of failure text, and counter bounds.
- `apps/web/src/app/workspace/[workspaceId]/sources/page.tsx` renders the
  private health summary; `apps/web/src/app/globals.css` supplies reference-
  consistent state styling.
- Product, architecture, plan, status, and memory files document the boundary.

## Validation evidence

The tranche passed:

- `pnpm --filter @appsea/web typecheck`, `lint`, `test`, and `build` (60 files,
  216 tests);
- `pnpm format:check`, `lint`, `typecheck`, `test`, and `build` (14 packages;
  28 build tasks; database 169 tests; contracts 110 tests; worker 124 tests);
- `pnpm worker:fixture`, `pnpm plan:sample`, `pnpm smoke:web`, and
  `pnpm security:audit`;
- `pnpm repo:check`, `pnpm memory:check`, `pnpm docs:check`, and
  `pnpm agents:sync`;
- direct HTTP requests to `localhost:3000`: public leaderboard and all three
  opportunity routes returned `200`; the private source page returned the
  expected unauthenticated `307`; the private source API returned `401`.

The Docker-backed PostgreSQL backup/restore drill remains unavailable when the
Docker Desktop Linux engine is not running; that environment limitation is not
treated as source-health proof.

## Remaining gaps

Production PostgreSQL/Temporal/provider deployment, scheduler ownership,
external source-policy approval and activation, hosted backup/restore and
failure drills, object/export purge, alert routing, billing, and signed Tauri
releases remain open. The health projection intentionally does not close those
operational or legal gates.

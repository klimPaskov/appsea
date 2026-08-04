# Score-factor provenance completion report

Date: 2026-08-04

## Delivered

- Added the strict `balancedScoreFactorKeys` and factor-binding contracts to
  `packages/contracts`.
- Added `source-evidence` versus `reviewed-seed` provenance to every v1 score
  explanation and persisted the full binding map inside the immutable score
  snapshot/explanation JSON.
- Added deterministic replay of the binding map and rejected missing or
  unknown factor keys, duplicate identifiers, and invalid provenance bases.
- Added production-analysis validation that source bindings match retained
  complaint evidence IDs and reviewed-seed bindings match the immutable seed
  review prefix.
- Kept read-only inspection compatible with v1 seed rows created before this
  binding map; new writes and analysis admission remain strict until a seed is
  replaced with complete factor provenance. The worker revalidates the strict
  seed schema before reconstructing an artifact.
- Updated the private-stack smoke and research/scoring fixtures with explicit
  reviewed-seed bindings, without changing the sparse public leaderboard.

## Proof

- `pnpm --filter @appsea/contracts test`
- `pnpm --filter @appsea/contracts typecheck`
- `pnpm --filter @appsea/scoring test`
- `pnpm --filter @appsea/scoring typecheck`
- `pnpm --filter @appsea/research test`
- `pnpm --filter @appsea/research typecheck`
- `pnpm --filter @appsea/worker test`
- `pnpm --filter @appsea/worker typecheck`

- `pnpm verify`
- `pnpm security:audit`
- `pnpm verify:local-stack`
- `pnpm verify:backup-restore`
- `pnpm memory:check`
- `pnpm docs:check`

All passed locally. No third-party source was activated and no reviewed seed
was presented as market research.

## Explicit limits

This tranche does not create live source evidence, independently approve CFPB
or Stack Exchange, derive score factors from complaint text, or add provider
backup/HA, hosting, ChatGPT Sites, or desktop release evidence. Source-backed
factor bindings are contract-ready but remain unavailable until an approved
source and retained evidence exist.

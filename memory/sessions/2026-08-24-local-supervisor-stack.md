# Session handoff — 2026-08-24 local supervisor stack

## Completed

- `scripts/dev_local.mjs` now centralizes and starts the local worker,
  maintenance supervisor, alert supervisor, and web process.
- `pnpm dev:local --dry-run` exposes the same four process commands.
- `scripts/dev_local.test.mjs` covers the process contract and loopback-only
  environment boundary.
- Local-stack runbook, `START_HERE.md`, active plan, current status,
  production-readiness audit, docs index, and `memory/ACTIVE.md` are aligned.

## Proof

- `node --test scripts/dev_local.test.mjs` — 4 passed.
- `pnpm dev:local --dry-run` — passed without contacting dependencies.
- The existing full workspace tests/lint/typecheck/build were rerun and passed
  before this handoff.

## Boundaries

- Development-only loopback processes; alert delivery remains disabled and no
  third-party source is activated.
- Hosted scheduler ownership, Temporal/HA, external alert routing, Docker
  local-stack proof, and independent source approvals remain open.
- Root `AGENTS.md` is user-owned and untouched; generated sync remains skipped.

## Next

When Docker is available, run `pnpm verify:local-stack` with the supervisors
enabled and inspect maintenance/alert metrics and graceful shutdown. Continue
the production tranche only with external source-policy and hosted deployment
evidence; do not call this completion.

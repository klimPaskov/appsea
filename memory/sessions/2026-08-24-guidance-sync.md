# Guidance sync handoff — 2026-08-24

## Completed

- `scripts/sync_agents.py` now preserves an intentionally empty, user-owned
  root `AGENTS.md` while refreshing all generated catalogs.
- Added `scripts/sync_agents.test.mjs` and wired it into `pnpm verify` as
  `pnpm test:guidance`.
- Updated the guidance runbook, operating-model spec, active plan, current
  status, readiness audit, docs index, and active memory.

## Proof

- `node --test scripts/sync_agents.test.mjs` passed.
- `pnpm agents:sync` passed without changing `AGENTS.md`.
- `pnpm verify` passed all local repository, fixture, public smoke, release
  static, and docs checks.

## Boundary

This removes a local validation blocker only. It does not assert Docker-backed
fresh/upgrade or backup/restore proof, external source approval, hosted
infrastructure, provider operations, or signed desktop release evidence.

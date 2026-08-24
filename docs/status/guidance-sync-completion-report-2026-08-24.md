# User-owned root guidance sync — 2026-08-24

## Outcome

The catalog synchronizer now preserves an intentionally empty, user-owned
`AGENTS.md` instead of failing when it cannot find generated blocks. It still
regenerates `docs/generated/skill-catalog.md`,
`docs/generated/subagent-catalog.md`, and
`docs/generated/repository-map.md` from the checked-in native metadata.

`pnpm verify` now includes the focused `pnpm test:guidance` regression and can
run the repository proof without editing the user-owned root guidance file.

## Proof

- `node --test scripts/sync_agents.test.mjs` — passed.
- `pnpm agents:sync` — passed and reported preservation of the empty root file.
- `pnpm verify` — passed: formatting, 60 Turbo tasks, fixture/report/plan
  generation, quality gate, public smoke, release static checks, and repository
  validation.

## Boundary

This is a guidance and validation improvement only. It does not weaken scoped
`AGENTS.md` rules, generated catalogs, imported-content isolation, source-policy
gates, or production readiness. Docker-backed persistence and deployment-owned
source, identity, provider, and release evidence remain external blockers.

The root `AGENTS.md` was not edited or staged.

---
name: appsea-first-run
description: Use when opening the AppSea repository for the first time or resuming after a long gap.
---

# AppSea first run

Use this skill when a coding agent needs to establish a correct working context before editing.

## Read

1. `AGENTS.md`
2. `START_HERE.md`
3. `memory/HOT.md`
4. `memory/USER.md`
5. `memory/ACTIVE.md`
6. `docs/INDEX.md`
7. The active plan and scoped instructions for the target files

## Procedure

1. Confirm the working directory is the repository root.
2. Run `pnpm memory:status` and inspect warnings.
3. Run `pnpm agents:sync` when catalogs are missing or stale.
4. Inspect `git status`, recent commits, and the target package.
5. Search memory and docs before inventing a new pattern.
6. Run the smallest existing check that proves the current baseline.
7. State the exact vertical slice you will complete.

Do not start from an app subfolder. Do not use a chat transcript as the only source of current state. Do not assume a live source, production database, or desktop release exists.

## Completion

The agent knows the current product stage, target files, relevant skills, validation path, and known blockers.

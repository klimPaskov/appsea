---
name: appsea-vertical-slice
description: Use when implementing an AppSea feature that crosses contracts, processing, APIs, UI, tests, and documentation.
---

# AppSea vertical slice

Use this skill for meaningful product implementation.

## Required reading

- `AGENTS.md`
- `docs/architecture/system-overview.md`
- the active plan
- local `AGENTS.md` files
- skills for any source, research, scoring, report, worker, or UI surface involved

## Procedure

1. Define one user-visible or agent-visible outcome.
2. Map the contract, data, logic, execution boundary, interface, tests, and docs needed for that outcome.
3. Reuse existing packages instead of adding a parallel layer.
4. Validate external input at the boundary.
5. Implement pure domain logic before orchestration.
6. Add fixture-backed tests for success, failure, and idempotency where relevant.
7. Update docs and `memory/ACTIVE.md` in the same change.
8. Run the guidance checkpoint.

Reject a slice that only creates placeholders, empty adapters, speculative folders, or an interface disconnected from real data.

## Validation

Run package checks first. Run repository checks when shared contracts or several packages changed.

## Completion

The outcome works end to end, tests prove the important behavior, docs match the code, and no requested surface is silently deferred.

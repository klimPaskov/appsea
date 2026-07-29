---
name: appsea-memory
description: Use when reading, updating, searching, validating, or curating AppSea project memory.
---

# AppSea project memory

This skill owns the checked-in `memory/` folder, not product runtime memory.

## Procedure

1. Read `HOT.md`, `USER.md`, and `ACTIVE.md`.
2. Search before adding a fact that may already exist.
3. Put immediate facts in `HOT.md` only when every agent needs them.
4. Put current task state in `ACTIVE.md`.
5. Put stable architecture in `PROJECT.md`.
6. Put accepted choices and reasons in `DECISIONS.md`.
7. Put reusable validated learning in `LESSONS.md`.
8. Create a dated session handoff for interrupted long work.
9. Archive superseded material instead of silently deleting useful history.
10. Run `python scripts/memory.py validate`.

Keep entries factual, concise, dated when needed, and linked to repository paths. Do not store credentials, private source content, or speculation as fact.

## Completion

The next coding agent can resume from repository memory without needing the previous chat.

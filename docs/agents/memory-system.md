# Memory system

The checked-in memory system is designed for continuity and reviewability.

`HOT.md` stays small. `ACTIVE.md` changes with the current plan. `PROJECT.md` and `DECISIONS.md` change only when stable facts change. `LESSONS.md` records reusable learning after validation.

`memory.py` builds a local SQLite full-text index. Search results show file paths and excerpts. The index is disposable and never becomes the source of truth.

AppSea runtime memory is separate and lives behind `packages/agent-memory`. Runtime evidence cannot write repository memory.

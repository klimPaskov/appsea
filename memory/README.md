# AppSea project memory

This folder is durable project context for coding agents. It complements Codex session memory and remains reviewable in version control.

Read order:

1. `HOT.md`
2. `USER.md`
3. `ACTIVE.md`
4. Search the remaining memory when needed

Use `python scripts/memory.py` to validate, search, add entries, and create session handoffs. The generated SQLite index is local and ignored by Git.

Do not store secrets, credentials, copied private messages, or source content that AppSea is not permitted to retain.

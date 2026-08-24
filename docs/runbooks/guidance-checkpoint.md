# Guidance checkpoint

After a meaningful tranche:

1. Review the diff and task-specific validation.
2. Update source-of-truth docs.
3. Update `memory/ACTIVE.md`.
4. Add a stable decision or lesson when it will matter later.
5. Search the skill catalog for repeated workflows.
6. Update or create a skill when justified.
7. Change `AGENTS.md` only for a stable global rule.
8. Run `pnpm agents:sync` and `pnpm repo:check`. If the repository owner has
   intentionally left the root `AGENTS.md` empty, synchronization must preserve
   that file while still refreshing the generated catalogs; `pnpm verify` covers
   this exception with `pnpm test:guidance`.

Do not use the checkpoint to inflate documentation. Every update must reduce future ambiguity.

# Skill authoring instructions

Read the root `AGENTS.md` and `appsea-skill-maintenance` before editing skills.

Every skill lives in one folder with `SKILL.md` and optional `agents/openai.yaml`. Keep frontmatter valid. Trigger descriptions should say when the skill applies. Bodies should contain repository-specific procedure, validation, failure behavior, and completion proof.

Search for overlap before creating a skill. Never put active task state, one-off feature history, private data, or copied source content into a reusable skill. Run `pnpm agents:sync` after changes.

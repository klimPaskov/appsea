# Codex project configuration

AppSea uses the native repository conventions expected by Codex:

- root and scoped `AGENTS.md` files for project instructions
- `.agents/skills/<skill-name>/SKILL.md` for reusable workflows
- `.codex/agents/*.toml` for bounded helper agents
- `.codex/config.toml` for project settings
- `memory/` for checked-in project memory shared by coding agents

Open the repository root in Codex. Do not open `apps/web` as an isolated project because the agent would miss the root instructions, shared packages, memory, and skills.

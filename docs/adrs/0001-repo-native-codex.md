# ADR 0001: Use repository-native Codex conventions

- Status: accepted
- Date: 2026-07-10

## Decision

Use root and scoped `AGENTS.md`, native `.agents/skills`, `.codex/agents`, and `.codex/config.toml`.

## Reason

A coding agent must discover the project from the repository root without a custom bootstrap system. Standard locations make skills and helper agents directly usable and keep instructions reviewable.

## Consequence

Legacy skill manifests and custom hook conventions are not part of the active project.

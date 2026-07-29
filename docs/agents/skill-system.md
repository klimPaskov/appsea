# Skill system

Project skills are native Codex skills under `.agents/skills/<name>/SKILL.md`.

A skill should own one reusable workflow. It defines triggers, reading, allowed edits, procedure, validation, and completion proof. Skills should cite repository paths and commands when that prevents rediscovery.

Skill maintenance follows this order:

1. Search the catalog.
2. Update an existing skill when the topic belongs there.
3. Create a new skill only for a distinct recurring workflow.
4. Keep task state and feature-specific history out of general skills.
5. Synchronize catalogs and review `AGENTS.md` references.

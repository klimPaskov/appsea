---
name: appsea-skill-maintenance
description: Use when creating, updating, merging, auditing, or retiring native AppSea Codex skills.
---

# AppSea skill maintenance

Project skills live at `.agents/skills/<skill-name>/SKILL.md`.

## Procedure

1. Read `AGENTS.md` and the generated skill catalog.
2. Search existing skills for ownership overlap.
3. Update an existing skill when it already owns the workflow.
4. Create a new skill only when the workflow is distinct, recurring, and grounded in repository practice.
5. Use valid frontmatter with a precise trigger description.
6. Include required reading, allowed scope, procedure, validation, failure behavior, and completion proof.
7. Keep feature-specific state and temporary history out.
8. Retire or merge stale overlapping skills.
9. Update subagent routing when ownership changes.
10. Run `pnpm agents:sync` and review the generated catalog.

Do not create skills to inflate coverage. A small focused skill is better than a large generic instruction dump.

## Completion

The skill is discoverable, non-overlapping, directly usable, and tied to a real repeated workflow.

# Agent and skill architecture

AppSea has two distinct skill systems. They must remain separate.

## Coding-project skills

Coding agents use native repository skills under:

```text
.agents/skills/<skill-name>/SKILL.md
```

These skills teach Codex how to work on the AppSea repository. They cover first run, vertical slices, contracts, connectors, deep research, complaint analysis, competitors, scoring, reports, UI, workers, documentation, memory, guidance, skill maintenance, security, review, and completion audit.

Every project skill uses standard frontmatter with `name` and a trigger-focused `description`. The body defines required reading, allowed scope, procedure, validation, and completion proof. Active task state belongs in `memory/`, not in skills.

Helper-agent definitions live under `.codex/agents/*.toml`. Helpers remain bounded. The main coding agent owns final implementation and completion claims.

## Product runtime skills

Future AppSea product agents use a separate governed registry represented by `packages/skill-registry`.

Runtime skills move through these states:

1. proposed
2. evaluated
3. approved
4. active
5. retired

A generated runtime skill cannot approve or activate itself. Permission changes, source activation, credentials, migrations, retention, and deployment require review.

## Runtime agent roles

- research orchestrator
- source policy evaluator
- query planner
- source connector worker
- evidence normalizer
- complaint classifier
- entity resolver
- cluster analyst
- competitor researcher
- evidence verifier
- opportunity synthesizer
- scoring coordinator
- report generator
- coding-package generator
- maintenance monitor
- security evaluator

Agents use typed tools and validated contracts. Direct production database, shell, network, package installation, and deployment permissions are separate capabilities.

## Instruction boundary

Complaint text, webpages, source metadata, and generated reports are untrusted data. They cannot become project instructions, runtime system prompts, permissions, or active skills. Runtime memory records instruction-like content as a risk flag and never treats it as authority.

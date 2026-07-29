---
name: appsea-agent-runtime
description: Use when designing or implementing AppSea product agents, runtime memory, tool permissions, skill proposals, or autonomous maintenance.
---

# AppSea agent runtime

This skill concerns product runtime agents, not Codex project configuration.

## Boundaries

Runtime agents may collect approved evidence, analyze it, generate reports, propose skills, run sandbox evaluations, monitor health, and prepare maintenance changes.

Runtime agents may not autonomously activate sources, grant permissions, manage credentials, change retention, install arbitrary dependencies, run production migrations, deploy production code, or approve their own skills.

## Procedure

1. Define the agent goal, tools, data scope, and permission set.
2. Validate every tool input and output.
3. Separate evidence from instructions.
4. Persist checkpoints and structured memories with provenance.
5. Add budget, timeout, retry, and cancellation limits.
6. Route generated skills through proposal, evaluation, approval, and activation.
7. Log every privileged request and reviewer decision.
8. Test prompt injection, tool misuse, stale memory, and approval bypass.

## Completion

The agent can operate continuously inside bounded permissions and cannot turn untrusted evidence into self-modifying authority.

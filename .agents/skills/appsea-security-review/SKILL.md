---
name: appsea-security-review
description: Use before merging AppSea work that touches sources, authentication, permissions, personal data, agents, models, deployments, or desktop packaging.
---

# AppSea security review

## Review surfaces

- trust boundaries and data flow
- authentication and authorization
- credential storage
- source policy and retention
- personal data minimization and deletion
- prompt injection and instruction confusion
- tool permissions
- model output validation
- dependency and supply-chain risk
- HTML and export rendering
- logging and secret leakage
- desktop webview and update security

## Procedure

1. Map entry points, assets, actors, and privileged operations.
2. Identify how untrusted content reaches models, tools, UI, exports, and memory.
3. Verify fail-closed behavior.
4. Test authorization on server boundaries, not only in UI.
5. Check logs, fixtures, and generated packages for sensitive data.
6. Review approval gates for source activation and self-modification.
7. Record findings by severity, evidence, owner, and fix status.
8. For workflow ingress, verify a workspace-scoped digest-only admission is
   reserved before the remote workflow call, consumed transactionally during
   initialization, bounded by rate/concurrency limits, and bound to an
   immutable authenticated actor. Ensure source and downstream-analysis
   admissions cannot authorize each other.

Do not approve a feature because it is fixture-only if the same contract will later handle real content.

## Completion

Critical and high findings are resolved or explicitly block release, and remaining risk is documented with evidence.

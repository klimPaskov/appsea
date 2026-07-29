---
name: appsea-code-review
description: Use for focused review of AppSea code before integration or after a substantial implementation tranche.
---

# AppSea code review

## Review order

1. Compare the change with the requested outcome and active plan.
2. Inspect shared contract impact.
3. Check package ownership and duplicated logic.
4. Trace external input through validation and storage.
5. Review failure, retry, idempotency, and cleanup behavior.
6. Review score determinism and evidence traceability.
7. Review UI scope, accessibility, and responsive behavior.
8. Check tests for meaningful success and failure cases.
9. Check docs, memory, and skill alignment.
10. Run task-specific validation.

Report concrete findings with file and line evidence. Separate blockers, important issues, and minor improvements. Do not produce style-only noise when correctness or missing behavior is more important.

## Completion

The main agent has an evidence-based review and either fixes the findings or records a clear blocker.

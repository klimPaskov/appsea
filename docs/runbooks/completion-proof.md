# Completion proof runbook

For repository-wide work:

```bash
pnpm agents:sync
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm worker:fixture
pnpm plan:sample
pnpm smoke:web
pnpm repo:check
```

The final report lists the feature surfaces, changed files, task-specific checks, generated artifacts, docs and memory changes, skill changes, and remaining gaps. Report simplifications that alter requested behavior.

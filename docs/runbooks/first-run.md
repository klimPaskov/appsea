# First-run runbook

```bash
corepack enable
pnpm install
pnpm agents:sync
pnpm memory:status
pnpm verify
pnpm dev:web
```

`pnpm dev:web` is sufficient for the public fixture leaderboard. To exercise
private workspaces, PostgreSQL persistence, Temporal, and the durable worker
with loopback-only development settings, use `pnpm dev:local` instead; see
[`local-stack.md`](local-stack.md).

Expected website routes:

- `/`
- `/opportunities/inbox-relay`
- `/opportunities/inbox-relay/complaints`
- `/opportunities/inbox-relay/competitors`
- `/opportunities/inbox-relay/plan`
- `/api/opportunities`

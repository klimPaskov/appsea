# Repository map

- `apps/web` owns the website and read API.
- `apps/worker` owns executable research and package generation entry points.
- `apps/desktop` reserves the Tauri desktop integration boundary.
- `packages/contracts` owns validated cross-package contracts.
- `packages/catalog` owns labeled synthetic fixture data.
- `packages/connectors` owns source policies and connector interfaces.
- `packages/research` owns normalization and complaint clustering.
- `packages/scoring` owns deterministic opportunity scores.
- `packages/db` owns PostgreSQL configuration, forward migrations, transaction-scoped RLS context, and persistence repositories.
- `packages/reports` owns coding-agent plan package generation.
- `packages/agent-memory` owns future product runtime memory contracts.
- `packages/skill-registry` owns future runtime skill governance.
- `.agents/skills` owns coding-project workflows.
- `.codex/agents` owns bounded helper-agent definitions.
- `memory` owns durable coding-project context.
- `docs` owns product, architecture, operating, and decision documentation.
- `infra/local` owns loopback-only disposable PostgreSQL development bootstrap; it is not production infrastructure.

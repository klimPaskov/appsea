# AppSea

AppSea turns repeated product complaints into ranked software opportunities and implementation packages for coding agents.

This repository is a working starter, not a planning-only archive. A coding agent can open the repository root, read `AGENTS.md`, install dependencies, run the fixture research pipeline, launch the website, and continue from a tested vertical slice.

## Product loop

```text
approved sources
      ↓
evidence records
      ↓
normalized complaints
      ↓
problem clusters
      ↓
competitors and contrary evidence
      ↓
versioned opportunity scores
      ↓
leaderboard and coding-agent plan packages
```

## Repository layout

```text
apps/web                 Next.js website
apps/worker              Fixture research and plan generation entry points
apps/desktop             Staged Tauri desktop boundary
packages/contracts       Shared validated contracts
packages/catalog         Synthetic opportunity fixture catalog
packages/connectors      Source policy and connector boundary
packages/research        Normalization and clustering
packages/scoring         Deterministic scoring
packages/reports         Coding-agent package generation
packages/agent-memory    Future product runtime memory boundary
packages/skill-registry  Future runtime skill governance
.agents/skills           Native Codex project skills
.codex/agents            Bounded Codex helper agents
memory                    Durable coding-project memory
docs                      Product, architecture, agent, and operating docs
design/references         Sparse reference interfaces
```

## Run locally

```bash
corepack enable
pnpm install
pnpm setup
pnpm verify
pnpm dev:web
```

The website uses synthetic fixture data. The generated research artifact appears under `artifacts/research/`. The sample coding-agent package appears under `artifacts/plans/inbox-relay/`.

## Agent workflow

Open the repository root in Codex. The root `AGENTS.md` defines the work loop, memory system, documentation system, safety boundary, native skill use, subagent ownership, and completion proof. Scoped `AGENTS.md` files add local rules without bloating the root instructions.

Run `pnpm agents:sync` after editing a skill or subagent. Run `pnpm memory:status` at the start of a large task and keep `memory/ACTIVE.md` current.

## Source access

AppSea does not assume unrestricted access to every social network. Every source needs an explicit access and retention policy. Missing access remains visible as a coverage gap.

## Desktop status

The web contract is the source of truth. `apps/desktop` reserves the Tauri boundary for later Windows and macOS packaging. It does not claim a signed desktop release.

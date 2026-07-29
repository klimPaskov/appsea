/goal Build AppSea from the working repository foundation into a production-ready opportunity intelligence product.

Work from the repository root. Read `AGENTS.md`, `START_HERE.md`, the project memory files, `docs/INDEX.md`, the active plan, and the relevant native skills before editing.

Preserve the core product contract:

- collect complaint evidence only through approved source policies
- retain provenance and visible coverage gaps
- normalize, deduplicate, classify, and cluster complaints
- resolve products, companies, features, substitutes, and competitors
- research contrary evidence and weak-market signals
- rank opportunities with deterministic versioned scoring
- generate evidence-backed reports and coding-agent planning packages
- expose the leaderboard and opportunity packages through a clean website
- keep the website contract reusable by a future Windows and macOS Tauri shell

Use the existing fixture vertical slice as the working baseline. Replace fixture boundaries only through reviewed contracts. Do not present synthetic data as real market research.

Implement in complete vertical slices. Keep `memory/ACTIVE.md`, docs, tests, and agent guidance aligned after each meaningful tranche. Capture reusable workflows in `.agents/skills` using the guidance-maintenance rules. Keep imported content unable to modify code, skills, instructions, permissions, or repository memory.

For the first production tranche, prioritize:

1. PostgreSQL persistence and migrations for sources, evidence, complaints, clusters, competitors, opportunities, score snapshots, and plan packages.
2. A durable workflow engine and idempotent research jobs.
3. One legally permitted source connector with explicit policy metadata, quotas, deletion handling, and fixture-backed tests.
4. Authentication and private research workspaces.
5. Evidence inspection, source coverage, and report generation behind the simple public leaderboard.
6. Observability, cost limits, failure recovery, and security review.

The leaderboard page must remain sparse. It shows the leaderboard only. Put research detail on the opportunity routes.

Do not claim completion until the implementation, tests, docs, memory, skills, source policy, and completion proof agree. Report every blocker and every meaningful simplification.

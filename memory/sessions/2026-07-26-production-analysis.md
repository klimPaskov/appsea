# Session handoff: production-shaped offline analysis

Date: 2026-07-26

## Outcome

The first downstream analysis checkpoint now composes an approved-shaped,
non-fixture collection payload into deterministic production-mode clusters, a
seeded opportunity, a versioned score snapshot, a generic evidence report, and
a six-file coding plan. It is deliberately test-only and in-memory.

## Main changes

- `packages/contracts` adds production analysis input/artifact/seed contracts,
  explicit transport and test-only metadata, and report observation query
  provenance with restricted-mode excerpt handling.
- `packages/research` adds deterministic production normalization, clustering,
  and explicit-seed scoring.
- `packages/reports` adds production-shaped report and generic plan generation;
  the existing Inbox Relay plan remains fixture-only.
- `apps/worker/src/analysis-sample.ts` writes a reproducible CFPB-shaped sample
  artifact, report, plan, and hash manifest under `artifacts/analysis-sample`.
- Docs and memory describe the boundary and its remaining gaps.

## Validation

Focused contract, research, reports, and worker suites pass. `pnpm
analysis:sample` produces three complaints, three clusters, and score `7.8`.
The repository-wide `pnpm verify` still needs to be rerun after the final
documentation and script updates.

## Explicit limits and next work

No connector was activated; no PostgreSQL, Temporal, object store, UI, MCP, or
desktop path consumes this output. Factor values, competitors, contrary
evidence, and plan paths are explicit reviewed input, not model inference. The
next production tranche should persist and orchestrate these artifacts behind
workspace/report approval boundaries, then add object-store retention and
operator-visible recovery.

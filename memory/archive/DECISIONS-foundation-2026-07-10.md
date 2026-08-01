# Archived foundation decisions

These early decisions remain in the archive for traceability; the active ledger
keeps later decisions and the current source-collection lease boundary.

## 2026-07-10: Repository-native Codex structure

Use root/scoped `AGENTS.md`, `.agents/skills`, `.codex/agents`, and
`.codex/config.toml`; do not maintain a second custom hook or instruction system.

## 2026-07-10: Bounded guidance and memory

Keep root `AGENTS.md` below 32 KiB. Put task state in `memory/ACTIVE.md`,
reusable workflows in skills, and deep explanations in docs.

## 2026-07-10: Web first, desktop later

Treat the website contract as source of truth. Stage Tauri after web/API
contracts stabilize.

## 2026-07-10: Source policy before connector activation

Every source connector remains disabled until purpose, access, commercial use,
quotas, retention, deletion, attribution, and display rules are reviewed.

## 2026-07-10: Sparse interface

The leaderboard shows only the ranked list. Research, complaints, competitors,
and coding plans use separate routes.

## 2026-07-10: Fixture-first implementation

Prove the complete loop with labeled synthetic data before live sources;
fixtures never become market evidence.

# Project memory system

The checked-in project memory supports long coding-agent work across sessions.

## Memory layers

- hot memory for immediate facts
- durable user direction
- active implementation state
- stable project architecture
- accepted decisions and reasons
- reusable lessons
- dated session handoffs
- archive for superseded material

A local SQLite full-text index supports search. Markdown files remain the source of truth.

## Maintenance rules

Memory entries are concise, factual, reviewable, and linked to repository paths when possible. Secrets and private source content are prohibited. Active state is rewritten as work changes. Stable files change only when the underlying fact changes.

## Separation from product memory

Runtime AppSea memory stores structured research and workflow facts. It cannot update repository memory, code, instructions, skills, subagents, or permissions.

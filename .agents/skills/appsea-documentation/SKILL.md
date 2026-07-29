---
name: appsea-documentation
description: Use when adding, updating, auditing, or reorganizing AppSea documentation.
---

# AppSea documentation

Read `docs/INDEX.md` and `docs/agents/documentation-system.md`.

## Procedure

1. Identify the source of truth for the changed behavior.
2. Update docs in the same change as code.
3. Add links from `docs/INDEX.md` when creating a durable document.
4. Promote accepted plan content into product or architecture docs.
5. Archive completed or superseded plans.
6. Mark status, owner, date, uncertainty, and blockers where useful.
7. Run the documentation checker.
8. Remove stale or duplicate claims.

Do not create a new document when a small update belongs in an existing source. Do not claim a feature works without code and validation evidence.

## Completion

A future agent can find the current behavior from the index, and no active document contradicts the implementation.

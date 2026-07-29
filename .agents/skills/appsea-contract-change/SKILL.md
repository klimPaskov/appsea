---
name: appsea-contract-change
description: Use when adding or changing shared AppSea schemas, types, API payloads, or stored artifact shapes.
---

# AppSea contract change

Shared contracts live in `packages/contracts`.

## Procedure

1. Search all consumers before changing a schema.
2. Decide whether the change is additive, breaking, or a new version.
3. Update Zod validation and exported TypeScript types together.
4. Add positive and negative contract tests.
5. Update fixture producers and all consumers in the same slice.
6. Preserve provenance, synthetic labels, score versions, and source policy fields.
7. Update matching JSON Schemas under `schemas/` when the production contract is intended to remain compatible with them.
8. Record a migration plan before changing persisted production data.

Do not make important fields optional only to avoid updating callers. Do not expose raw source payloads as domain contracts.

## Validation

Run tests and type checking for every affected package, followed by the web and worker build when they consume the contract.

## Completion

Every producer and consumer agrees on one validated shape, breaking changes are explicit, and migration impact is documented.

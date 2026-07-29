# ADR 0002: Keep guidance and memory bounded

- Status: accepted
- Date: 2026-07-10

## Decision

Keep root guidance below 32 KiB. Put current state in memory, procedures in skills, and deep explanations in docs.

## Reason

A single growing instruction file becomes noisy and expensive to read. Layered context gives the agent the right detail at the right scope.

## Consequence

Every meaningful tranche includes a guidance checkpoint and stale guidance must be trimmed.

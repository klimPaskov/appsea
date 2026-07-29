# ADR 0003: Stabilize the web contract before desktop packaging

- Status: accepted
- Date: 2026-07-10

## Decision

Build and validate the website first. Reuse the same routes and contracts through a Tauri shell for Windows and macOS later.

## Reason

Duplicating product logic in web and desktop would slow the first useful release and create inconsistent behavior.

## Consequence

The current desktop package is a boundary scaffold, not a release claim.

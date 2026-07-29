# Workspace invitation tranche handoff

Date: 2026-07-25

## Completed

- Added contract schemas/types and tests for invitation issue, accept, read,
  delivery batch, and retention counters.
- Added migration `0025_workspace_invitations.sql` with forced RLS,
  hash-only tokens, encrypted delivery outbox, owner-only issue/revoke,
  existing-account accept, bounded claim/complete/fail, purge, and audit/outbox
  receipts.
- Added repository methods, shared signed delivery, invitation worker/runner,
  worker observability counters, web APIs, `/invite` fragment acceptance, and
  owner invitation controls on the members page.
- Updated product/security/runbook/status/plan docs and project memory. The
  current contract intentionally accepts existing accounts only; it does not
  create accounts or verify email ownership.

## Validation

- Contracts: 48 tests.
- Database: 24 package tests; migration catalog includes 0025.
- Worker: 29 tests; web: 23 tests.
- Worker/web typechecks and lint passed.
- Docker-backed persistence/workflow gates remain unavailable because the local
  Docker Desktop Linux engine pipe is missing.

## Resume next

1. Run formatting, full verify, docs/memory/repo checks, and regenerate the
   repository manifest after the final edits.
2. Review migration 0025 on PostgreSQL 18, especially RLS policy execution,
   membership-trigger context, plaintext recipient retention, and stale-send
   invalidation; the Docker integration gate is required before production
   claims.
3. Keep invitation and recovery delivery disabled until provider, verified
   identity/email, DPA/retention, key rotation, scheduling, and security review
   are approved.

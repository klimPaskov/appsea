# Local supervisor stack completion report - 2026-08-24

Status: implemented and locally verified; this expands development evidence
only and is not a production deployment claim.

## Scope

`pnpm dev:local` now starts the existing durable Temporal worker together with
the lease-backed `maintenance:loop` and `alerts:loop` supervisors before the
Next.js web process. The process list is centralized in
`scripts/dev_local.mjs`, exposed through the dry-run output, and terminated as
one bounded local stack on Ctrl+C. The supervisors continue to own their
existing PostgreSQL lease, retry, recovery, metrics, outbox, and fixed-failure
boundaries; no second scheduler implementation was introduced.

The local environment remains loopback-only, development-only, and provider
disabled. Alert delivery remains disabled by default, and the local loops do
not activate CFPB, Stack Exchange, or any other third-party source.

## Proof

- `node --test scripts/dev_local.test.mjs` — 4 tests passed, including the
  worker/maintenance/alerts/web process contract and loopback environment
  boundary.
- `pnpm dev:local --dry-run` — emitted all four long-lived process commands and
  loopback endpoints without contacting Docker, PostgreSQL, Temporal, MinIO,
  or an external provider.
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` remain green for
  the workspace after the change.
- `pnpm verify:local-stack` — the disposable PostgreSQL/Temporal/MinIO stack
  completed the authenticated owner-import, production-analysis, private
  report/plan readback, fixture-disclosure, and cleanup smoke on 2026-08-24.
  The smoke harness now allows a cold Next.js route compile while keeping its
  workflow polling deadlines bounded.

## Boundary and follow-up

This does not prove a deployed scheduler owner, hosted Temporal/HA behavior,
external alert routing, provider recovery, or source activation. Those remain
deployment and independent source-policy gates. The local Docker proof is
disposable development evidence only and does not claim hosted durability.

The user-owned root `AGENTS.md` was not edited or staged.

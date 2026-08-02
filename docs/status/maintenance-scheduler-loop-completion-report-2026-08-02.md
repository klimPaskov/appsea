# Maintenance scheduler loop completion report

## Outcome

The worker now exposes a deployment-owned `maintenance:loop` command. It
supervises the existing one-shot source-maintenance pass with bounded success
intervals, fixed failure telemetry, retry backoff, and signal-safe shutdown.
The database scheduler lease and transaction fence remain the authority for
duplicate prevention and mutation safety; the loop does not add an in-memory
work queue or bypass source-policy gates.

## Changed surfaces

- `apps/worker/src/maintenance-loop.ts` adds bounded environment parsing, the
  retrying loop, child-pass termination, and a safe main entrypoint.
- `apps/worker/src/maintenance-loop.test.ts` covers failure/backoff recovery,
  shutdown before work, and environment bounds.
- `apps/worker/src/observability.ts` and its tests add bounded loop counters.
- `apps/worker/package.json` exposes `maintenance:loop`; `.env.example` lists
  the interval and backoff settings.
- `docs/runbooks/source-maintenance.md` documents supervisor integration,
  fixed events, and signal behavior.

## Validation

- Worker typecheck, lint, and 72 tests pass.
- Repository-wide verification remains required before release.
- Docker-backed PostgreSQL/Temporal crash proof is still unavailable in this
  environment because the Docker Desktop Linux engine is not running.

## Remaining boundary

This is repository-level scheduler behavior, not a deployed production
topology. A deployment still needs a process supervisor, alert routing,
Temporal namespace authorization, service-role credentials, and an approved
source policy before any non-fixture collection can run.

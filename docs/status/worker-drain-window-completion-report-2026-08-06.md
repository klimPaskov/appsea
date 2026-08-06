# Worker drain-window completion report — 2026-08-06

Status: repository tranche complete; hosted replacement and crash-drill
evidence remain deployment gates.

## Outcome

The production configuration boundary now requires an explicit
`APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS` value between 30 and 900 seconds. The
production Compose worker maps the same value to `stop_grace_period`, so a
SIGTERM has a bounded deployment window for Temporal activities, dispatch
scans, and heartbeat cleanup before a forced kill is allowed.

The check is configuration-only: it does not contact PostgreSQL, Temporal,
object storage, identity providers, alert endpoints, or complaint sources.
The existing worker lifecycle remains idempotent and owns the safe-point
shutdown sequence; a forced kill is still treated as a crash-recovery event.

## Changed surfaces

- `apps/worker/src/production-preflight.ts` and its tests validate the bounded
  drain setting and fixed `APPSEA_PREFLIGHT_WORKER_DRAIN` failure code.
- `infra/production/production.env.example` documents the secret-free default
  value, while `infra/production/compose.yaml` wires it into the worker
  stop-grace period.
- `scripts/verify_release.mjs` requires the bounded example value and checks
  the Compose interpolation, without accepting credentials or runtime data.
- Production deployment, preflight, and worker observability runbooks explain
  `--env-file` interpolation and the forced-kill recovery boundary.
- Current status, known gaps, architecture, plan, audit, and memory now agree
  that repository drain wiring is present while hosted supervisor ownership,
  restore, and replacement evidence remain open.

## Validation

- Focused worker preflight tests pass, including missing, malformed, lower,
  upper, and valid boundary values.
- Static release-boundary tests pass with the checked-in Compose and env
  example.
- The existing repository verification suite remains the required follow-up;
  this tranche does not authorize production deployment or claim hosted
  provider operation.

## Deliberate simplifications and remaining gates

The repository does not force-kill the Node process when the window expires;
the process supervisor owns that action. Provider-specific termination,
multi-instance replacement, hosted Temporal recovery, and incident evidence
must be reviewed and recorded by the deployment owner.

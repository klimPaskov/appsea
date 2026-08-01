# Temporal worker configuration completion report — 2026-08-01

## Outcome

The web Temporal client and long-lived durable worker now use one validated
endpoint contract from `@appsea/workflows`:

- loopback endpoints are allowed only for local/test unauthenticated fixture
  mode and reject API-key/CA credentials;
- production rejects loopback and requires a namespace, API key, and PEM or
  base64 pinned CA for a non-loopback endpoint;
- the worker applies the same authenticated TLS options to both
  `NativeConnection` (activities) and `Connection` (workflow client), while
  preserving the configured namespace.

This is connection configuration, not a deployed Temporal topology or an
authorization/HA/retention proof.

## Evidence

- Shared implementation: `packages/workflows/src/temporal-config.ts` and its
  package export.
- Web reuse: `apps/web/src/server/temporal.ts`.
- Worker wiring: `apps/worker/src/durable-worker.ts`.
- Fixture-only loopback helper remains scoped to `workflow-fixture.ts`.
- Tests: `packages/workflows/src/temporal-config.test.ts` plus the existing web
  Temporal configuration suite cover local, production rejection, remote TLS,
  credential, and missing-field paths.

## Validation

Run the workflows, web, and worker package lint/typecheck/test/build checks,
then the repository verification and docs/memory checks. Docker-backed Temporal
and PostgreSQL proofs still depend on the unavailable Docker Desktop Linux
engine in this environment.

## Simplifications and remaining gaps

The endpoint contract accepts a single API key and pinned CA; mTLS client
certificates, namespace/task-queue authorization, secret rotation, HA,
retention, backups, deployment rollout, and incident monitoring remain
infrastructure work. No production endpoint was contacted or activated.

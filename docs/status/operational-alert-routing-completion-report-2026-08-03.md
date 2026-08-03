# Operational alert routing completion report — 2026-08-03

Status: repository boundary implemented; production endpoint operation remains
an external deployment responsibility.

The three bounded maintenance alert commands now share a signed operational
alert delivery boundary. Alert and incomplete results, plus fixed-code command
failures, can be delivered to a separately operated HTTPS endpoint. Clear
results remain log/metric observations and are not sent as incident traffic.

## Evidence

- `apps/worker/src/alert-delivery.ts` validates the opt-in endpoint and
  base64url secret, strips the request to the already bounded worker event
  payload, signs the body with HMAC-SHA256, sends an idempotency key, rejects
  redirects, and retries transient provider failures at most three times.
- `apps/worker/src/observability.ts` exposes the same redacted payload to the
  log sink and alert sender, avoiding a second serialization path.
- `source-quota-reconciliation-alert-cli.ts`,
  `production-analysis-recompute-alert-cli.ts`, and
  `workspace-cost-alert-cli.ts` route only alert/incomplete/failure events.
  A delivery failure is a fixed `APPSEA_ALERT_DELIVERY_FAILED` event and the
  command exits non-zero so the deployment scheduler can retry it.
- `production-preflight.ts` requires an enabled HTTPS, non-loopback alert route
  and a separate 32-byte secret in production.
- `alert-delivery.test.ts` and `production-preflight.test.ts` cover opt-in,
  configuration rejection, HMAC headers, stable idempotency across retries,
  transient retry, bounded failure, and clear-event suppression.

## Remaining gate

The repository does not operate an incident provider, prove endpoint TLS trust,
configure provider billing/retention, or own scheduler delivery retries after a
process crash. Deployment must provide the endpoint, secret storage and
rotation, rate limits, incident routing policy, and scheduler ownership. No
source is activated and no synthetic fixture is represented as market data by
this slice.

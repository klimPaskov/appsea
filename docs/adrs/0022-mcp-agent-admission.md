# ADR 0022: Durable admission for read-only MCP agents

- Status: accepted
- Date: 2026-08-04
- Owner: main coding agent

## Decision

The read-only MCP bearer boundary uses a database-owned admission lease in
addition to token authentication. Authentication and admission re-check that
the token's account, private workspace, and workspace membership are active;
removing membership therefore invalidates a token without waiting for token
expiry. PostgreSQL migration `0097` keeps a server-clock request window of 60
requests per 60 seconds, a maximum of four active request leases per token,
and a 30-second lease expiry. The handler releases an admitted lease in a
`finally` path and the next admission deletes expired leases.

Denied rate/concurrency admissions return a fixed HTTP `429` with a bounded
`Retry-After` value. No caller-supplied timestamp or concurrency counter is
trusted. MCP resource descriptors use static labels because imported
opportunity names and summaries are untrusted content; those values remain in
the resource payload only.

## Consequences

- Multiple web instances share one durable admission boundary through
  PostgreSQL instead of relying on process-local memory.
- A crashed request can hold at most one 30-second lease; deployment-level
  request timeouts should remain shorter than that lease.
- Edge/proxy rate limiting, secret storage, HTTPS termination, alerting, and
  provider operations remain separate deployment controls.
- This does not add MCP write tools, source activation, workflow starts, or
  report/plan generation.

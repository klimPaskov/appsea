# Source-quota reconciliation

A source request can settle its quota reservation before PostgreSQL commits the
corresponding production result. AppSea treats that boundary as an explicit
reconciliation case. It never refunds the reservation, silently marks a result
complete, or retries the external source request with a new idempotency key.

## Inspect a workspace

Authenticated workspace members can inspect open cases without exposing source
payloads or caller keys:

```text
GET /api/workspaces/:workspaceId/research/quota-reconciliation?limit=50
```

The response is private and no-store. Each bounded case contains the source and
policy identifiers, run and reservation identifiers, requested/actual record
and cost counters, and first/last-seen timestamps. It does not contain the raw
request, complaint content, idempotency key, or database error.

## Inspect or resolve with the maintenance role

The worker command uses `APPSEA_MAINTENANCE_DATABASE_URL`, which must identify
the standalone `appsea_maintenance` role. With no reservation ID it performs a
bounded inspection:

```powershell
$env:APPSEA_SOURCE_QUOTA_RECONCILIATION_WORKSPACE_ID = 'workspace:research'
$env:APPSEA_SOURCE_QUOTA_RECONCILIATION_LIMIT = '50'
pnpm worker:source:quota:reconcile
```

Resolution is an explicit operator action. Set all of the following values:

```powershell
$env:APPSEA_SOURCE_QUOTA_RECONCILIATION_RESERVATION_ID = 'quota:source:...'
$env:APPSEA_SOURCE_QUOTA_RECONCILIATION_RESOLUTION_CODE = 'linked_result'
$env:APPSEA_SOURCE_QUOTA_RECONCILIATION_LINKED_RUN_ID = 'run:...'
$env:APPSEA_SOURCE_QUOTA_RECONCILIATION_ACTOR_ID = 'operator:incident-123'
pnpm worker:source:quota:reconcile
```

Use `linked_result` only when the exact reservation run is already a completed
production result. Use `voided_no_result` when the request settled but no
result exists; omit `APPSEA_SOURCE_QUOTA_RECONCILIATION_LINKED_RUN_ID` in that
case. The database function rechecks the run identity, makes the resolution
idempotent, and stores only the bounded actor identifier and resolution code.

Resolution closes an inspection case only. It does not change source quota
windows, cost history, evidence, or collection policy, and it does not permit
automatic re-collection. A new source request requires a reviewed, new
idempotency decision and the normal policy/lease gates.

## Bounded alert inspection

Deployments can run the read-only alert inspection on a scheduler-owned cadence:

```powershell
$env:APPSEA_SOURCE_QUOTA_ALERT_MAX_WORKSPACES = '1000'
$env:APPSEA_SOURCE_QUOTA_ALERT_MAX_CASES_PER_WORKSPACE = '100'
$env:APPSEA_SOURCE_QUOTA_ALERT_AFTER_SECONDS = '900'
pnpm worker:source:quota:alert
```

The command enumerates active workspaces through `DATABASE_URL` (`appsea_service`)
and reads each private open-case projection through
`APPSEA_MAINTENANCE_DATABASE_URL` (`appsea_maintenance`). A maintenance
scheduler lease is acquired before either read and rechecked throughout the
scan. The result and metrics contain only bounded counts, age, threshold,
alert state, and a `truncated` coverage flag; no source, reservation, run, or
workspace identifier is emitted. The command never resolves a case, refunds a
reservation, or starts a collection request.

Route `source_quota_reconciliation_alert` to incident response when an open
case is at or above the threshold. Treat
`source_quota_reconciliation_alert_incomplete` (or a result with
`truncated: true`) as an unknown state that requires a larger bound or a
private operator inspection; it must not be treated as clear. The
`source_quota_reconciliation_clear` event is a complete bounded scan with no
case at the threshold. Scheduler deployment, alert routing, and retention
remain deployment responsibilities.

## Recovery and alerting

The source collection runner stops with a fixed reconciliation error when it
detects a settled reservation without a completed result. Operators should
inspect the case, verify PostgreSQL run/checkpoint state, and resolve it through
the maintenance role. Deployments should alert on
`source_quota_reconciliation_failed` and on open cases older than the incident
response threshold. The bounded alert inspection supplies the repository event
and counters; scheduler ownership, alert routing, and retention for this case
projection remain deployment responsibilities.

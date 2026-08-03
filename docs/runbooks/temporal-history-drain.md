# Temporal legacy-history drain and retention

AppSea production-analysis workflow `v2` carries only identifiers and immutable
digests. New executions receive the non-sensitive
`appsea-temporal-history-memo-v1` memo with `historyClass: identifier-only`.
Older `v1` executions may contain complaint-bearing arguments and must not be
removed from the worker fleet or decoded casually.

## Checker

Run the bounded visibility-only checker while the old worker remains available:

```bash
APPSEA_TEMPORAL_LEGACY_HISTORY_MANIFEST=C:\secure\appsea\legacy-history.json \
  pnpm worker:workflow:analysis:history:check
```

The command lists only `productionAnalysisWorkflow` visibility metadata. It
does not fetch history, query payloads, cancel workflows, terminate workflows,
delete history, or print arbitrary Temporal memos. It exits non-zero when an
unclassified/legacy execution has no reviewed disposition, a drained execution
is still visible, a retention deadline has expired, or the bounded scan is
truncated. `legacy_retention` is also non-zero: it means the old worker must
remain deployed until the reviewed deadline.

Optional bounds are `APPSEA_TEMPORAL_HISTORY_PAGE_SIZE` (1-100) and
`APPSEA_TEMPORAL_HISTORY_MAX_EXECUTIONS` (1-10,000).

## Manifest

The manifest is an operator-owned, reviewed inventory. Validate it through the
checker; never put complaint text, source payloads, credentials, or raw
idempotency keys in it. Its shape is:

```json
{
  "schemaVersion": "appsea-temporal-legacy-history-v1",
  "reviewedAt": "2026-08-03T00:00:00.000Z",
  "approvalReference": "ticket:temporal-history:42",
  "entries": [
    {
      "workflowId": "workflow:analysis:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "runId": "11111111-1111-4111-8111-111111111111",
      "disposition": "retained",
      "reviewedAt": "2026-08-03T00:00:00.000Z",
      "approvalReference": "ticket:temporal-history:42",
      "retentionUntil": "2026-09-03T00:00:00.000Z"
    }
  ]
}
```

Use `retained` only when the approved retention deadline and continued v1
worker ownership are explicit. Use `drained` only after the Temporal operator
has completed the separately approved archive/deletion action and the checker
no longer lists the execution. The checker is not authorization for that
destructive action.

## Release sequence

1. Deploy the v2-capable worker while keeping the reviewed v1 worker available.
2. Run the checker with a bounded maximum and capture its JSON result as an
   operational artifact; do not capture Temporal payloads or raw history.
3. For each legacy or unclassified execution, either keep the v1 worker under
   a reviewed retention manifest or use the approved Temporal archive/deletion
   procedure owned by the deployment operator.
4. Rerun the checker until it returns `clear` with zero legacy and unclassified
   visible executions.
5. Only then remove the v1 worker and change the deployment's history-retention
   policy. Keep the approval reference and checker result for audit.

The repository does not provision Temporal namespaces, retention, archival,
backups, or deletion permissions. Those remain deployment-owned controls.

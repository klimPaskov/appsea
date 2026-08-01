# Explicit source re-collection after deletion

This runbook describes the reviewed, identifier-only path for collecting one
source record again after a completed deletion tombstone. It is an explicit
repair/research action, not a background retry and not evidence that a source
is currently enabled for production use.

## Preconditions

- the workspace is active, private, and non-fixture;
- the source policy is active, approved, current, unexpired, and permits the
  requested research purpose;
- the source has a completed matching deletion tombstone for the same source
  and source-native record identifier; and
- an owner or editor intentionally submits the request through the private
  authenticated route.

The policy and source connector remain disabled until legal, privacy, and
security review approves activation. A completed tombstone is necessary but
does not activate a connector or waive policy review.

## Start the request

The private gateway accepts the tombstone identifier as an additive field on
the ordinary production collection request:

```text
POST /api/workspaces/:workspaceId/research/production
```

```json
{
  "sourceId": "cfpb-consumer-complaints",
  "policyVersion": "cfpb-v1",
  "limit": 1,
  "recollectionTombstoneId": "tombstone:source:one"
}
```

The complete request still needs the normal campaign, run, purpose, display,
budget, timestamp, and idempotency fields. The gateway checks workspace
membership and the completed tombstone before consuming workflow admission or
contacting Temporal. A missing, cross-source, incomplete, or cross-workspace
tombstone returns a bounded `422`; a database verification failure returns
`503` and does not consume admission.

The request schema and workflow input require `limit: 1`. The server binds the
authenticated actor, and the workflow hash includes the tombstone identifier
without carrying a raw caller key or source content into Temporal history.

## Collection and persistence guarantees

The CFPB connector uses the official complaint-by-ID route for the tombstone's
source-native identifier. The response is mapped through the same redaction and
consent checks as ordinary collection; raw provider JSON is not retained. The
connector emits no deletion tombstone for this exact-record request.

Migration `0050_explicit_source_recollection.sql` records the tombstone link
on the workflow projection, research run, and source item. Database triggers
require a completed matching tombstone, keep the link immutable, reject
synthetic rows, and preserve the old deleted source item as history. A partial
unique index prevents two active rows for the same workspace/source/record
while allowing the new active observation to coexist with its deleted
predecessor. Persistence verifies that every returned complaint is the exact
tombstone record and fails closed on any mismatch.

The new collection remains private and is not automatically sent to analysis,
the public leaderboard, a report, or a plan package. Review the resulting
complaint in the private collection route before any explicit downstream
analysis. Do not treat a successful re-collection as proof that the source is
complete or that the deleted content has been restored; provenance and the
coverage gap remain visible.

## Recovery and non-goals

- A replay of the same workflow identity returns the completed result without
  another source request or quota reservation.
- A settled quota reservation without a completed result remains an operator
  reconciliation case; it never triggers automatic re-collection.
- A failed or unavailable tombstone, source-policy mismatch, active-row
  conflict, or lineage mismatch requires operator review and a new reviewed
  request. Do not bypass the database guard or reuse the deleted row.
- Production deployment, scheduler ownership, alerting, provider retention,
  cloud object storage, and backup deletion are still release work.

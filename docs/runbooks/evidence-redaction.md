# Evidence redaction

Field-level evidence redaction is a private workspace privacy operation. It is
not a substitute for source deletion, retention expiry, object-store purge, or
backup deletion.

## Preconditions

- The workspace is active and private.
- The actor is an owner or editor of that workspace.
- The actor completed password reauthentication within the web step-up window.
- The evidence record is active and belongs to the selected production run and
  complaint.
- A raw source object reference is already absent before masking narrative
  text. If it is present, use the reviewed source-policy deletion path first.

## Operation

1. Open the private collection evidence route.
2. Expand `Privacy redaction` for the complaint.
3. Select only the fields that must be masked and choose the reason.
4. Submit once. The API creates a caller-supplied idempotency receipt under
   `appsea.evidence_redaction_events`; replaying the same receipt is safe, while
   reusing its identifier for a different target or field set is rejected.
5. Confirm that collection, opportunity, analysis, report, and coding-plan reads
   show the stable privacy marker or a null canonical locator. The source record
   ID, capture time, policy version, and content hash remain available for
   provenance.

The API route is:

```text
POST /api/workspaces/:workspaceId/research/production/:runId/complaints/:complaintId
```

The strict payload contains `evidenceId`, `redactionId`, `fields`, and
`reason`. Same-origin, session, membership, step-up, run/complaint binding, and
database role checks all apply. Imported complaint content is never treated as
an instruction for this operation.

## Limits and recovery

Redaction is monotonic for the selected projection fields. The immutable
analysis snapshot and content-addressed report/artifact objects remain
unchanged; private read mappers apply the persisted mask. A later source
deletion still follows the source connector's policy and may invalidate
dependent outputs. Cloud object-store, export, and backup deletion require a
separately reviewed retention workflow. There is no automatic re-collection or
re-analysis after a redaction request.

Validate changes with the contracts, database, and web tests, then run the
repository completion checks. Fresh PostgreSQL proof requires Docker and the
disposable integration environment; do not claim it when the Docker engine is
unavailable.

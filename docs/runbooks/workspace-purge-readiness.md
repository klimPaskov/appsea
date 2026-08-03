# Workspace purge readiness

Status: implemented as an owner inventory plus a durable, non-destructive purge
intent. Destructive deletion is still not implemented.

The private members page and `GET
/api/workspaces/:workspaceId/purge-readiness` expose the database-side checks
for an explicitly reviewed workspace-retention operation. The boundary is
owner-only, membership-authorized, cache-disabled, and returns metadata counts
only. It never queues or performs deletion.

After the inventory reaches `database_ready`, an owner may complete a recent
password step-up and type `REQUEST WORKSPACE PURGE` on the members page. The
private `POST /api/workspaces/:workspaceId/purge-request` route records a
durable `awaiting_external_controls` intent and identifier-only audit/outbox
receipts. Repeating the request is idempotent while one is active. The owner
can cancel that intent with `DELETE` and `CANCEL WORKSPACE PURGE`; cancellation
also performs no deletion. `GET /api/workspaces/:workspaceId/purge-request`
returns the latest owner-visible intent.

## Read the inventory

The response is a `WorkspacePurgeReadiness` contract from
`@appsea/contracts`:

- `blocked` means the workspace is not archived, active work remains, or one
  or more persisted raw/analysis/report/plan object references still need a
  retention operation.
- `database_ready` means those PostgreSQL-observable conditions are clear. It
  is not a production deletion approval.
- `externalRequirements` always names the three controls that are outside the
  repository boundary: cloud object-store purge, export-retention purge, and
  backup deletion verification.

The inventory does not return source payloads, report content, plan files,
object bodies, object hashes, or provider credentials. Counts are bounded to a
32-bit non-negative value before they enter the contract.

## Reviewed retention sequence

1. Stop new work and archive the workspace through the owner-only archival
   action. Archival retains lineage and is not deletion.
2. Finish or recover active workflow, run, handoff, lease, reconciliation, and
   recomputation work.
3. Complete source-policy deletion and retention propagation so raw source
   references are cleared according to the approved policy.
4. Provision and independently verify encrypted object storage, export
   retention, backup deletion, lifecycle/versioning, and incident controls.
5. Submit the owner intent through the private purge-request boundary so an
   operator can coordinate the external controls. This is a handoff, not an
   authorization to delete.
6. Add and review a separate destructive purge workflow with provider-side
   conditional deletion and an auditable, privacy-safe receipt. Do not infer
   that workflow from `database_ready` or from an `awaiting_external_controls`
   intent.

Until those provider and approval gates exist, AppSea must keep the external
requirements visible and must not present the inventory as a deletion result.

## Validation

- `packages/contracts` validates blocker/state consistency.
- `packages/db` tests owner authorization, the read-only projection query, the
  readiness gate, durable idempotent request, and cancellation boundaries.
- `apps/web` tests authentication, path validation, private response headers,
  exact confirmations, readiness conflicts, request creation, cancellation,
  and authorization failure handling.
- The full repository checks remain the completion gate; Docker-backed
  PostgreSQL and Temporal checks still require an available Docker Linux
  engine.

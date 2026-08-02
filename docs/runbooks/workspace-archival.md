# Workspace archival

Workspace archival is an owner-controlled, non-destructive lifecycle action.
It stops new research and refresh scheduling while retaining evidence lineage,
reports, plans, provenance, exports, object references, and backups.

## Web procedure

1. Sign in to the private workspace and open `/workspace/:workspaceId/members`.
2. Complete the password step-up in the owner controls.
3. Select `Archive workspace` and confirm the exact phrase `ARCHIVE WORKSPACE`.
4. If the API returns `409`, inspect `data.activeWorkCount`, wait for the
   listed durable work to settle, and retry. The endpoint never silently
   cancels active workflows.

The mutation is `DELETE /api/workspaces/:workspaceId` with a JSON body of
`{"confirmation":"ARCHIVE WORKSPACE"}`. It requires same-origin access,
an active session, recent reauthentication, and owner membership. Repeating a
successful request returns the archived state with `replayed: true`.

## Database boundary

Migration `0066_workspace_archival.sql` owns the transition through
`appsea.archive_workspace(text, text)`. The security-definer function locks the
workspace, verifies the transaction-local authenticated user is an owner, and
counts queued/running workflow, run, handoff, lease, reconciliation, and
recomputation work. It archives campaigns, clears refresh claims, revokes
pending invitations, and writes identifier-only audit/outbox receipts.

Archival is not deletion. Destructive workspace/object/backup/export purge,
provider lifecycle, and backup verification require separate reviewed
retention workers and deployment approvals.

## Validation

- `pnpm --filter @appsea/contracts test`
- `pnpm --filter @appsea/db test`
- `pnpm --filter @appsea/web test`
- `pnpm --filter @appsea/db typecheck`
- `pnpm --filter @appsea/web typecheck`
- PostgreSQL fresh-install and populated-upgrade integration gates when Docker
  and the approved role-separated deployment are available.

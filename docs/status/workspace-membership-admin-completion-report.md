# Workspace membership administration tranche

## Outcome

Private workspace owners can inspect the member roster, change a member's role,
and remove a member from the web settings route or the private API. Viewer and
editor callers cannot read the roster or mutate memberships. A workspace cannot
be left without an owner.

## Implementation

- `packages/contracts` defines strict member read and role-update schemas.
- Migration `0020_workspace_membership_admin.sql` adds a security-definer
  trigger. The trigger limits runtime mutation to owner actors, rejects identity
  rewrites, serializes checks per workspace, protects the last owner (including
  multi-row statements), and emits audit/outbox receipts so direct runtime SQL
  cannot bypass the event trail.
- Migration `0021_auth_step_up.sql` adds a session-only reauthentication
  timestamp. Explicit password verification marks a 15-minute step-up window;
  the timestamp is never returned in a session read model.
- `PostgresAuthRepository` performs owner authorization and row locking in a
  serializable, membership-authorized transaction. The database trigger emits
  identifier-only audit and outbox events for accepted mutations.
- Private routes expose `GET /api/workspaces/:workspaceId/members` and
  same-origin `PATCH`/`DELETE /api/workspaces/:workspaceId/members/:userId`.
- Owner mutations require a recent password step-up from
  `POST /api/auth/reauthenticate`; stale sessions receive a private `428`
  response and the settings panel provides an accessible verification form.
- `/workspace/:workspaceId/members` provides the owner settings surface. The
  public leaderboard remains unchanged and database-free.

## Validation

- Contracts tests cover strict role input and member read models.
- Database unit tests cover owner listing, durable mutation effects, non-owner
  rejection, and last-owner protection.
- PostgreSQL integration coverage creates owner/editor/viewer/co-owner members,
  verifies owner-only listing and mutation, checks audit/outbox receipts, and
  exercises both single-row and multi-row last-owner protection. It requires
  the disposable Docker PostgreSQL service;
  this environment currently cannot start Docker Desktop.
- Web and database lint/typecheck pass for the changed packages. Full build and
  repository gates remain the completion proof for the broader tranche.

## Remaining identity gaps

At the time of this membership-admin tranche, it did not add invitation delivery,
account deletion, external identity providers, or production role provisioning.
A later account-recovery tranche adds hash-only reset tokens and encrypted
outbox mechanics behind an explicit production kill switch. Authenticated
session listing and per-session revocation now live in the separate
`/account/security` tranche; a later account-closure tranche adds owner-safe
profile closure, while production recovery, identity-provider, and
role-provisioning work remain explicit blockers.

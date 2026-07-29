# Account closure

Account closure is available from `/account/security` and is intentionally a
private, two-step action.

1. The signed-in user reauthenticates with the current password. The session
   receives the existing 15-minute step-up marker; the password is never
   persisted or returned.
2. The user submits `DELETE MY ACCOUNT` to `DELETE /api/auth/account`.

The PostgreSQL `appsea.close_user_account` boundary checks the authenticated
user again and refuses closure while that user still owns any workspace. An
owner must first promote another existing member through the owner-protected
workspace-members route. This prevents private research from becoming
ownerless.

When closure succeeds, all active sessions are revoked, reset tokens are
invalidated, pending reset delivery material is discarded, and the profile is
replaced with a non-deliverable placeholder. Workspace memberships and
research rows are retained so other members keep access and provenance remains
intact. The public leaderboard is unaffected because it is synthetic and
database-free.

The operation is idempotent for an already closed account. The API clears the
current session cookie and returns a private no-store response. A production
deployment still needs reviewed identity-provider, verified-email, retention,
export, and object-store deletion policies; closure does not claim to purge
workspace research or backups.

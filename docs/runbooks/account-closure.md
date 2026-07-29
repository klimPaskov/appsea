# Account-closure runbook

## User path

1. Open `/account/security`.
2. Verify the password in the **Close account** section.
3. Type `DELETE MY ACCOUNT` and submit.
4. If the API returns `409`, open each listed workspace-members page and
   transfer ownership to another existing member. Retry after the transfer.

## Operator checks

- The database migration `0026_account_closure.sql` must be applied before the
  web route is enabled.
- Keep the account-closure endpoint same-origin and behind the existing
  authenticated rate limit. Do not add a route that accepts a caller-supplied
  user ID.
- Confirm logs contain only the fixed event name and account/workspace
  identifiers; never log passwords, session tokens, reset tokens, or the
  placeholder email.
- Verify `auth_security_events.event_type = 'account_closed'` and that active
  sessions and reset delivery payloads are revoked/discarded.
- Review workspace retention and external object-store/backups policy
  separately. Account closure intentionally retains shared workspace research.

## Recovery and incident handling

Closure is not reversible through the web UI. If closure was unauthorized,
revoke remaining workspace memberships, rotate provider credentials, preserve
the security-event identifier, and follow the identity incident procedure.
Do not restore a closed profile by editing `users` directly; use a reviewed
identity recovery process.

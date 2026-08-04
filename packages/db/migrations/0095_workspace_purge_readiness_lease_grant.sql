-- Migration 0095: allow the authenticated runtime to count active leases for
-- the owner-only, read-only workspace purge-readiness projection.
--
-- Migration 0039 intentionally revoked direct lease-table access from the
-- runtime role. The members page's non-destructive readiness read is a later,
-- explicitly workspace-scoped use case: grant only the two columns required by
-- its active-work count. Forced RLS and the authenticated workspace transaction
-- remain in force; maintenance mutations and lease lifecycle functions are not
-- exposed by this grant.

GRANT SELECT (workspace_id, state)
  ON appsea.source_collection_leases TO appsea_service;

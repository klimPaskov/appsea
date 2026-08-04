-- Campaign admission and later policy rechecks read selected source rows.
-- Keep that runtime read boundary explicit instead of relying on an earlier
-- broad grant that may not survive role hardening. These reads deliberately
-- do not request row locks because the service role must not receive UPDATE
-- privilege on globally operator-owned source metadata; execution-time
-- policy gates remain authoritative before collection writes.
GRANT SELECT ON appsea.sources,
  appsea.source_policy_versions,
  appsea.source_policy_reviews
TO appsea_service;

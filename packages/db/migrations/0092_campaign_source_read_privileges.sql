-- Campaign admission validates the selected source while holding a stable
-- source-row lock. Keep that runtime read boundary explicit instead of
-- relying on an earlier broad grant that may not survive role hardening.
GRANT SELECT ON appsea.sources,
  appsea.source_policy_versions,
  appsea.source_policy_reviews
TO appsea_service;

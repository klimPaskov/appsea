-- Durable authentication abuse controls and bounded retention. Keys are
-- already hashed by the repository; this table must not contain emails, IPs,
-- bearer tokens, or password material.
CREATE TABLE appsea.auth_rate_limits (
  rate_limit_key char(64) PRIMARY KEY CHECK (rate_limit_key ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL
);

CREATE INDEX auth_rate_limits_updated_idx
  ON appsea.auth_rate_limits (updated_at);

REVOKE ALL ON appsea.auth_rate_limits FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON appsea.auth_rate_limits TO appsea_service;
GRANT DELETE ON appsea.auth_sessions TO appsea_service;

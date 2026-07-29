-- Explicit password reauthentication records a short-lived step-up window on
-- the existing session. The timestamp is not part of the session read model;
-- it is only consulted by high-risk mutation boundaries.
ALTER TABLE appsea.auth_sessions
  ADD COLUMN last_reauthenticated_at timestamptz;

GRANT UPDATE (last_reauthenticated_at) ON appsea.auth_sessions TO appsea_service;

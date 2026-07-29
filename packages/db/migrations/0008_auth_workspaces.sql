-- Authentication material is deliberately separate from workspace-scoped
-- research rows. Passwords and bearer tokens are stored only as one-way
-- hashes; the plaintext values never cross this persistence boundary.
CREATE TABLE appsea.users (
  user_id text PRIMARY KEY CHECK (user_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 32 AND 512),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (email)
);

CREATE UNIQUE INDEX users_email_lower_idx ON appsea.users (lower(email));

CREATE TABLE appsea.auth_sessions (
  session_id text PRIMARY KEY CHECK (session_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  user_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (token_hash)
);

CREATE TABLE appsea.workspace_memberships (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX auth_sessions_user_idx ON appsea.auth_sessions (user_id, expires_at);
CREATE INDEX auth_sessions_active_idx ON appsea.auth_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX workspace_memberships_user_idx ON appsea.workspace_memberships (user_id, workspace_id);

-- Memberships are the one workspace-owned table that must be queried before a
-- workspace context exists. The null-context branch is restricted to the
-- authenticated user GUC (or the migration owner); all research tables remain
-- fail-closed without a workspace GUC. Once a context is set, the policy
-- narrows to it.
ALTER TABLE appsea.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.workspace_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.workspace_memberships
  USING (
    current_user = 'appsea_owner'
    OR (
      appsea.current_workspace_id() IS NULL
      AND user_id = NULLIF(current_setting('appsea.auth_user_id', true), '')
    )
    OR workspace_id = appsea.current_workspace_id()
  )
  WITH CHECK (
    current_user = 'appsea_owner'
    OR (
      appsea.current_workspace_id() IS NULL
      AND user_id = NULLIF(current_setting('appsea.auth_user_id', true), '')
    )
    OR workspace_id = appsea.current_workspace_id()
  );

-- Users and sessions are global authentication rows. Memberships remain
-- explicitly readable only as authorization metadata before context setup.
REVOKE ALL ON appsea.users, appsea.auth_sessions, appsea.workspace_memberships FROM PUBLIC;
GRANT SELECT, INSERT ON appsea.users TO appsea_service;
GRANT SELECT, INSERT ON appsea.auth_sessions TO appsea_service;
GRANT UPDATE (last_seen_at, revoked_at) ON appsea.auth_sessions TO appsea_service;
GRANT SELECT, INSERT, DELETE ON appsea.workspace_memberships TO appsea_service;

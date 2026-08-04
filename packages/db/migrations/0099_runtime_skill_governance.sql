-- Migration 0099: persist reviewed runtime-skill transitions without giving
-- worker or service roles a path to create, alter, or activate a skill.

CREATE TABLE appsea.runtime_skills (
  skill_id text PRIMARY KEY
    CHECK (skill_id ~ '^[a-z0-9][a-z0-9._:/-]{0,191}$'),
  name text NOT NULL
    CHECK (name ~ '^[a-z0-9][a-z0-9._:/-]{0,191}$'),
  version text NOT NULL
    CHECK (version ~ '^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$'),
  status text NOT NULL
    CHECK (status IN ('proposed', 'evaluated', 'approved', 'active', 'retired')),
  requested_permissions jsonb NOT NULL
    CHECK (jsonb_typeof(requested_permissions) = 'array'),
  proposed_by text NOT NULL
    CHECK (proposed_by ~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'),
  record_json jsonb NOT NULL
    CHECK (jsonb_typeof(record_json) = 'object'),
  record_hash text NOT NULL
    CHECK (record_hash ~ '^[a-f0-9]{64}$'),
  last_event_id text NOT NULL
    CHECK (last_event_id ~ '^[a-z0-9][a-z0-9._:/-]{0,191}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (name, version)
);

CREATE TABLE appsea.runtime_skill_events (
  event_id text PRIMARY KEY
    CHECK (event_id ~ '^[a-z0-9][a-z0-9._:/-]{0,191}$'),
  skill_id text NOT NULL
    REFERENCES appsea.runtime_skills(skill_id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type IN ('proposal', 'evaluation', 'approval', 'activation', 'retirement')),
  actor_id text NOT NULL
    CHECK (actor_id ~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'),
  before_record_hash text
    CHECK (before_record_hash IS NULL OR before_record_hash ~ '^[a-f0-9]{64}$'),
  after_record_hash text NOT NULL
    CHECK (after_record_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX runtime_skills_status_updated_idx
  ON appsea.runtime_skills (status, updated_at DESC, skill_id);
CREATE INDEX runtime_skill_events_skill_history_idx
  ON appsea.runtime_skill_events (skill_id, occurred_at DESC, event_id DESC);

ALTER TABLE appsea.runtime_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.runtime_skills FORCE ROW LEVEL SECURITY;
ALTER TABLE appsea.runtime_skill_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.runtime_skill_events FORCE ROW LEVEL SECURITY;

CREATE POLICY runtime_skills_owner_scope ON appsea.runtime_skills
  USING (current_user = 'appsea_owner')
  WITH CHECK (current_user = 'appsea_owner');
CREATE POLICY runtime_skill_events_owner_scope ON appsea.runtime_skill_events
  USING (current_user = 'appsea_owner')
  WITH CHECK (current_user = 'appsea_owner');

REVOKE ALL ON appsea.runtime_skills FROM PUBLIC, appsea_service, appsea_maintenance, appsea_migrator;
REVOKE ALL ON appsea.runtime_skill_events FROM PUBLIC, appsea_service, appsea_maintenance, appsea_migrator;

CREATE OR REPLACE FUNCTION appsea.prevent_runtime_skill_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  RAISE EXCEPTION 'runtime skill events are immutable'
    USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER runtime_skill_events_immutable_guard
BEFORE UPDATE OR DELETE ON appsea.runtime_skill_events
FOR EACH ROW EXECUTE FUNCTION appsea.prevent_runtime_skill_event_mutation();

CREATE OR REPLACE FUNCTION appsea.persist_runtime_skill_record(
  p_event_id text,
  p_skill_id text,
  p_name text,
  p_version text,
  p_status text,
  p_requested_permissions jsonb,
  p_proposed_by text,
  p_record_json jsonb,
  p_record_hash text,
  p_event_type text,
  p_actor_id text,
  p_occurred_at timestamptz,
  p_expected_record_hash text
)
RETURNS TABLE(replayed boolean, record_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  stored_event appsea.runtime_skill_events%ROWTYPE;
  stored_skill appsea.runtime_skills%ROWTYPE;
  next_now timestamptz;
  event_actor text;
  has_privileged_permission boolean;
BEGIN
  IF session_user <> 'appsea_migrator' THEN
    RAISE EXCEPTION 'runtime skill persistence requires the migration operator role'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NULL OR p_event_id !~ '^[a-z0-9][a-z0-9._:/-]{0,191}$'
     OR p_skill_id IS NULL OR p_skill_id !~ '^[a-z0-9][a-z0-9._:/-]{0,191}$'
     OR p_name IS NULL OR p_name !~ '^[a-z0-9][a-z0-9._:/-]{0,191}$'
     OR p_version IS NULL OR p_version !~ '^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$'
     OR p_status NOT IN ('proposed', 'evaluated', 'approved', 'active', 'retired')
     OR p_requested_permissions IS NULL OR jsonb_typeof(p_requested_permissions) <> 'array'
     OR p_proposed_by IS NULL OR p_proposed_by !~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'
     OR p_record_json IS NULL OR jsonb_typeof(p_record_json) <> 'object'
     OR p_record_hash IS NULL OR p_record_hash !~ '^[a-f0-9]{64}$'
     OR p_event_type NOT IN ('proposal', 'evaluation', 'approval', 'activation', 'retirement')
     OR p_actor_id IS NULL OR p_actor_id !~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'
     OR p_occurred_at IS NULL
     OR (p_expected_record_hash IS NOT NULL AND p_expected_record_hash !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'invalid runtime skill persistence input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO stored_event
    FROM appsea.runtime_skill_events
   WHERE event_id = p_event_id;
  IF stored_event.event_id IS NOT NULL THEN
    IF stored_event.skill_id IS DISTINCT FROM p_skill_id
       OR stored_event.event_type IS DISTINCT FROM p_event_type
       OR stored_event.actor_id IS DISTINCT FROM p_actor_id
       OR stored_event.after_record_hash IS DISTINCT FROM p_record_hash
       OR stored_event.before_record_hash IS DISTINCT FROM p_expected_record_hash THEN
      RAISE EXCEPTION 'runtime skill event id conflicts with immutable history'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT true, stored_event.after_record_hash;
    RETURN;
  END IF;

  IF p_record_json->>'id' IS DISTINCT FROM p_skill_id
     OR p_record_json->>'name' IS DISTINCT FROM p_name
     OR p_record_json->>'version' IS DISTINCT FROM p_version
     OR p_record_json->>'status' IS DISTINCT FROM p_status
     OR p_record_json->'requestedPermissions' IS DISTINCT FROM p_requested_permissions
     OR p_record_json->>'proposedBy' IS DISTINCT FROM p_proposed_by THEN
    RAISE EXCEPTION 'runtime skill scalar fields do not match the signed record'
      USING ERRCODE = '23514';
  END IF;

  IF p_event_type = 'proposal' THEN
    event_actor := p_record_json->>'proposedBy';
  ELSIF p_event_type = 'evaluation' THEN
    IF jsonb_array_length(p_record_json->'evaluations') = 0 THEN
      RAISE EXCEPTION 'evaluation event requires evaluation evidence' USING ERRCODE = '23514';
    END IF;
    event_actor := p_record_json->'evaluations'->(jsonb_array_length(p_record_json->'evaluations') - 1)->>'evaluatorId';
  ELSIF p_event_type = 'approval' THEN
    event_actor := p_record_json->'approval'->>'approvedBy';
  ELSIF p_event_type = 'activation' THEN
    event_actor := p_record_json->'activation'->>'activatedBy';
  ELSE
    event_actor := p_record_json->'retirement'->>'retiredBy';
  END IF;
  IF event_actor IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'runtime skill event actor does not match signed evidence'
      USING ERRCODE = '42501';
  END IF;

  IF (p_event_type = 'proposal' AND p_status <> 'proposed')
     OR (p_event_type = 'evaluation' AND p_status <> 'evaluated')
     OR (p_event_type = 'approval' AND p_status <> 'approved')
     OR (p_event_type = 'activation' AND p_status <> 'active')
     OR (p_event_type = 'retirement' AND p_status <> 'retired') THEN
    RAISE EXCEPTION 'runtime skill event type does not match status' USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(p_requested_permissions) permission
     WHERE permission IN (
       'deploy-production', 'manage-credentials', 'change-retention',
       'run-migrations', 'grant-permissions', 'activate-sources'
     )
  ) INTO has_privileged_permission;
  IF p_status = 'active' AND has_privileged_permission AND p_actor_id !~ '^operator:' THEN
    RAISE EXCEPTION 'privileged runtime skill activation requires an operator actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO stored_skill
    FROM appsea.runtime_skills
   WHERE skill_id = p_skill_id
   FOR UPDATE;

  IF stored_skill.skill_id IS NULL THEN
    IF p_expected_record_hash IS NOT NULL OR p_event_type <> 'proposal' THEN
      RAISE EXCEPTION 'runtime skill initial state is invalid' USING ERRCODE = '23514';
    END IF;
    next_now := clock_timestamp();
    INSERT INTO appsea.runtime_skills
      (skill_id, name, version, status, requested_permissions, proposed_by,
       record_json, record_hash, last_event_id, created_at, updated_at)
    VALUES
      (p_skill_id, p_name, p_version, p_status, p_requested_permissions, p_proposed_by,
       p_record_json, p_record_hash, p_event_id, next_now, next_now);
  ELSE
    IF stored_skill.name IS DISTINCT FROM p_name
       OR stored_skill.version IS DISTINCT FROM p_version
       OR stored_skill.requested_permissions IS DISTINCT FROM p_requested_permissions
       OR stored_skill.proposed_by IS DISTINCT FROM p_proposed_by THEN
      RAISE EXCEPTION 'runtime skill identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF p_expected_record_hash IS NULL OR stored_skill.record_hash IS DISTINCT FROM p_expected_record_hash THEN
      RAISE EXCEPTION 'runtime skill optimistic concurrency check failed' USING ERRCODE = '40001';
    END IF;
    IF NOT (
      (stored_skill.status = 'proposed' AND p_status = 'evaluated')
      OR (stored_skill.status = 'evaluated' AND p_status IN ('evaluated', 'approved'))
      OR (stored_skill.status = 'approved' AND p_status = 'active')
      OR (stored_skill.status = 'active' AND p_status = 'retired')
    ) THEN
      RAISE EXCEPTION 'runtime skill status transition is invalid' USING ERRCODE = '23514';
    END IF;
    UPDATE appsea.runtime_skills
       SET status = p_status,
           record_json = p_record_json,
           record_hash = p_record_hash,
           last_event_id = p_event_id,
           updated_at = clock_timestamp()
     WHERE skill_id = p_skill_id;
  END IF;

  INSERT INTO appsea.runtime_skill_events
    (event_id, skill_id, event_type, actor_id, before_record_hash,
     after_record_hash, occurred_at)
  VALUES
    (p_event_id, p_skill_id, p_event_type, p_actor_id, p_expected_record_hash,
     p_record_hash, p_occurred_at);

  RETURN QUERY SELECT false, p_record_hash;
END
$$;

CREATE OR REPLACE FUNCTION appsea.read_runtime_skill_record(p_skill_id text)
RETURNS TABLE(
  skill_id text,
  name text,
  version text,
  status text,
  requested_permissions jsonb,
  proposed_by text,
  record_json jsonb,
  record_hash text,
  last_event_id text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user NOT IN ('appsea_migrator', 'appsea_owner') THEN
    RAISE EXCEPTION 'runtime skill reads require an operator role' USING ERRCODE = '42501';
  END IF;
  IF p_skill_id IS NULL OR p_skill_id !~ '^[a-z0-9][a-z0-9._:/-]{0,191}$' THEN
    RAISE EXCEPTION 'invalid runtime skill id' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT skill.skill_id, skill.name, skill.version, skill.status,
           skill.requested_permissions, skill.proposed_by, skill.record_json,
           skill.record_hash, skill.last_event_id, skill.created_at, skill.updated_at
      FROM appsea.runtime_skills skill
     WHERE skill.skill_id = p_skill_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.list_runtime_skill_records(p_limit integer)
RETURNS TABLE(
  skill_id text,
  name text,
  version text,
  status text,
  requested_permissions jsonb,
  proposed_by text,
  record_json jsonb,
  record_hash text,
  last_event_id text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user NOT IN ('appsea_migrator', 'appsea_owner') THEN
    RAISE EXCEPTION 'runtime skill reads require an operator role' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'runtime skill list limit is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT skill.skill_id, skill.name, skill.version, skill.status,
           skill.requested_permissions, skill.proposed_by, skill.record_json,
           skill.record_hash, skill.last_event_id, skill.created_at, skill.updated_at
      FROM appsea.runtime_skills skill
     ORDER BY skill.updated_at DESC, skill.skill_id
     LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION appsea.read_runtime_skill_event(p_event_id text)
RETURNS TABLE(
  event_id text,
  skill_id text,
  event_type text,
  actor_id text,
  before_record_hash text,
  after_record_hash text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user NOT IN ('appsea_migrator', 'appsea_owner') THEN
    RAISE EXCEPTION 'runtime skill reads require an operator role' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_event_id !~ '^[a-z0-9][a-z0-9._:/-]{0,191}$' THEN
    RAISE EXCEPTION 'invalid runtime skill event id' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT event.event_id, event.skill_id, event.event_type, event.actor_id,
           event.before_record_hash, event.after_record_hash, event.occurred_at
      FROM appsea.runtime_skill_events event
     WHERE event.event_id = p_event_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.list_runtime_skill_events(p_skill_id text, p_limit integer)
RETURNS TABLE(
  event_id text,
  skill_id text,
  event_type text,
  actor_id text,
  before_record_hash text,
  after_record_hash text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user NOT IN ('appsea_migrator', 'appsea_owner') THEN
    RAISE EXCEPTION 'runtime skill reads require an operator role' USING ERRCODE = '42501';
  END IF;
  IF p_skill_id IS NULL OR p_skill_id !~ '^[a-z0-9][a-z0-9._:/-]{0,191}$'
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'runtime skill event list input is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT event.event_id, event.skill_id, event.event_type, event.actor_id,
           event.before_record_hash, event.after_record_hash, event.occurred_at
      FROM appsea.runtime_skill_events event
     WHERE event.skill_id = p_skill_id
     ORDER BY event.occurred_at DESC, event.event_id DESC
     LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION appsea.prevent_runtime_skill_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.persist_runtime_skill_record(
  text, text, text, text, text, jsonb, text, jsonb, text, text, text, timestamptz, text
) FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.read_runtime_skill_record(text) FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.list_runtime_skill_records(integer) FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.read_runtime_skill_event(text) FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.list_runtime_skill_events(text, integer) FROM PUBLIC, appsea_service, appsea_maintenance;

GRANT EXECUTE ON FUNCTION appsea.persist_runtime_skill_record(
  text, text, text, text, text, jsonb, text, jsonb, text, text, text, timestamptz, text
) TO appsea_migrator;
GRANT EXECUTE ON FUNCTION appsea.read_runtime_skill_record(text) TO appsea_migrator;
GRANT EXECUTE ON FUNCTION appsea.list_runtime_skill_records(integer) TO appsea_migrator;
GRANT EXECUTE ON FUNCTION appsea.read_runtime_skill_event(text) TO appsea_migrator;
GRANT EXECUTE ON FUNCTION appsea.list_runtime_skill_events(text, integer) TO appsea_migrator;

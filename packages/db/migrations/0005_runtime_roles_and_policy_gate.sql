ALTER TABLE appsea.source_items
  ADD COLUMN collection_purpose text;
ALTER TABLE appsea.source_items
  ADD COLUMN requested_display_mode text;

UPDATE appsea.source_items source_item
   SET requested_display_mode = policy.display_mode
  FROM appsea.source_policy_versions policy
 WHERE policy.source_id = source_item.source_id
   AND policy.policy_version = source_item.source_policy_version;

UPDATE appsea.source_items source_item
   SET collection_purpose = 'testing'
  FROM appsea.sources source,
       appsea.source_policy_versions policy
 WHERE source.source_id = source_item.source_id
   AND source.source_type = 'fixture'
   AND policy.source_id = source_item.source_id
   AND policy.policy_version = source_item.source_policy_version
   AND source_item.synthetic
   AND policy.display_mode = 'fixture'
   AND 'testing' = ANY(policy.permitted_purposes);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM appsea.source_items
     WHERE collection_purpose IS NULL
        OR requested_display_mode IS NULL
  ) THEN
    RAISE EXCEPTION
      'source-item collection intent cannot be reconstructed safely; migrate those rows explicitly'
      USING ERRCODE = '23514';
  END IF;
END
$$;

ALTER TABLE appsea.source_items
  ALTER COLUMN collection_purpose SET NOT NULL;
ALTER TABLE appsea.source_items
  ALTER COLUMN requested_display_mode SET NOT NULL;

CREATE OR REPLACE FUNCTION appsea.enforce_collectible_source_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  policy_is_collectible boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM appsea.sources source
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = source.source_id
       AND policy.policy_version = NEW.source_policy_version
     WHERE source.source_id = NEW.source_id
       AND source.lifecycle_state = 'active'
       AND source.current_policy_version = NEW.source_policy_version
       AND policy.policy_state = 'approved'
       AND policy.commercial_use IN ('allowed', 'restricted')
       AND policy.reviewed_at IS NOT NULL
       AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
       AND NEW.collection_purpose = ANY(policy.permitted_purposes)
       AND NEW.requested_display_mode = policy.display_mode
       AND (
         (
           source.source_type = 'fixture'
           AND NEW.synthetic
           AND NEW.collection_purpose = 'testing'
           AND NEW.requested_display_mode = 'fixture'
         )
         OR (source.source_type <> 'fixture' AND NOT NEW.synthetic)
       )
  ) INTO policy_is_collectible;

  IF NOT policy_is_collectible THEN
    RAISE EXCEPTION 'source policy is not collectible for source %', NEW.source_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER source_items_policy_gate
BEFORE INSERT OR UPDATE OF source_id, source_policy_version, collection_purpose,
  requested_display_mode, synthetic
ON appsea.source_items
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_collectible_source_policy();

CREATE OR REPLACE FUNCTION appsea.enforce_evidence_display_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  display_is_allowed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM appsea.source_items source_item
     WHERE source_item.workspace_id = NEW.workspace_id
       AND source_item.source_item_id = NEW.source_item_id
       AND source_item.requested_display_mode = NEW.allowed_representation
       AND source_item.synthetic = NEW.synthetic
  ) INTO display_is_allowed;

  IF NOT display_is_allowed THEN
    RAISE EXCEPTION 'evidence representation is not allowed for source item %', NEW.source_item_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER evidence_records_display_gate
BEFORE INSERT OR UPDATE OF source_item_id, allowed_representation, synthetic
ON appsea.evidence_records
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_evidence_display_policy();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM appsea.evidence_records evidence
      JOIN appsea.source_items source_item
        ON source_item.workspace_id = evidence.workspace_id
       AND source_item.source_item_id = evidence.source_item_id
     WHERE evidence.allowed_representation <> source_item.requested_display_mode
        OR evidence.synthetic <> source_item.synthetic
  ) THEN
    RAISE EXCEPTION 'existing evidence violates source display policy'
      USING ERRCODE = '23514';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION appsea.register_fixture_source_policy(
  p_source_id text,
  p_display_name text,
  p_policy_version text,
  p_permitted_purposes text[],
  p_access_method text,
  p_retention_days integer,
  p_deletion_required boolean,
  p_attribution_required boolean,
  p_coverage_notes text[],
  p_reviewed_at timestamptz,
  p_policy_payload jsonb,
  p_content_hash text,
  p_recorded_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  stored_source_type text;
  stored_lifecycle_state text;
  stored_policy_version text;
  stored_policy_reviewed_at timestamptz;
BEGIN
  IF p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR char_length(p_display_name) NOT BETWEEN 1 AND 160
     OR char_length(p_policy_version) NOT BETWEEN 1 AND 80
     OR p_reviewed_at IS NULL
     OR NOT ('testing' = ANY(p_permitted_purposes))
     OR NOT (p_permitted_purposes <@ ARRAY['development', 'testing', 'demonstration']::text[])
     OR p_retention_days < 0
     OR p_content_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid fixture source policy' USING ERRCODE = '22023';
  END IF;

  INSERT INTO appsea.sources
    (source_id, display_name, source_type, lifecycle_state, created_at, updated_at)
  VALUES
    (p_source_id, p_display_name, 'fixture', 'disabled_pending_review', p_recorded_at, p_recorded_at)
  ON CONFLICT (source_id) DO NOTHING;

  SELECT source.source_type,
         source.lifecycle_state,
         source.current_policy_version,
         current_policy.reviewed_at
    INTO stored_source_type,
         stored_lifecycle_state,
         stored_policy_version,
         stored_policy_reviewed_at
    FROM appsea.sources source
    LEFT JOIN appsea.source_policy_versions current_policy
      ON current_policy.source_id = source.source_id
     AND current_policy.policy_version = source.current_policy_version
   WHERE source.source_id = p_source_id
   FOR UPDATE OF source;

  IF stored_source_type <> 'fixture' THEN
    RAISE EXCEPTION 'source identifier is already owned by a non-fixture source'
      USING ERRCODE = '23505';
  END IF;
  IF stored_lifecycle_state NOT IN ('active', 'disabled_pending_review') THEN
    RAISE EXCEPTION 'fixture source is disabled by policy or operator action'
      USING ERRCODE = '42501';
  END IF;
  IF stored_policy_version IS NOT NULL
     AND stored_policy_version <> p_policy_version
     AND (stored_policy_reviewed_at IS NULL OR p_reviewed_at <= stored_policy_reviewed_at) THEN
    RAISE EXCEPTION 'fixture source policy cannot move backward or sideways in review time'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO appsea.source_policy_versions
    (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
     access_method, retention_days, deletion_required, attribution_required,
     display_mode, coverage_notes, reviewed_at, policy_payload, content_hash, created_at)
  VALUES
    (p_source_id, p_policy_version, 'approved', p_permitted_purposes, 'allowed',
     p_access_method, p_retention_days, p_deletion_required, p_attribution_required,
     'fixture', p_coverage_notes, p_reviewed_at, p_policy_payload, p_content_hash, p_recorded_at)
  ON CONFLICT (source_id, policy_version) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM appsea.source_policy_versions
     WHERE source_id = p_source_id
       AND policy_version = p_policy_version
       AND content_hash = p_content_hash
       AND policy_state = 'approved'
       AND permitted_purposes = p_permitted_purposes
       AND commercial_use = 'allowed'
       AND display_mode = 'fixture'
       AND reviewed_at = p_reviewed_at
  ) THEN
    RAISE EXCEPTION 'fixture policy version conflicts with immutable content'
      USING ERRCODE = '23505';
  END IF;

  UPDATE appsea.sources
     SET display_name = p_display_name,
         lifecycle_state = 'active',
         current_policy_version = p_policy_version,
         updated_at = GREATEST(updated_at, p_recorded_at)
   WHERE source_id = p_source_id;
END
$$;

REVOKE ALL ON SCHEMA appsea FROM PUBLIC;
GRANT USAGE ON SCHEMA appsea TO appsea_service;

REVOKE ALL ON ALL TABLES IN SCHEMA appsea FROM appsea_service;
GRANT SELECT ON ALL TABLES IN SCHEMA appsea TO appsea_service;
GRANT INSERT ON
  appsea.workspaces,
  appsea.research_campaigns,
  appsea.research_runs,
  appsea.source_items,
  appsea.research_run_source_items,
  appsea.evidence_records,
  appsea.complaint_observations,
  appsea.research_run_complaints,
  appsea.complaint_cluster_versions,
  appsea.cluster_memberships,
  appsea.competitors,
  appsea.opportunities,
  appsea.opportunity_clusters,
  appsea.opportunity_competitors,
  appsea.opportunity_score_snapshots,
  appsea.report_versions,
  appsea.plan_package_versions,
  appsea.audit_events,
  appsea.cost_ledger_entries,
  appsea.deletion_tombstones,
  appsea.outbox_events,
  appsea.research_run_opportunities,
  appsea.research_run_score_snapshots,
  appsea.research_run_plan_packages,
  appsea.research_run_cluster_versions,
  appsea.research_run_competitors,
  appsea.research_run_source_policies
TO appsea_service;
GRANT UPDATE (updated_at) ON appsea.workspaces TO appsea_service;
GRANT UPDATE (state, configuration, budget, updated_at)
  ON appsea.research_campaigns TO appsea_service;
GRANT UPDATE (
  state, started_at, completed_at, finished_at, failure_code, failure_summary,
  coverage_gaps, warnings
) ON appsea.research_runs TO appsea_service;
GRANT UPDATE (
  slug, name, one_line, thesis, audience, first_wedge, complaint_count, tags,
  contrary_evidence, state, source_run_id, current_score_snapshot_id,
  current_plan_package_id, updated_at
) ON appsea.opportunities TO appsea_service;
GRANT UPDATE (state, completed_at, affected_object_count)
  ON appsea.deletion_tombstones TO appsea_service;
GRANT UPDATE (published_at, attempt_count)
  ON appsea.outbox_events TO appsea_service;
GRANT DELETE ON appsea.opportunity_clusters, appsea.opportunity_competitors
  TO appsea_service;

REVOKE ALL ON FUNCTION appsea.register_fixture_source_policy(
  text, text, text, text[], text, integer, boolean, boolean, text[], timestamptz, jsonb, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.register_fixture_source_policy(
  text, text, text, text[], text, integer, boolean, boolean, text[], timestamptz, jsonb, text, timestamptz
) TO appsea_service;
REVOKE ALL ON FUNCTION appsea.enforce_collectible_source_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_evidence_display_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.current_workspace_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.current_workspace_id() TO appsea_service;

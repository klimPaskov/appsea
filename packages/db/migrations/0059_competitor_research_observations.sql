BEGIN;

-- Competitive claims are retained as small, provenance-only observations.
-- Raw source payloads remain in the source/evidence boundary and are never
-- copied into this table or exposed by its private read model.
CREATE TABLE appsea.competitor_research_observations (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  observation_id text NOT NULL CHECK (observation_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  opportunity_id text NOT NULL,
  competitor_id text NOT NULL,
  source_id text NOT NULL CHECK (source_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  source_record_id text NOT NULL CHECK (char_length(source_record_id) BETWEEN 1 AND 240),
  source_item_id text NOT NULL,
  evidence_id text,
  claim_type text NOT NULL CHECK (
    claim_type IN (
      'positioning', 'feature', 'pricing', 'weakness', 'contrary_signal',
      'availability', 'recent_change'
    )
  ),
  claim text NOT NULL CHECK (char_length(claim) BETWEEN 1 AND 2000),
  observed_at timestamptz NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  review_state text NOT NULL DEFAULT 'unreviewed' CHECK (
    review_state IN ('unreviewed', 'confirmed', 'rejected')
  ),
  synthetic boolean NOT NULL,
  allowed_representation text NOT NULL CHECK (
    allowed_representation IN ('excerpt', 'metadata-only', 'aggregate-only', 'fixture')
  ),
  canonical_locator text,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL CHECK (created_by ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  reviewed_by text CHECK (reviewed_by IS NULL OR reviewed_by ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, observation_id),
  FOREIGN KEY (workspace_id, opportunity_id, competitor_id)
    REFERENCES appsea.opportunity_competitors(workspace_id, opportunity_id, competitor_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_item_id)
    REFERENCES appsea.source_items(workspace_id, source_item_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES appsea.evidence_records(workspace_id, evidence_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, opportunity_id, competitor_id, source_item_id, claim_type, content_hash),
  CHECK ((review_state = 'unreviewed') = (reviewed_by IS NULL AND reviewed_at IS NULL)),
  CHECK (review_state <> 'unreviewed' OR (reviewed_by IS NULL AND reviewed_at IS NULL)),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CHECK (updated_at >= created_at)
);

CREATE INDEX competitor_research_observations_opportunity_idx
  ON appsea.competitor_research_observations
     (workspace_id, opportunity_id, competitor_id, observed_at DESC, observation_id);
CREATE INDEX competitor_research_observations_source_idx
  ON appsea.competitor_research_observations
     (workspace_id, source_item_id, evidence_id, review_state);

ALTER TABLE appsea.competitor_research_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.competitor_research_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.competitor_research_observations
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

-- An observation may only point at an existing, active source item and its
-- matching evidence. Non-synthetic claims require a separately approved
-- competitor-research purpose and a collection made for that purpose. The
-- trigger derives canonical source identity from the source item so callers
-- cannot substitute a URL, source id, or source record id.
CREATE OR REPLACE FUNCTION appsea.enforce_competitor_research_observation_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  source_row record;
  evidence_row record;
  policy_is_allowed boolean;
BEGIN
  SELECT source_item.source_id,
         source_item.source_policy_version,
         source_item.source_item_id,
         source_item.source_record_id,
         source_item.canonical_locator,
         source_item.captured_at,
         source_item.synthetic AS source_synthetic,
         source_item.requested_display_mode,
         source_item.collection_purpose,
         source_item.deletion_state,
         source.source_type,
         source.lifecycle_state,
         source.current_policy_version,
         policy.policy_state,
         policy.permitted_purposes,
         policy.commercial_use,
         policy.display_mode,
         policy.reviewed_at,
         policy.expires_at,
         policy.content_hash
    INTO source_row
    FROM appsea.source_items source_item
    JOIN appsea.sources source
      ON source.source_id = source_item.source_id
    JOIN appsea.source_policy_versions policy
      ON policy.source_id = source_item.source_id
     AND policy.policy_version = source_item.source_policy_version
   WHERE source_item.workspace_id = NEW.workspace_id
     AND source_item.source_item_id = NEW.source_item_id;

  IF source_row.source_item_id IS NULL THEN
    RAISE EXCEPTION 'competitor observation source item was not found'
      USING ERRCODE = '23503';
  END IF;
  IF source_row.deletion_state <> 'active' THEN
    RAISE EXCEPTION 'competitor observation source item is not active'
      USING ERRCODE = '42501';
  END IF;
  IF source_row.source_id <> NEW.source_id
     OR source_row.source_record_id <> NEW.source_record_id
     OR source_row.source_synthetic IS DISTINCT FROM NEW.synthetic
     OR source_row.requested_display_mode <> NEW.allowed_representation THEN
    RAISE EXCEPTION 'competitor observation provenance does not match its source item'
      USING ERRCODE = '42501';
  END IF;

  NEW.canonical_locator := source_row.canonical_locator;

  IF NEW.evidence_id IS NOT NULL THEN
    SELECT evidence.source_item_id,
           evidence.allowed_representation,
           evidence.synthetic,
           evidence.deletion_state
      INTO evidence_row
      FROM appsea.evidence_records evidence
     WHERE evidence.workspace_id = NEW.workspace_id
       AND evidence.evidence_id = NEW.evidence_id;
    IF evidence_row.source_item_id IS NULL
       OR evidence_row.source_item_id <> NEW.source_item_id
       OR evidence_row.allowed_representation <> NEW.allowed_representation
       OR evidence_row.synthetic IS DISTINCT FROM NEW.synthetic
       OR evidence_row.deletion_state <> 'active' THEN
      RAISE EXCEPTION 'competitor observation evidence does not match its source item'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.synthetic THEN
    policy_is_allowed := source_row.source_type = 'fixture'
      AND source_row.source_synthetic
      AND source_row.display_mode = 'fixture'
      AND NEW.allowed_representation = 'fixture'
      AND source_row.collection_purpose = 'testing';
  ELSE
    SELECT EXISTS (
      SELECT 1
        FROM appsea.source_policy_reviews review
       WHERE review.source_id = source_row.source_id
         AND review.policy_version = source_row.source_policy_version
         AND review.decision = 'approved'
         AND review.content_hash = source_row.content_hash
         AND review.independence_attested
         AND review.reviewer_role <> 'legacy'
    )
    INTO policy_is_allowed;
    policy_is_allowed := policy_is_allowed
      AND source_row.source_type <> 'fixture'
      AND NOT source_row.source_synthetic
      AND source_row.lifecycle_state = 'active'
      AND source_row.current_policy_version = source_row.source_policy_version
      AND source_row.policy_state = 'approved'
      AND source_row.commercial_use IN ('allowed', 'restricted')
      AND source_row.reviewed_at IS NOT NULL
      AND (source_row.expires_at IS NULL OR source_row.expires_at > clock_timestamp())
      AND 'competitor-research' = ANY(source_row.permitted_purposes)
      AND source_row.collection_purpose = 'competitor-research'
      AND source_row.display_mode = NEW.allowed_representation;

    IF NEW.evidence_id IS NULL THEN
      policy_is_allowed := false;
    END IF;
  END IF;

  IF policy_is_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'competitor observation source policy is not approved for competitor-research'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.observed_at > clock_timestamp() THEN
    RAISE EXCEPTION 'competitor observation cannot be dated in the future'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER competitor_research_observation_policy_gate
BEFORE INSERT OR UPDATE OF source_id, source_record_id, source_item_id, evidence_id,
  synthetic, allowed_representation, observed_at
ON appsea.competitor_research_observations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_competitor_research_observation_policy();

-- Review state is a human governance boundary. Only a workspace editor or
-- owner may create/review a row, and a rejected observation cannot be revived.
CREATE OR REPLACE FUNCTION appsea.enforce_competitor_research_observation_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor text := current_setting('appsea.auth_user_id', true);
  actor_role text;
BEGIN
  IF actor IS NULL OR actor = '' THEN
    RAISE EXCEPTION 'competitor observation requires an authenticated workspace actor'
      USING ERRCODE = '42501';
  END IF;
  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
   WHERE membership.workspace_id = NEW.workspace_id
     AND membership.user_id = actor;
  IF actor_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'competitor observation requires an editor or owner'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by <> actor OR NEW.review_state <> 'unreviewed'
       OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'competitor observation must start unreviewed under its creating actor'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.workspace_id <> OLD.workspace_id
       OR NEW.observation_id <> OLD.observation_id
       OR NEW.opportunity_id <> OLD.opportunity_id
       OR NEW.competitor_id <> OLD.competitor_id
       OR NEW.source_id <> OLD.source_id
       OR NEW.source_record_id <> OLD.source_record_id
       OR NEW.source_item_id <> OLD.source_item_id
       OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
       OR NEW.claim_type <> OLD.claim_type
       OR NEW.claim <> OLD.claim
       OR NEW.observed_at <> OLD.observed_at
       OR NEW.confidence <> OLD.confidence
       OR NEW.synthetic <> OLD.synthetic
       OR NEW.allowed_representation <> OLD.allowed_representation
       OR NEW.canonical_locator IS DISTINCT FROM OLD.canonical_locator
       OR NEW.content_hash <> OLD.content_hash
       OR NEW.created_by <> OLD.created_by
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'competitor observation provenance and claim fields are immutable'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.review_state = 'rejected' AND NEW.review_state <> 'rejected' THEN
      RAISE EXCEPTION 'rejected competitor observations cannot be revived'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.review_state = 'confirmed' AND NEW.review_state = 'unreviewed' THEN
      RAISE EXCEPTION 'confirmed competitor observations cannot return to unreviewed'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.review_state = 'unreviewed' THEN
      IF NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
        RAISE EXCEPTION 'unreviewed competitor observations cannot have review provenance'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NEW.reviewed_by <> actor OR NEW.reviewed_at IS NULL
         OR NEW.reviewed_at > clock_timestamp() THEN
        RAISE EXCEPTION 'competitor review requires the current actor and server-valid time'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

CREATE TRIGGER competitor_research_observation_review_guard
BEFORE INSERT OR UPDATE ON appsea.competitor_research_observations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_competitor_research_observation_review();

REVOKE ALL ON appsea.competitor_research_observations FROM PUBLIC, appsea_service;
GRANT SELECT, INSERT ON appsea.competitor_research_observations TO appsea_service;
GRANT UPDATE (review_state, reviewed_by, reviewed_at, updated_at)
  ON appsea.competitor_research_observations TO appsea_service;
REVOKE ALL ON FUNCTION appsea.enforce_competitor_research_observation_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_competitor_research_observation_review() FROM PUBLIC;

COMMENT ON TABLE appsea.competitor_research_observations IS
  'Bounded competitive claims with source/evidence provenance. Non-synthetic rows require an independently approved competitor-research source purpose and human confirmation before source-backed status.';

COMMIT;

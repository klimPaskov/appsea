-- Extend the existing provenance trigger for the reviewed owner-import v2
-- contrary-evidence purpose. The original migration remains immutable; this
-- forward function replacement keeps the same evidence/review gates and only
-- broadens the collection-purpose match to the source policy's two explicit
-- private research purposes.

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
      AND source_row.collection_purpose IN ('competitor-research', 'contrary-evidence')
      AND source_row.collection_purpose = ANY(source_row.permitted_purposes)
      AND source_row.display_mode = NEW.allowed_representation;

    IF NEW.evidence_id IS NULL THEN
      policy_is_allowed := false;
    END IF;
  END IF;

  IF policy_is_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'competitor observation source policy is not approved for the recorded research purpose'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.observed_at > clock_timestamp() THEN
    RAISE EXCEPTION 'competitor observation cannot be dated in the future'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

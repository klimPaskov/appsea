BEGIN;

-- Field redaction is a monotonic projection change, not source deletion. Keep
-- source identity, policy lineage, capture time, and the original content hash
-- intact while replacing only the selected display fields.
ALTER TABLE appsea.source_items
  ADD COLUMN redacted_fields text[] NOT NULL DEFAULT '{}';

ALTER TABLE appsea.source_items
  ADD CONSTRAINT source_items_redacted_fields_check
  CHECK (
    array_position(redacted_fields, NULL) IS NULL
    AND redacted_fields <@ ARRAY['canonicalLocator']::text[]
  );

ALTER TABLE appsea.evidence_records
  ADD COLUMN redacted_fields text[] NOT NULL DEFAULT '{}';

ALTER TABLE appsea.evidence_records
  ADD CONSTRAINT evidence_redacted_fields_check
  CHECK (
    array_position(redacted_fields, NULL) IS NULL
    AND
    redacted_fields <@
      ARRAY['text', 'product', 'company', 'feature', 'category']::text[]
  );

CREATE TABLE appsea.evidence_redaction_events (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  redaction_id text NOT NULL CHECK (redaction_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  evidence_id text NOT NULL,
  fields text[] NOT NULL CHECK (
    cardinality(fields) BETWEEN 1 AND 6
    AND array_position(fields, NULL) IS NULL
    AND fields <@
      ARRAY['text', 'product', 'company', 'feature', 'category', 'canonicalLocator']::text[]
  ),
  reason text NOT NULL CHECK (
    reason IN ('pii', 'legal_request', 'policy_minimization', 'operator_correction')
  ),
  original_content_hash char(64) NOT NULL CHECK (original_content_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, redaction_id),
  FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES appsea.evidence_records(workspace_id, evidence_id) ON DELETE RESTRICT
);

CREATE INDEX evidence_redaction_events_evidence_idx
  ON appsea.evidence_redaction_events (workspace_id, evidence_id, created_at DESC);

ALTER TABLE appsea.evidence_redaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.evidence_redaction_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.evidence_redaction_events
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.evidence_redaction_events FROM PUBLIC, appsea_service;
GRANT SELECT ON appsea.evidence_redaction_events TO appsea_service;

-- The existing active-evidence guard remains immutable for ordinary callers.
-- The security-definer redaction function sets a transaction-local capability;
-- existing runtime update grants are still guarded, and callers cannot mint
-- this capability by themselves.
CREATE OR REPLACE FUNCTION appsea.guard_active_evidence_payload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  redaction_id text := NULLIF(current_setting('appsea.evidence_redaction_id', true), '');
BEGIN
  IF OLD.deletion_state = 'active'
     AND NEW.deletion_state = 'active'
     AND (
       NEW.normalized_text IS DISTINCT FROM OLD.normalized_text
       OR NEW.redacted IS DISTINCT FROM OLD.redacted
     )
     AND redaction_id IS NULL THEN
    RAISE EXCEPTION 'active evidence content is immutable outside a field redaction'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.guard_active_evidence_payload() FROM PUBLIC;

CREATE OR REPLACE FUNCTION appsea.apply_evidence_field_redaction(
  p_workspace_id text,
  p_evidence_id text,
  p_redaction_id text,
  p_fields text[],
  p_reason text
)
RETURNS TABLE (
  redaction_id text,
  evidence_id text,
  fields text[],
  reason text,
  redacted_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  actor_role text;
  canonical_fields text[];
  evidence_fields text[];
  source_fields text[];
  existing_redaction record;
  evidence_row record;
  redacted_at_value timestamptz;
BEGIN
  IF p_workspace_id IS DISTINCT FROM NULLIF(current_setting('appsea.workspace_id', true), '') THEN
    RAISE EXCEPTION 'evidence redaction workspace context is invalid' USING ERRCODE = '42501';
  END IF;
  actor_id := NULLIF(current_setting('appsea.auth_user_id', true), '');
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'evidence redaction requires an authenticated actor' USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
    JOIN appsea.workspaces workspace
      ON workspace.workspace_id = membership.workspace_id
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = actor_id
     AND workspace.status = 'active';
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'evidence redaction requires an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;

  IF p_evidence_id IS NULL
     OR p_redaction_id IS NULL
     OR p_reason IS NULL
     OR p_evidence_id !~ '^[a-z][a-z0-9_:-]{2,239}$'
     OR p_redaction_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_reason NOT IN ('pii', 'legal_request', 'policy_minimization', 'operator_correction')
     OR p_fields IS NULL
     OR cardinality(p_fields) NOT BETWEEN 1 AND 6
     OR EXISTS (
       SELECT 1
         FROM unnest(p_fields) AS input_field(field_value)
        WHERE field_value IS NULL
           OR field_value NOT IN ('text', 'product', 'company', 'feature', 'category', 'canonicalLocator')
     ) THEN
    RAISE EXCEPTION 'evidence redaction input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(field ORDER BY field)
    INTO canonical_fields
    FROM (
      SELECT DISTINCT field_value
        FROM unnest(p_fields) AS input_field(field_value)
    ) AS distinct_fields(field);
  evidence_fields := ARRAY(
    SELECT field_value
      FROM unnest(canonical_fields) AS canonical_field(field_value)
     WHERE field_value <> 'canonicalLocator'
  );
  source_fields := ARRAY(
    SELECT field_value
      FROM unnest(canonical_fields) AS canonical_field(field_value)
     WHERE field_value = 'canonicalLocator'
  );

  SELECT event.redaction_id, event.evidence_id, event.fields, event.reason,
         event.created_at
    INTO existing_redaction
    FROM appsea.evidence_redaction_events event
   WHERE event.workspace_id = p_workspace_id
     AND event.redaction_id = p_redaction_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_redaction.evidence_id <> p_evidence_id
       OR existing_redaction.fields <> canonical_fields
       OR existing_redaction.reason <> p_reason THEN
      RAISE EXCEPTION 'evidence redaction identifier conflicts with an existing event'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT p_redaction_id, p_evidence_id, canonical_fields, p_reason,
                        existing_redaction.created_at, true;
    RETURN;
  END IF;

  SELECT evidence.evidence_id, evidence.source_item_id, evidence.content_hash,
         evidence.deletion_state AS evidence_state,
         source_item.deletion_state AS source_state,
         source_item.raw_object_ref
    INTO evidence_row
    FROM appsea.evidence_records evidence
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = evidence.workspace_id
     AND source_item.source_item_id = evidence.source_item_id
   WHERE evidence.workspace_id = p_workspace_id
     AND evidence.evidence_id = p_evidence_id
   FOR UPDATE OF evidence, source_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence redaction target was not found' USING ERRCODE = '23503';
  END IF;
  IF evidence_row.evidence_state <> 'active' OR evidence_row.source_state <> 'active' THEN
    RAISE EXCEPTION 'only active evidence can be field-redacted' USING ERRCODE = '23514';
  END IF;
  IF evidence_row.raw_object_ref IS NOT NULL AND 'text' = ANY(canonical_fields) THEN
    RAISE EXCEPTION 'text redaction requires source-object deletion through the source policy path'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('appsea.evidence_redaction_id', p_redaction_id, true);
  UPDATE appsea.evidence_records evidence
     SET normalized_text = CASE
           WHEN 'text' = ANY(canonical_fields)
           THEN '[Content redacted by workspace privacy policy]'
           ELSE evidence.normalized_text
         END,
         product_candidate = CASE
           WHEN 'product' = ANY(canonical_fields)
           THEN '[Field redacted by workspace privacy policy]'
           ELSE evidence.product_candidate
         END,
         company_candidate = CASE
           WHEN 'company' = ANY(canonical_fields)
           THEN '[Field redacted by workspace privacy policy]'
           ELSE evidence.company_candidate
         END,
         feature_candidate = CASE
           WHEN 'feature' = ANY(canonical_fields)
           THEN '[Field redacted by workspace privacy policy]'
           ELSE evidence.feature_candidate
         END,
         category_candidate = CASE
           WHEN 'category' = ANY(canonical_fields)
           THEN '[Field redacted by workspace privacy policy]'
           ELSE evidence.category_candidate
         END,
         redacted = true,
         redacted_fields = (
           SELECT COALESCE(ARRAY_AGG(DISTINCT field ORDER BY field), '{}'::text[])
             FROM unnest(evidence.redacted_fields || evidence_fields) AS evidence_field(field)
         )
   WHERE evidence.workspace_id = p_workspace_id
     AND evidence.evidence_id = p_evidence_id;

  UPDATE appsea.source_items source_item
     SET canonical_locator = CASE
           WHEN 'canonicalLocator' = ANY(canonical_fields) THEN NULL
           ELSE source_item.canonical_locator
         END,
         redacted_fields = (
           SELECT COALESCE(ARRAY_AGG(DISTINCT field ORDER BY field), '{}'::text[])
             FROM unnest(
               source_item.redacted_fields ||
               source_fields
             ) AS source_field(field)
         )
   WHERE source_item.workspace_id = p_workspace_id
     AND source_item.source_item_id = evidence_row.source_item_id;

  redacted_at_value := clock_timestamp();
  INSERT INTO appsea.evidence_redaction_events
    (workspace_id, redaction_id, evidence_id, fields, reason,
     original_content_hash, actor_id, created_at)
  VALUES
    (p_workspace_id, p_redaction_id, p_evidence_id, canonical_fields, p_reason,
     evidence_row.content_hash, actor_id, redacted_at_value);

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id,
     'audit:evidence-redaction:' || md5(p_workspace_id || ':' || p_redaction_id),
     'user', actor_id, 'evidence.redacted', 'evidence_record', p_evidence_id,
     p_redaction_id,
     jsonb_build_object(
       'redactionId', p_redaction_id,
       'evidenceId', p_evidence_id,
       'fields', to_jsonb(canonical_fields),
       'reason', p_reason,
       'redactionVersion', 'evidence-redaction-v1'
     ),
     redacted_at_value)
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (p_workspace_id,
     'outbox:evidence-redaction:' || md5(p_workspace_id || ':' || p_redaction_id),
     'evidence.redacted', 'evidence_record', p_evidence_id,
     'evidence-redaction-v1', p_redaction_id,
     jsonb_build_object(
       'workspaceId', p_workspace_id,
       'redactionId', p_redaction_id,
       'evidenceId', p_evidence_id,
       'fields', to_jsonb(canonical_fields),
       'reason', p_reason
     ),
     redacted_at_value)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('appsea.evidence_redaction_id', '', true);
  RETURN QUERY SELECT p_redaction_id, p_evidence_id, canonical_fields, p_reason,
                      redacted_at_value, false;
END
$$;

REVOKE ALL ON FUNCTION appsea.apply_evidence_field_redaction(
  text, text, text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.apply_evidence_field_redaction(
  text, text, text, text[], text
) TO appsea_service;

COMMENT ON TABLE appsea.evidence_redaction_events IS
  'Immutable field-level redaction receipts; source identifiers and original content hashes remain for provenance.';

COMMIT;

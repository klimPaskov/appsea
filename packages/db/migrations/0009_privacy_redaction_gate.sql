-- Non-fixture excerpts must carry the connector's public scrubbing decision.
-- This is a forward repair of the original display-mode trigger; it prevents a
-- future connector from persisting an unsanitized narrative merely by choosing
-- the excerpt representation.
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
       AND (NEW.synthetic OR NEW.redacted)
  ) INTO display_is_allowed;

  IF NOT display_is_allowed THEN
    RAISE EXCEPTION 'evidence representation or redaction state is not allowed for source item %', NEW.source_item_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE appsea.evidence_records
  ADD CONSTRAINT evidence_non_fixture_must_be_redacted
  CHECK (synthetic OR redacted);

REVOKE ALL ON FUNCTION appsea.enforce_evidence_display_policy() FROM PUBLIC;


-- Keep mutable opportunity projections from presenting aggregates whose
-- production evidence has been invalidated by a source deletion.
ALTER TABLE appsea.opportunities
  ADD COLUMN availability_state text NOT NULL DEFAULT 'active' CHECK (
    availability_state IN ('active', 'invalidated')
  ),
  ADD COLUMN invalidated_at timestamptz,
  ADD COLUMN invalidation_reason text;

ALTER TABLE appsea.opportunities
  ADD CONSTRAINT opportunity_availability_metadata_check CHECK (
    (
      availability_state = 'active'
      AND invalidated_at IS NULL
      AND invalidation_reason IS NULL
    )
    OR (
      availability_state = 'invalidated'
      AND invalidated_at IS NOT NULL
      AND invalidation_reason IS NOT NULL
      AND char_length(invalidation_reason) BETWEEN 1 AND 240
    )
  );

CREATE INDEX opportunities_availability_idx
  ON appsea.opportunities (workspace_id, availability_state, updated_at DESC);

CREATE OR REPLACE FUNCTION appsea.guard_opportunity_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.availability_state = 'invalidated'
     AND NEW.availability_state = 'active'
     AND NEW.source_run_id = OLD.source_run_id THEN
    RAISE EXCEPTION 'invalidated opportunity requires a new source run before reactivation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS opportunity_availability_guard ON appsea.opportunities;
CREATE TRIGGER opportunity_availability_guard
BEFORE INSERT OR UPDATE ON appsea.opportunities
FOR EACH ROW EXECUTE FUNCTION appsea.guard_opportunity_availability();

REVOKE ALL ON FUNCTION appsea.guard_opportunity_availability() FROM PUBLIC;
GRANT UPDATE (
  availability_state, invalidated_at, invalidation_reason,
  current_score_snapshot_id, current_plan_package_id, updated_at
) ON appsea.opportunities TO appsea_service;

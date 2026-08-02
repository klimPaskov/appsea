-- Persist the highest Temporal activity attempt observed by the production
-- analysis persistence boundary. The attempt is operational metadata and is
-- deliberately excluded from the content hash used for idempotency.

ALTER TABLE appsea.production_analysis_runs
  ADD COLUMN activity_attempts integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT production_analysis_activity_attempts_check
    CHECK (activity_attempts BETWEEN 0 AND 10);

-- Historical terminal rows prove that at least one activity reached the
-- persistence boundary, but do not retain exact retry counts. Preserve that
-- lower bound without inventing attempts for queued/running rows.
UPDATE appsea.production_analysis_runs
   SET activity_attempts = 1
 WHERE activity_attempts = 0
   AND state IN ('completed', 'partial', 'failed', 'canceled');

CREATE OR REPLACE FUNCTION appsea.guard_production_analysis_activity_attempts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.activity_attempts < OLD.activity_attempts THEN
    RAISE EXCEPTION 'production analysis activity attempts cannot decrease'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_activity_attempt_guard
BEFORE INSERT OR UPDATE OF activity_attempts
ON appsea.production_analysis_runs
FOR EACH ROW EXECUTE FUNCTION appsea.guard_production_analysis_activity_attempts();

GRANT UPDATE (activity_attempts) ON appsea.production_analysis_runs TO appsea_service;

REVOKE ALL ON FUNCTION appsea.guard_production_analysis_activity_attempts() FROM PUBLIC;

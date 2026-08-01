-- Permit an explicit, evidence-reduced production re-analysis to repair a
-- source-deleted opportunity without pretending that deleted evidence was
-- re-collected. The active analysis output must already be linked before the
-- mutable opportunity projection can be reactivated.
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
     AND NEW.source_run_id = OLD.source_run_id
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.research_analysis_run_outputs output
         JOIN appsea.production_analysis_runs analysis
           ON analysis.workspace_id = output.workspace_id
          AND analysis.analysis_run_id = output.analysis_run_id
        WHERE output.workspace_id = NEW.workspace_id
          AND output.opportunity_id = NEW.opportunity_id
          AND output.score_snapshot_id = NEW.current_score_snapshot_id
          AND output.plan_package_id = NEW.current_plan_package_id
          AND analysis.collection_run_id = NEW.source_run_id
          AND analysis.state IN ('running', 'completed')
          AND analysis.availability_state = 'active'
     ) THEN
    RAISE EXCEPTION
      'invalidated opportunity requires a linked active re-analysis before same-run reactivation'
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

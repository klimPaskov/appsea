BEGIN;

-- The durable recomputation queue now handles both source-deletion repairs and
-- human-derived complaint corrections. Keep the trigger identity explicit so
-- each request retains one immutable cause and can be replayed safely.
ALTER TABLE appsea.production_analysis_recompute_jobs
  ALTER COLUMN source_tombstone_id DROP NOT NULL;

ALTER TABLE appsea.production_analysis_recompute_jobs
  ADD COLUMN correction_id text;

ALTER TABLE appsea.production_analysis_recompute_jobs
  ADD CONSTRAINT production_analysis_recompute_correction_id_check CHECK (
    correction_id IS NULL OR correction_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  ADD CONSTRAINT production_analysis_recompute_trigger_check CHECK (
    (source_tombstone_id IS NULL AND correction_id IS NOT NULL)
    OR (source_tombstone_id IS NOT NULL AND correction_id IS NULL)
  ),
  ADD CONSTRAINT production_analysis_recompute_correction_fk
    FOREIGN KEY (workspace_id, correction_id)
    REFERENCES appsea.complaint_analysis_corrections(workspace_id, correction_id)
    ON DELETE RESTRICT;

ALTER TABLE appsea.production_analysis_recompute_jobs
  ADD CONSTRAINT production_analysis_recompute_correction_key
    UNIQUE (workspace_id, opportunity_id, correction_id);

CREATE INDEX production_analysis_recompute_correction_idx
  ON appsea.production_analysis_recompute_jobs (workspace_id, correction_id, requested_at DESC)
  WHERE correction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION appsea.enforce_production_analysis_recompute_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.opportunities opportunity
     WHERE opportunity.workspace_id = NEW.workspace_id
       AND opportunity.opportunity_id = NEW.opportunity_id
       AND opportunity.availability_state = 'invalidated'
  ) THEN
    RAISE EXCEPTION 'production analysis recomputation requires an invalidated opportunity'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.source_tombstone_id IS NULL) = (NEW.correction_id IS NULL) THEN
    RAISE EXCEPTION 'production analysis recomputation requires exactly one trigger identity'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.correction_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.complaint_analysis_corrections correction
        WHERE correction.workspace_id = NEW.workspace_id
          AND correction.correction_id = NEW.correction_id
     ) THEN
    RAISE EXCEPTION 'production analysis recomputation correction lineage is missing'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.opportunity_seed_reviews seed
     WHERE seed.workspace_id = NEW.workspace_id
       AND seed.seed_review_id = NEW.seed_review_id
       AND seed.seed_payload ->> 'id' = NEW.opportunity_id
  ) THEN
    RAISE EXCEPTION 'production analysis recomputation seed does not match its opportunity'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS production_analysis_recompute_lineage_guard
  ON appsea.production_analysis_recompute_jobs;
CREATE TRIGGER production_analysis_recompute_lineage_guard
BEFORE INSERT OR UPDATE OF opportunity_id, seed_review_id, source_tombstone_id, correction_id
ON appsea.production_analysis_recompute_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_analysis_recompute_lineage();

-- A correction is committed only when its derived snapshot, invalidation, and
-- eligible re-analysis request commit together. Deferring this trigger lets
-- the correction function invalidate the analysis/opportunity before the
-- candidate query runs, while a failure still rolls back the correction.
CREATE OR REPLACE FUNCTION appsea.enqueue_complaint_analysis_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  correction_reason text := 'Complaint analysis correction ' || NEW.correction_id;
  queued_count integer := 0;
BEGIN
  WITH candidates AS (
    SELECT DISTINCT ON (opportunity.workspace_id, opportunity.opportunity_id)
           opportunity.workspace_id,
           opportunity.opportunity_id,
           analysis.collection_run_id,
           analysis.seed_review_id
      FROM appsea.opportunities opportunity
      JOIN appsea.research_analysis_run_outputs output
        ON output.workspace_id = opportunity.workspace_id
       AND output.opportunity_id = opportunity.opportunity_id
      JOIN appsea.production_analysis_runs analysis
        ON analysis.workspace_id = output.workspace_id
       AND analysis.analysis_run_id = output.analysis_run_id
      JOIN appsea.opportunity_seed_reviews seed
        ON seed.workspace_id = analysis.workspace_id
       AND seed.seed_review_id = analysis.seed_review_id
       AND seed.seed_payload ->> 'id' = opportunity.opportunity_id
     WHERE opportunity.workspace_id = NEW.workspace_id
       AND opportunity.availability_state = 'invalidated'
       AND opportunity.invalidation_reason = correction_reason
       AND analysis.state = 'completed'
       AND analysis.availability_state = 'invalidated'
       AND analysis.invalidation_reason = correction_reason
     ORDER BY opportunity.workspace_id, opportunity.opportunity_id,
              analysis.completed_at DESC NULLS LAST, analysis.analysis_run_id DESC
  ), enqueued AS (
    INSERT INTO appsea.production_analysis_recompute_jobs
      (workspace_id, recompute_id, opportunity_id, collection_run_id, seed_review_id,
       source_tombstone_id, correction_id, analysis_run_id, idempotency_key, requested_at,
       state, failure_code, failure_summary, next_attempt_at, finished_at, updated_at)
    SELECT candidates.workspace_id,
           'recompute:analysis:' || md5(jsonb_build_array(
             candidates.workspace_id, candidates.opportunity_id, NEW.correction_id
           )::text),
           candidates.opportunity_id,
           candidates.collection_run_id,
           candidates.seed_review_id,
           NULL,
           NEW.correction_id,
           'analysis-run:' || md5(jsonb_build_array(
             candidates.workspace_id, candidates.opportunity_id, NEW.correction_id
           )::text),
           'production-analysis-recompute-' || md5(jsonb_build_array(
             candidates.workspace_id, candidates.opportunity_id, NEW.correction_id
           )::text),
           clock_timestamp(),
           CASE WHEN seed.review_state = 'approved' THEN 'queued' ELSE 'blocked' END,
           CASE WHEN seed.review_state = 'approved' THEN NULL ELSE 'seed_not_approved' END,
           CASE WHEN seed.review_state = 'approved'
                THEN NULL
                ELSE 'The reviewed analysis seed must be approved before repair can start.'
           END,
           clock_timestamp(),
           CASE WHEN seed.review_state = 'approved' THEN NULL ELSE clock_timestamp() END,
           clock_timestamp()
      FROM candidates
      JOIN appsea.opportunity_seed_reviews seed
        ON seed.workspace_id = candidates.workspace_id
       AND seed.seed_review_id = candidates.seed_review_id
    ON CONFLICT ON CONSTRAINT production_analysis_recompute_correction_key DO NOTHING
    RETURNING recompute_id
  )
  SELECT count(*)::integer INTO queued_count FROM enqueued;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS complaint_analysis_correction_recompute_enqueue
  ON appsea.complaint_analysis_corrections;
CREATE CONSTRAINT TRIGGER complaint_analysis_correction_recompute_enqueue
AFTER INSERT ON appsea.complaint_analysis_corrections
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION appsea.enqueue_complaint_analysis_recompute();

REVOKE ALL ON FUNCTION appsea.enforce_production_analysis_recompute_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enqueue_complaint_analysis_recompute() FROM PUBLIC, appsea_service;

COMMENT ON FUNCTION appsea.enqueue_complaint_analysis_recompute() IS
  'Queues one idempotent, correction-bound re-analysis after invalidation; unapproved seeds remain blocked.';

COMMIT;

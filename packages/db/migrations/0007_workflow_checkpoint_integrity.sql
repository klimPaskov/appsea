ALTER TABLE appsea.workflow_job_executions
  DROP CONSTRAINT workflow_job_executions_task_queue_check;

ALTER TABLE appsea.workflow_job_executions
  ADD CONSTRAINT workflow_job_executions_task_queue_check
  CHECK (task_queue = 'appsea-research-v1');

CREATE OR REPLACE FUNCTION appsea.enforce_workflow_checkpoint_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  parent_job record;
  current_rank integer;
  new_rank integer;
  highest_sequence integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'workflow checkpoints are immutable' USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO parent_job
    FROM appsea.workflow_job_executions
   WHERE workspace_id = NEW.workspace_id
     AND workflow_id = NEW.workflow_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow checkpoint has no execution' USING ERRCODE = '23503';
  END IF;
  IF parent_job.state IN ('completed', 'failed', 'canceled', 'budget_rejected') THEN
    RAISE EXCEPTION 'terminal workflow execution cannot receive a checkpoint'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.activity_attempt > parent_job.max_activity_attempts
     OR NEW.consumed_source_items > parent_job.max_source_items
     OR NEW.consumed_cost_micros > parent_job.max_cost_micros THEN
    RAISE EXCEPTION 'workflow checkpoint exceeds its execution budget' USING ERRCODE = '23514';
  END IF;
  IF NEW.occurred_at < parent_job.requested_at THEN
    RAISE EXCEPTION 'workflow checkpoint time precedes request' USING ERRCODE = '23514';
  END IF;

  IF (NEW.state = 'queued' AND NEW.checkpoint <> 'accepted')
     OR (NEW.state = 'completed' AND NEW.checkpoint <> 'completed')
     OR (NEW.state = 'failed' AND NEW.checkpoint <> 'failed')
     OR (NEW.state = 'canceled' AND NEW.checkpoint <> 'canceled')
     OR (NEW.state = 'budget_rejected' AND NEW.checkpoint <> 'budget_rejected') THEN
    RAISE EXCEPTION 'workflow checkpoint and state do not agree' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'completed' AND parent_job.checkpoint <> 'persisted' THEN
    RAISE EXCEPTION 'workflow completion checkpoint requires persisted state'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(MAX(sequence_no), 0)
    INTO highest_sequence
    FROM appsea.workflow_job_checkpoints
   WHERE workspace_id = NEW.workspace_id
     AND workflow_id = NEW.workflow_id;
  IF NEW.sequence_no <= highest_sequence THEN
    RAISE EXCEPTION 'workflow checkpoint sequence must increase' USING ERRCODE = '23514';
  END IF;

  current_rank := array_position(
    ARRAY[
      'accepted', 'initialized', 'inspected', 'budget_approved', 'persisting',
      'persisted', 'completed', 'failed', 'canceled', 'budget_rejected'
    ]::text[],
    parent_job.checkpoint
  );
  new_rank := array_position(
    ARRAY[
      'accepted', 'initialized', 'inspected', 'budget_approved', 'persisting',
      'persisted', 'completed', 'failed', 'canceled', 'budget_rejected'
    ]::text[],
    NEW.checkpoint
  );
  IF NEW.state = 'running'
     AND new_rank > current_rank + 1
     AND NOT (parent_job.checkpoint = 'persisted' AND NEW.checkpoint = 'persisting') THEN
    RAISE EXCEPTION 'workflow checkpoint skipped a stage' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'running'
     AND new_rank < current_rank
     AND NOT (parent_job.checkpoint = 'persisted' AND NEW.checkpoint = 'persisting') THEN
    RAISE EXCEPTION 'workflow checkpoint moved backward' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER workflow_checkpoint_integrity_guard
BEFORE INSERT OR UPDATE ON appsea.workflow_job_checkpoints
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_workflow_checkpoint_write();

REVOKE ALL ON FUNCTION appsea.enforce_workflow_checkpoint_write() FROM PUBLIC;

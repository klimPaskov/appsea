-- An explicit re-collection is a new, identifier-linked observation after a
-- completed source deletion. It must never restore the deleted row or let a
-- caller silently reuse a source-native record without a reviewed tombstone.

ALTER TABLE appsea.research_runs
  ADD COLUMN recollection_tombstone_id text;

ALTER TABLE appsea.research_runs
  ADD CONSTRAINT research_runs_recollection_tombstone_fk
  FOREIGN KEY (workspace_id, recollection_tombstone_id)
  REFERENCES appsea.deletion_tombstones(workspace_id, tombstone_id)
  ON DELETE RESTRICT;

ALTER TABLE appsea.research_runs
  ADD CONSTRAINT research_runs_recollection_mode_check
  CHECK (recollection_tombstone_id IS NULL OR mode = 'production');

ALTER TABLE appsea.source_items
  ADD COLUMN recollection_tombstone_id text;

ALTER TABLE appsea.source_items
  ADD CONSTRAINT source_items_recollection_tombstone_fk
  FOREIGN KEY (workspace_id, recollection_tombstone_id)
  REFERENCES appsea.deletion_tombstones(workspace_id, tombstone_id)
  ON DELETE RESTRICT;

-- The original natural-key constraint correctly prevented duplicate active
-- source rows, but it also prevented a new active observation after the old
-- row was tombstoned. Keep the active-record invariant and retain deleted
-- history as separate immutable rows.
ALTER TABLE appsea.source_items
  DROP CONSTRAINT source_items_workspace_id_source_id_source_record_id_key;

CREATE UNIQUE INDEX source_items_active_native_idx
  ON appsea.source_items (workspace_id, source_id, source_record_id)
  WHERE deletion_state = 'active';

CREATE OR REPLACE FUNCTION appsea.guard_source_recollection_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.recollection_tombstone_id IS DISTINCT FROM NEW.recollection_tombstone_id THEN
    RAISE EXCEPTION 'source recollection lineage is immutable'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.recollection_tombstone_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.synthetic THEN
    RAISE EXCEPTION 'synthetic source items cannot be linked to a deletion tombstone'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.deletion_tombstones tombstone
     WHERE tombstone.workspace_id = NEW.workspace_id
       AND tombstone.tombstone_id = NEW.recollection_tombstone_id
       AND tombstone.source_id = NEW.source_id
       AND tombstone.state = 'completed'
  ) THEN
    RAISE EXCEPTION 'source recollection requires a completed matching deletion tombstone'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_items_recollection_lineage_guard ON appsea.source_items;
CREATE TRIGGER source_items_recollection_lineage_guard
BEFORE INSERT OR UPDATE OF recollection_tombstone_id
ON appsea.source_items
FOR EACH ROW EXECUTE FUNCTION appsea.guard_source_recollection_lineage();

CREATE OR REPLACE FUNCTION appsea.guard_research_run_recollection_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  snapshot_source_id text;
BEGIN
  IF NEW.recollection_tombstone_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.mode <> 'production' THEN
    RAISE EXCEPTION 'only production runs may be linked to a deletion tombstone'
      USING ERRCODE = '42501';
  END IF;
  snapshot_source_id := NULLIF(NEW.artifact_snapshot ->> 'sourceId', '');
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.deletion_tombstones tombstone
     WHERE tombstone.workspace_id = NEW.workspace_id
       AND tombstone.tombstone_id = NEW.recollection_tombstone_id
       AND tombstone.state = 'completed'
       AND tombstone.source_id = snapshot_source_id
  ) THEN
    RAISE EXCEPTION 'research run recollection lineage does not match a completed tombstone'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS research_runs_recollection_lineage_guard ON appsea.research_runs;
CREATE TRIGGER research_runs_recollection_lineage_guard
BEFORE INSERT OR UPDATE OF recollection_tombstone_id, artifact_snapshot, mode
ON appsea.research_runs
FOR EACH ROW EXECUTE FUNCTION appsea.guard_research_run_recollection_lineage();

ALTER TABLE appsea.production_collection_workflow_jobs
  ADD COLUMN recollection_tombstone_id text;

ALTER TABLE appsea.production_collection_workflow_jobs
  ADD CONSTRAINT production_collection_workflow_recollection_tombstone_fk
  FOREIGN KEY (workspace_id, recollection_tombstone_id)
  REFERENCES appsea.deletion_tombstones(workspace_id, tombstone_id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION appsea.guard_production_workflow_recollection_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.recollection_tombstone_id IS DISTINCT FROM NEW.recollection_tombstone_id THEN
    RAISE EXCEPTION 'production workflow recollection lineage is immutable'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.recollection_tombstone_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.deletion_tombstones tombstone
     WHERE tombstone.workspace_id = NEW.workspace_id
       AND tombstone.tombstone_id = NEW.recollection_tombstone_id
       AND tombstone.source_id = NEW.source_id
       AND tombstone.state = 'completed'
  ) THEN
    RAISE EXCEPTION 'production workflow re-collection requires a completed matching tombstone'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS production_collection_workflow_recollection_guard
  ON appsea.production_collection_workflow_jobs;
CREATE TRIGGER production_collection_workflow_recollection_guard
BEFORE INSERT OR UPDATE OF recollection_tombstone_id, source_id
ON appsea.production_collection_workflow_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.guard_production_workflow_recollection_lineage();

REVOKE ALL ON FUNCTION appsea.guard_source_recollection_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_research_run_recollection_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_production_workflow_recollection_lineage() FROM PUBLIC;

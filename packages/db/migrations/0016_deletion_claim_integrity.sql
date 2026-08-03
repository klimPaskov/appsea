-- Every processing tombstone must carry a lease start.  Repair legacy rows
-- using their immutable receipt time before enforcing the invariant so a
-- worker cannot strand a queue item with a null stale-claim boundary.

-- The table is forced-RLS, including for the migration owner.  Use a
-- migration-only owner policy that can see exactly the legacy rows being
-- repaired, then remove it before the migration commits. The owner bypass is
-- scoped to this transaction so the repair cannot depend on a pooled GUC.
ALTER TABLE appsea.deletion_tombstones NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deletion_tombstone_migration_repair ON appsea.deletion_tombstones;
CREATE POLICY deletion_tombstone_migration_repair ON appsea.deletion_tombstones
  FOR UPDATE
  TO appsea_owner, appsea_migrator
  USING (state = 'processing' AND processing_started_at IS NULL)
  WITH CHECK (state = 'processing' AND processing_started_at IS NOT NULL);

UPDATE appsea.deletion_tombstones
   SET processing_started_at = received_at
 WHERE state = 'processing'
   AND processing_started_at IS NULL;

DROP POLICY deletion_tombstone_migration_repair ON appsea.deletion_tombstones;
ALTER TABLE appsea.deletion_tombstones FORCE ROW LEVEL SECURITY;

ALTER TABLE appsea.deletion_tombstones
  ADD CONSTRAINT deletion_processing_requires_started_at
  CHECK (state <> 'processing' OR processing_started_at IS NOT NULL);

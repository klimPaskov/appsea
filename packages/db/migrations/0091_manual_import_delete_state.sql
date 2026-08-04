-- A consumed owner-import batch may be deleted later. Preserve its immutable
-- consumed_at timestamp while recording deleted_at and clearing staged rows.
-- Migration 0089's generated check only allowed consumed_at for state=consumed,
-- which rejected the valid consumed -> deleted transition enforced by its
-- trigger.

ALTER TABLE appsea.manual_import_batches
  DROP CONSTRAINT manual_import_batches_check;

ALTER TABLE appsea.manual_import_batches
  ADD CONSTRAINT manual_import_batches_consumed_at_check
  CHECK (
    (state = 'consumed' AND consumed_at IS NOT NULL)
    OR (
      state <> 'consumed'
      AND (state = 'deleted' OR consumed_at IS NULL)
    )
  );

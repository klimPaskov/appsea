BEGIN;

-- Keep feature comparison claims with the normalized competitor row while
-- preserving the existing immutable content hash and workspace lineage.
-- Existing competitors receive an explicitly empty matrix; application
-- contracts validate each entry before a new row is written.
ALTER TABLE appsea.competitors
  ADD COLUMN feature_matrix jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT competitors_feature_matrix_shape_check
    CHECK (
      jsonb_typeof(feature_matrix) = 'array'
      AND jsonb_array_length(feature_matrix) <= 200
    );

COMMIT;

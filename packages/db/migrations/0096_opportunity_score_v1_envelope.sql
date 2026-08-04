-- Migration 0096: persist the additive balanced v1 score envelope.
--
-- Legacy v0.2 rows remain valid and keep `score` as their raw score. New v1
-- rows populate the nullable, queryable risk/confidence/ranking columns while
-- the immutable full explanation remains in the existing JSONB column.

ALTER TABLE appsea.opportunity_score_snapshots
  ADD COLUMN risk_penalty numeric(4,1),
  ADD COLUMN risk_adjusted_score numeric(5,1),
  ADD COLUMN evidence_confidence numeric(4,3),
  ADD COLUMN uncertainty_margin numeric(4,1),
  ADD COLUMN ranking_score numeric(5,1),
  ADD COLUMN scoring_profile text,
  ADD COLUMN model_version text,
  ADD COLUMN evidence_snapshot_id text,
  ADD COLUMN coverage_summary jsonb,
  ADD COLUMN freshness_summary jsonb;

ALTER TABLE appsea.opportunity_score_snapshots
  ADD CONSTRAINT opportunity_score_snapshots_v1_ranges CHECK (
    (risk_penalty IS NULL OR risk_penalty BETWEEN 0 AND 35) AND
    (risk_adjusted_score IS NULL OR risk_adjusted_score BETWEEN 0 AND 100) AND
    (evidence_confidence IS NULL OR evidence_confidence BETWEEN 0 AND 1) AND
    (uncertainty_margin IS NULL OR uncertainty_margin BETWEEN 0 AND 20) AND
    (ranking_score IS NULL OR ranking_score BETWEEN 0 AND 100)
  ),
  ADD CONSTRAINT opportunity_score_snapshots_v1_complete CHECK (
    scoring_version <> 'opportunity-score-v1.0.0' OR (
      risk_penalty IS NOT NULL AND
      risk_adjusted_score IS NOT NULL AND
      evidence_confidence IS NOT NULL AND
      uncertainty_margin IS NOT NULL AND
      ranking_score IS NOT NULL AND
      scoring_profile = 'balanced' AND
      model_version IS NOT NULL AND
      evidence_snapshot_id IS NOT NULL AND
      coverage_summary IS NOT NULL AND
      freshness_summary IS NOT NULL
    )
  );

CREATE INDEX opportunity_score_snapshots_ranking_idx
  ON appsea.opportunity_score_snapshots
  (workspace_id, COALESCE(ranking_score, score) DESC, calculated_at DESC);

-- Durable post-collection analysis lineage. The collection run remains the
-- source-of-record for acquisition; this projection owns the separately
-- idempotent analysis stage and its content-addressed output references.

ALTER TABLE appsea.report_versions
  ADD COLUMN synthetic boolean NOT NULL DEFAULT true;

ALTER TABLE appsea.report_versions
  ADD COLUMN structured_object_ref text;

ALTER TABLE appsea.report_versions
  ADD CONSTRAINT report_structured_object_ref_format CHECK (
    structured_object_ref IS NULL
    OR structured_object_ref ~ '^appsea-object://[a-z][a-z0-9_:-]*/[a-z][a-z0-9-]*/[a-f0-9]{64}$'
  );

ALTER TABLE appsea.report_versions
  ADD CONSTRAINT report_non_synthetic_object_check CHECK (
    synthetic OR structured_object_ref IS NOT NULL
  );

CREATE TABLE appsea.production_analysis_runs (
  workspace_id text NOT NULL,
  analysis_run_id text NOT NULL CHECK (
    analysis_run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  collection_run_id text NOT NULL CHECK (
    collection_run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  analysis_version text NOT NULL CHECK (analysis_version = 'production-analysis-v1'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  artifact_id text NOT NULL CHECK (artifact_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  artifact_snapshot jsonb NOT NULL,
  artifact_object_ref jsonb,
  report_object_ref jsonb,
  plan_object_ref jsonb,
  state text NOT NULL CHECK (
    state IN ('queued', 'running', 'completed', 'partial', 'failed', 'canceled')
  ),
  availability_state text NOT NULL DEFAULT 'active' CHECK (
    availability_state IN ('active', 'invalidated', 'workspace_deleted', 'expired', 'pending')
  ),
  opportunity_id text,
  score_snapshot_id text,
  report_id text,
  plan_package_id text,
  seed_review_id text NOT NULL CHECK (seed_review_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  seed_content_hash char(64) NOT NULL CHECK (seed_content_hash ~ '^[a-f0-9]{64}$'),
  coverage_gaps text[] NOT NULL DEFAULT '{}',
  warnings text[] NOT NULL DEFAULT '{}',
  requested_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'analysis_input_invalid', 'analysis_policy_denied', 'analysis_budget_exceeded',
      'analysis_activity_failed', 'analysis_reconciliation_required'
    )
  ),
  failure_summary text CHECK (
    failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 500
  ),
  PRIMARY KEY (workspace_id, analysis_run_id),
  FOREIGN KEY (workspace_id, collection_run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, artifact_id),
  CHECK (started_at >= requested_at),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL)),
  CHECK (
    state <> 'completed'
    OR (
      artifact_object_ref IS NOT NULL
      AND report_object_ref IS NOT NULL
      AND plan_object_ref IS NOT NULL
      AND opportunity_id IS NOT NULL
      AND score_snapshot_id IS NOT NULL
      AND report_id IS NOT NULL
      AND plan_package_id IS NOT NULL
    )
  ),
  CHECK (
    availability_state = 'active'
    OR (invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL)
  ),
  CHECK (
    artifact_object_ref IS NULL
    OR (
      jsonb_typeof(artifact_object_ref) = 'object'
      AND artifact_object_ref->>'workspaceId' = workspace_id
      AND artifact_object_ref->>'kind' = 'workflow-artifact'
      AND artifact_object_ref->>'uri' ~ '^appsea-object://[a-z][a-z0-9_:-]*/workflow-artifact/[a-f0-9]{64}$'
    )
  ),
  CHECK (
    report_object_ref IS NULL
    OR (
      jsonb_typeof(report_object_ref) = 'object'
      AND report_object_ref->>'workspaceId' = workspace_id
      AND report_object_ref->>'kind' = 'report-json'
      AND report_object_ref->>'uri' ~ '^appsea-object://[a-z][a-z0-9_:-]*/report-json/[a-f0-9]{64}$'
    )
  ),
  CHECK (
    plan_object_ref IS NULL
    OR (
      jsonb_typeof(plan_object_ref) = 'object'
      AND plan_object_ref->>'workspaceId' = workspace_id
      AND plan_object_ref->>'kind' = 'plan-package'
      AND plan_object_ref->>'uri' ~ '^appsea-object://[a-z][a-z0-9_:-]*/plan-package/[a-f0-9]{64}$'
    )
  ),
  CHECK (
    availability_state = 'active'
    OR invalidation_reason <> ''
  )
);

CREATE TABLE appsea.research_analysis_run_source_policies (
  workspace_id text NOT NULL,
  analysis_run_id text NOT NULL,
  source_id text NOT NULL,
  policy_version text NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  policy_content_hash char(64) NOT NULL CHECK (policy_content_hash ~ '^[a-f0-9]{64}$'),
  approval_review_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, analysis_run_id, source_id, policy_version),
  FOREIGN KEY (workspace_id, analysis_run_id)
    REFERENCES appsea.production_analysis_runs(workspace_id, analysis_run_id)
    ON DELETE CASCADE,
  FOREIGN KEY (source_id, policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version)
    ON DELETE RESTRICT,
  FOREIGN KEY (approval_review_id)
    REFERENCES appsea.source_policy_reviews(review_id)
    ON DELETE RESTRICT
);

CREATE TABLE appsea.research_analysis_run_evidence (
  workspace_id text NOT NULL,
  analysis_run_id text NOT NULL,
  complaint_id text NOT NULL,
  evidence_id text NOT NULL,
  source_item_id text NOT NULL,
  evidence_content_hash char(64) NOT NULL CHECK (evidence_content_hash ~ '^[a-f0-9]{64}$'),
  source_record_id text NOT NULL CHECK (char_length(source_record_id) BETWEEN 1 AND 240),
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, analysis_run_id, complaint_id),
  UNIQUE (workspace_id, analysis_run_id, evidence_id),
  FOREIGN KEY (workspace_id, analysis_run_id)
    REFERENCES appsea.production_analysis_runs(workspace_id, analysis_run_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, complaint_id)
    REFERENCES appsea.complaint_observations(workspace_id, complaint_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES appsea.evidence_records(workspace_id, evidence_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_item_id)
    REFERENCES appsea.source_items(workspace_id, source_item_id)
    ON DELETE RESTRICT
);

CREATE TABLE appsea.research_analysis_run_outputs (
  workspace_id text NOT NULL,
  analysis_run_id text NOT NULL,
  opportunity_id text NOT NULL,
  score_snapshot_id text NOT NULL,
  report_id text NOT NULL,
  plan_package_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, analysis_run_id, opportunity_id),
  FOREIGN KEY (workspace_id, analysis_run_id)
    REFERENCES appsea.production_analysis_runs(workspace_id, analysis_run_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, opportunity_id, score_snapshot_id)
    REFERENCES appsea.opportunity_score_snapshots(workspace_id, opportunity_id, score_snapshot_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, opportunity_id, report_id)
    REFERENCES appsea.report_versions(workspace_id, opportunity_id, report_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, opportunity_id, plan_package_id)
    REFERENCES appsea.plan_package_versions(workspace_id, opportunity_id, plan_package_id)
    ON DELETE RESTRICT
);

CREATE INDEX production_analysis_runs_collection_idx
  ON appsea.production_analysis_runs (workspace_id, collection_run_id, requested_at DESC);
CREATE INDEX production_analysis_runs_state_idx
  ON appsea.production_analysis_runs (workspace_id, state, availability_state, requested_at DESC);
CREATE INDEX research_analysis_run_evidence_source_idx
  ON appsea.research_analysis_run_evidence (workspace_id, source_item_id, evidence_id);

CREATE OR REPLACE FUNCTION appsea.enforce_production_analysis_collection_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.research_runs run
     WHERE run.workspace_id = NEW.workspace_id
       AND run.run_id = NEW.collection_run_id
       AND run.mode = 'production'
       AND run.state = 'completed'
  ) THEN
    RAISE EXCEPTION 'production analysis requires a completed production collection run'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_collection_gate
BEFORE INSERT OR UPDATE OF collection_run_id
ON appsea.production_analysis_runs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_analysis_collection_gate();

CREATE OR REPLACE FUNCTION appsea.enforce_production_analysis_policy_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  collection_run_id text;
BEGIN
  SELECT analysis.collection_run_id
    INTO collection_run_id
    FROM appsea.production_analysis_runs analysis
   WHERE analysis.workspace_id = NEW.workspace_id
     AND analysis.analysis_run_id = NEW.analysis_run_id;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.research_run_source_policies run_policy
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = run_policy.source_id
       AND policy.policy_version = run_policy.policy_version
      JOIN appsea.source_policy_reviews review
        ON review.source_id = policy.source_id
       AND review.policy_version = policy.policy_version
       AND review.content_hash = policy.content_hash
       AND review.review_id = NEW.approval_review_id
       AND review.decision = 'approved'
     WHERE run_policy.workspace_id = NEW.workspace_id
       AND run_policy.run_id = collection_run_id
       AND run_policy.source_id = NEW.source_id
       AND run_policy.policy_version = NEW.policy_version
       AND policy.content_hash = NEW.policy_content_hash
  ) THEN
    RAISE EXCEPTION 'analysis source policy is not present in the approved collection lineage'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_policy_lineage
BEFORE INSERT OR UPDATE ON appsea.research_analysis_run_source_policies
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_analysis_policy_lineage();

CREATE OR REPLACE FUNCTION appsea.enforce_production_analysis_evidence_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  collection_run_id text;
BEGIN
  SELECT analysis.collection_run_id
    INTO collection_run_id
    FROM appsea.production_analysis_runs analysis
   WHERE analysis.workspace_id = NEW.workspace_id
     AND analysis.analysis_run_id = NEW.analysis_run_id;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.research_run_complaints run_complaint
      JOIN appsea.complaint_observations complaint
        ON complaint.workspace_id = run_complaint.workspace_id
       AND complaint.complaint_id = run_complaint.complaint_id
      JOIN appsea.evidence_records evidence
        ON evidence.workspace_id = complaint.workspace_id
       AND evidence.evidence_id = complaint.evidence_id
      JOIN appsea.source_items source_item
        ON source_item.workspace_id = evidence.workspace_id
       AND source_item.source_item_id = evidence.source_item_id
     WHERE run_complaint.workspace_id = NEW.workspace_id
       AND run_complaint.run_id = collection_run_id
       AND run_complaint.complaint_id = NEW.complaint_id
       AND complaint.evidence_id = NEW.evidence_id
       AND evidence.source_item_id = NEW.source_item_id
       AND evidence.content_hash = NEW.evidence_content_hash
       AND source_item.source_record_id = NEW.source_record_id
       AND evidence.deletion_state = 'active'
       AND source_item.deletion_state = 'active'
  ) THEN
    RAISE EXCEPTION 'analysis evidence mapping is not present in the active collection lineage'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_evidence_lineage
BEFORE INSERT OR UPDATE ON appsea.research_analysis_run_evidence
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_analysis_evidence_lineage();

CREATE OR REPLACE FUNCTION appsea.enforce_production_analysis_output_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  collection_run_id text;
BEGIN
  SELECT analysis.collection_run_id
    INTO collection_run_id
    FROM appsea.production_analysis_runs analysis
   WHERE analysis.workspace_id = NEW.workspace_id
     AND analysis.analysis_run_id = NEW.analysis_run_id;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.opportunities opportunity
     WHERE opportunity.workspace_id = NEW.workspace_id
       AND opportunity.opportunity_id = NEW.opportunity_id
       AND opportunity.source_run_id = collection_run_id
       AND opportunity.synthetic = false
  ) THEN
    RAISE EXCEPTION 'analysis output opportunity is not owned by the collection run'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_output_lineage
BEFORE INSERT OR UPDATE ON appsea.research_analysis_run_outputs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_analysis_output_lineage();

CREATE OR REPLACE FUNCTION appsea.guard_production_analysis_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.analysis_run_id IS DISTINCT FROM OLD.analysis_run_id
    OR NEW.collection_run_id IS DISTINCT FROM OLD.collection_run_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.analysis_version IS DISTINCT FROM OLD.analysis_version
    OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
    OR NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.seed_review_id IS DISTINCT FROM OLD.seed_review_id
    OR NEW.seed_content_hash IS DISTINCT FROM OLD.seed_content_hash
  ) THEN
    RAISE EXCEPTION 'production analysis identity is immutable' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.state IN ('completed', 'failed', 'canceled')
     AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'terminal production analysis state is immutable' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.availability_state <> 'active'
     AND NEW.availability_state IS DISTINCT FROM OLD.availability_state THEN
    RAISE EXCEPTION 'invalidated production analysis cannot become available again'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.availability_state = 'invalidated'
     AND (NEW.invalidated_at IS NULL OR NEW.invalidation_reason IS NULL) THEN
    RAISE EXCEPTION 'invalidated production analysis requires deletion metadata'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_transition_guard
BEFORE INSERT OR UPDATE ON appsea.production_analysis_runs
FOR EACH ROW EXECUTE FUNCTION appsea.guard_production_analysis_transition();

ALTER TABLE appsea.production_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_analysis_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_analysis_runs
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.research_analysis_run_source_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.research_analysis_run_source_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.research_analysis_run_source_policies
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.research_analysis_run_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.research_analysis_run_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.research_analysis_run_evidence
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.research_analysis_run_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.research_analysis_run_outputs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.research_analysis_run_outputs
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.production_analysis_runs,
  appsea.research_analysis_run_source_policies,
  appsea.research_analysis_run_evidence,
  appsea.research_analysis_run_outputs
FROM appsea_service;
GRANT SELECT, INSERT ON appsea.production_analysis_runs,
  appsea.research_analysis_run_source_policies,
  appsea.research_analysis_run_evidence,
  appsea.research_analysis_run_outputs TO appsea_service;
GRANT UPDATE (
  artifact_snapshot, artifact_object_ref, report_object_ref, plan_object_ref,
  state, availability_state, opportunity_id, score_snapshot_id, report_id,
  plan_package_id, coverage_gaps, warnings, completed_at, invalidated_at,
  invalidation_reason, failure_code, failure_summary
) ON appsea.production_analysis_runs TO appsea_service;

REVOKE ALL ON FUNCTION appsea.enforce_production_analysis_collection_gate() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_production_analysis_policy_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_production_analysis_evidence_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_production_analysis_output_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_production_analysis_transition() FROM PUBLIC;

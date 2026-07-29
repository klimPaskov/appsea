CREATE SCHEMA IF NOT EXISTS appsea;

CREATE OR REPLACE FUNCTION appsea.current_workspace_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('appsea.workspace_id', true), '')
$$;

CREATE TABLE appsea.workspaces (
  workspace_id text PRIMARY KEY CHECK (workspace_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  visibility text NOT NULL CHECK (visibility IN ('private', 'public')),
  fixture_only boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE appsea.sources (
  source_id text PRIMARY KEY CHECK (source_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  source_type text NOT NULL CHECK (
    source_type IN ('fixture', 'api', 'export', 'licensed-feed', 'manual')
  ),
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN ('active', 'disabled_pending_review', 'disabled_policy', 'disabled_operator', 'retired')
  ),
  current_policy_version text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE appsea.source_policy_versions (
  source_id text NOT NULL REFERENCES appsea.sources(source_id) ON DELETE RESTRICT,
  policy_version text NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  policy_state text NOT NULL CHECK (
    policy_state IN ('approved', 'pending_review', 'expired', 'revoked')
  ),
  permitted_purposes text[] NOT NULL CHECK (cardinality(permitted_purposes) > 0),
  commercial_use text NOT NULL CHECK (commercial_use IN ('allowed', 'restricted', 'unknown')),
  access_method text NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days >= 0),
  deletion_required boolean NOT NULL,
  attribution_required boolean NOT NULL,
  display_mode text NOT NULL CHECK (
    display_mode IN ('excerpt', 'metadata-only', 'aggregate-only', 'fixture')
  ),
  coverage_notes text[] NOT NULL DEFAULT '{}',
  policy_document_ref text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  policy_payload jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (source_id, policy_version),
  UNIQUE (source_id, content_hash),
  CHECK (policy_state <> 'approved' OR reviewed_at IS NOT NULL),
  CHECK (expires_at IS NULL OR reviewed_at IS NULL OR expires_at > reviewed_at)
);

ALTER TABLE appsea.sources
  ADD CONSTRAINT sources_current_policy_fk
  FOREIGN KEY (source_id, current_policy_version)
  REFERENCES appsea.source_policy_versions(source_id, policy_version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE appsea.research_campaigns (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  campaign_id text NOT NULL CHECK (campaign_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  purpose text NOT NULL,
  state text NOT NULL CHECK (
    state IN ('draft', 'validated', 'queued', 'running', 'paused', 'completed', 'partial', 'failed', 'canceled')
  ),
  configuration jsonb NOT NULL,
  budget jsonb NOT NULL,
  synthetic boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, campaign_id)
);

CREATE TABLE appsea.research_runs (
  workspace_id text NOT NULL,
  run_id text NOT NULL CHECK (run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  campaign_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  mode text NOT NULL CHECK (mode IN ('fixture', 'production')),
  state text NOT NULL CHECK (
    state IN ('queued', 'running', 'paused', 'completed', 'partial', 'failed', 'canceled')
  ),
  artifact_id text NOT NULL,
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  artifact_snapshot jsonb NOT NULL,
  coverage_gaps text[] NOT NULL DEFAULT '{}',
  warnings text[] NOT NULL DEFAULT '{}',
  requested_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure_code text,
  failure_summary text,
  PRIMARY KEY (workspace_id, run_id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES appsea.research_campaigns(workspace_id, campaign_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, artifact_id),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE appsea.source_items (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  source_item_id text NOT NULL CHECK (source_item_id ~ '^[a-z][a-z0-9_:-]{2,239}$'),
  source_id text NOT NULL,
  source_policy_version text NOT NULL,
  source_record_id text NOT NULL CHECK (char_length(source_record_id) BETWEEN 1 AND 240),
  canonical_locator text,
  query_route text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL,
  published_at timestamptz,
  synthetic boolean NOT NULL,
  deletion_state text NOT NULL DEFAULT 'active' CHECK (
    deletion_state IN ('active', 'source_deleted', 'workspace_deleted', 'expired', 'redacted', 'pending')
  ),
  raw_object_ref text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, source_item_id),
  FOREIGN KEY (source_id, source_policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version) ON DELETE RESTRICT,
  UNIQUE (workspace_id, source_id, source_record_id)
);

CREATE TABLE appsea.research_run_source_items (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  source_item_id text NOT NULL,
  PRIMARY KEY (workspace_id, run_id, source_item_id),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_item_id)
    REFERENCES appsea.source_items(workspace_id, source_item_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.evidence_records (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  evidence_id text NOT NULL CHECK (evidence_id ~ '^[a-z][a-z0-9_:-]{2,239}$'),
  source_item_id text NOT NULL,
  normalized_text text NOT NULL CHECK (char_length(normalized_text) BETWEEN 1 AND 20000),
  language text NOT NULL CHECK (char_length(language) BETWEEN 2 AND 16),
  allowed_representation text NOT NULL CHECK (
    allowed_representation IN ('excerpt', 'metadata-only', 'aggregate-only', 'fixture')
  ),
  redacted boolean NOT NULL,
  synthetic boolean NOT NULL,
  normalization_version text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  product_candidate text NOT NULL,
  company_candidate text NOT NULL,
  feature_candidate text NOT NULL,
  category_candidate text NOT NULL,
  policy_flags jsonb NOT NULL DEFAULT '{}',
  deletion_state text NOT NULL DEFAULT 'active' CHECK (
    deletion_state IN ('active', 'source_deleted', 'workspace_deleted', 'expired', 'redacted', 'pending')
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, evidence_id),
  FOREIGN KEY (workspace_id, source_item_id)
    REFERENCES appsea.source_items(workspace_id, source_item_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, source_item_id, normalization_version)
);

CREATE TABLE appsea.complaint_observations (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  complaint_id text NOT NULL CHECK (complaint_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  evidence_id text NOT NULL,
  classification text NOT NULL DEFAULT 'complaint',
  complaint_type text NOT NULL,
  problem_statement text NOT NULL CHECK (char_length(problem_statement) BETWEEN 1 AND 20000),
  affected_workflow text NOT NULL,
  target_product text NOT NULL,
  target_company text NOT NULL,
  target_feature text NOT NULL,
  severity smallint NOT NULL CHECK (severity BETWEEN 0 AND 5),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  review_state text NOT NULL CHECK (review_state IN ('unreviewed', 'confirmed', 'corrected', 'rejected')),
  extraction_version text NOT NULL,
  synthetic boolean NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, complaint_id),
  FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES appsea.evidence_records(workspace_id, evidence_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, evidence_id, extraction_version)
);

CREATE TABLE appsea.research_run_complaints (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  complaint_id text NOT NULL,
  PRIMARY KEY (workspace_id, run_id, complaint_id),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, complaint_id)
    REFERENCES appsea.complaint_observations(workspace_id, complaint_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.complaint_cluster_versions (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  cluster_version_id text NOT NULL CHECK (cluster_version_id ~ '^[a-z][a-z0-9_:-]{2,239}$'),
  cluster_id text NOT NULL,
  run_id text NOT NULL,
  cluster_version text NOT NULL,
  working_label text NOT NULL,
  problem_statement text NOT NULL,
  product text NOT NULL,
  category text NOT NULL,
  complaint_count integer NOT NULL CHECK (complaint_count > 0),
  unique_observation_count integer NOT NULL CHECK (unique_observation_count > 0),
  source_count integer NOT NULL CHECK (source_count > 0),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  review_state text NOT NULL CHECK (
    review_state IN ('provisional', 'reviewed', 'confirmed', 'split', 'merged', 'rejected')
  ),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  synthetic boolean NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, cluster_version_id),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, cluster_id, cluster_version, input_hash)
);

CREATE TABLE appsea.cluster_memberships (
  workspace_id text NOT NULL,
  cluster_version_id text NOT NULL,
  complaint_id text NOT NULL,
  membership_confidence numeric(5,4) NOT NULL CHECK (membership_confidence BETWEEN 0 AND 1),
  inclusion_reason text NOT NULL,
  review_state text NOT NULL CHECK (review_state IN ('unreviewed', 'confirmed', 'corrected', 'rejected')),
  PRIMARY KEY (workspace_id, cluster_version_id, complaint_id),
  FOREIGN KEY (workspace_id, cluster_version_id)
    REFERENCES appsea.complaint_cluster_versions(workspace_id, cluster_version_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, complaint_id)
    REFERENCES appsea.complaint_observations(workspace_id, complaint_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.competitors (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  competitor_id text NOT NULL CHECK (competitor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  name text NOT NULL,
  competitor_type text NOT NULL CHECK (
    competitor_type IN ('direct', 'adjacent', 'platform', 'workaround', 'do-nothing')
  ),
  positioning text NOT NULL,
  strengths text[] NOT NULL DEFAULT '{}',
  weaknesses text[] NOT NULL DEFAULT '{}',
  related_complaint_categories text[] NOT NULL DEFAULT '{}',
  synthetic boolean NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, competitor_id),
  UNIQUE (workspace_id, name, competitor_type)
);

CREATE TABLE appsea.opportunities (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  opportunity_id text NOT NULL CHECK (opportunity_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL,
  one_line text NOT NULL,
  thesis text NOT NULL,
  audience text NOT NULL,
  first_wedge text NOT NULL,
  complaint_count integer NOT NULL CHECK (complaint_count >= 0),
  synthetic boolean NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  contrary_evidence text[] NOT NULL DEFAULT '{}',
  state text NOT NULL CHECK (
    state IN ('signal', 'candidate', 'researched', 'planned', 'approved', 'monitoring', 'archived')
  ),
  source_run_id text NOT NULL,
  current_score_snapshot_id text,
  current_plan_package_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, opportunity_id),
  UNIQUE (workspace_id, slug),
  FOREIGN KEY (workspace_id, source_run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.opportunity_clusters (
  workspace_id text NOT NULL,
  opportunity_id text NOT NULL,
  cluster_version_id text NOT NULL,
  PRIMARY KEY (workspace_id, opportunity_id, cluster_version_id),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, cluster_version_id)
    REFERENCES appsea.complaint_cluster_versions(workspace_id, cluster_version_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.opportunity_competitors (
  workspace_id text NOT NULL,
  opportunity_id text NOT NULL,
  competitor_id text NOT NULL,
  relation_type text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (workspace_id, opportunity_id, competitor_id),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, competitor_id)
    REFERENCES appsea.competitors(workspace_id, competitor_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.opportunity_score_snapshots (
  workspace_id text NOT NULL,
  score_snapshot_id text NOT NULL CHECK (score_snapshot_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  opportunity_id text NOT NULL,
  scoring_version text NOT NULL,
  score numeric(5,1) NOT NULL CHECK (score BETWEEN 0 AND 100),
  factors jsonb NOT NULL,
  weights jsonb NOT NULL,
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  explanation jsonb NOT NULL DEFAULT '{}',
  calculated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, score_snapshot_id),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, opportunity_id, scoring_version, input_hash)
);

CREATE TABLE appsea.report_versions (
  workspace_id text NOT NULL,
  report_id text NOT NULL CHECK (report_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  opportunity_id text NOT NULL,
  version text NOT NULL,
  evidence_snapshot_ref text NOT NULL,
  structured_report jsonb NOT NULL,
  markdown_object_ref text,
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  approval_state text NOT NULL CHECK (approval_state IN ('draft', 'reviewed', 'approved', 'withdrawn')),
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, report_id),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, opportunity_id, version, manifest_hash)
);

CREATE TABLE appsea.plan_package_versions (
  workspace_id text NOT NULL,
  plan_package_id text NOT NULL CHECK (plan_package_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  opportunity_id text NOT NULL,
  run_id text NOT NULL,
  report_id text,
  version text NOT NULL,
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  package_object_ref text,
  fixture_files jsonb,
  readiness_state text NOT NULL CHECK (readiness_state IN ('draft', 'ready', 'withdrawn')),
  approval_state text NOT NULL CHECK (approval_state IN ('unreviewed', 'reviewed', 'approved', 'withdrawn')),
  synthetic boolean NOT NULL,
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, plan_package_id),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, report_id)
    REFERENCES appsea.report_versions(workspace_id, report_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, opportunity_id, version, manifest_hash),
  CHECK (package_object_ref IS NOT NULL OR fixture_files IS NOT NULL),
  CHECK (NOT synthetic OR fixture_files IS NOT NULL)
);

ALTER TABLE appsea.opportunities
  ADD CONSTRAINT opportunities_current_score_fk
  FOREIGN KEY (workspace_id, current_score_snapshot_id)
  REFERENCES appsea.opportunity_score_snapshots(workspace_id, score_snapshot_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE appsea.opportunities
  ADD CONSTRAINT opportunities_current_plan_fk
  FOREIGN KEY (workspace_id, current_plan_package_id)
  REFERENCES appsea.plan_package_versions(workspace_id, plan_package_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE appsea.audit_events (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  audit_event_id text NOT NULL CHECK (audit_event_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service', 'system')),
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, audit_event_id)
);

CREATE TABLE appsea.cost_ledger_entries (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  cost_entry_id text NOT NULL CHECK (cost_entry_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  campaign_id text,
  run_id text,
  source_id text,
  cost_type text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
  unit text NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  estimate boolean NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, cost_entry_id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES appsea.research_campaigns(workspace_id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id) REFERENCES appsea.sources(source_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.deletion_tombstones (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  tombstone_id text NOT NULL CHECK (tombstone_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  source_id text NOT NULL REFERENCES appsea.sources(source_id) ON DELETE RESTRICT,
  source_record_id text NOT NULL,
  reason text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'processing', 'completed', 'failed')),
  received_at timestamptz NOT NULL,
  completed_at timestamptz,
  affected_object_count integer NOT NULL DEFAULT 0 CHECK (affected_object_count >= 0),
  PRIMARY KEY (workspace_id, tombstone_id),
  UNIQUE (workspace_id, source_id, source_record_id, reason)
);

CREATE TABLE appsea.outbox_events (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  outbox_event_id text NOT NULL CHECK (outbox_event_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  schema_version text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  PRIMARY KEY (workspace_id, outbox_event_id)
);

CREATE INDEX research_runs_campaign_state_idx
  ON appsea.research_runs (workspace_id, campaign_id, state, requested_at DESC);
CREATE INDEX source_items_native_idx
  ON appsea.source_items (workspace_id, source_id, source_record_id);
CREATE INDEX evidence_records_source_idx
  ON appsea.evidence_records (workspace_id, source_item_id, deletion_state);
CREATE INDEX complaint_observations_target_idx
  ON appsea.complaint_observations (workspace_id, target_product, complaint_type);
CREATE INDEX complaint_clusters_run_idx
  ON appsea.complaint_cluster_versions (workspace_id, run_id, confidence DESC);
CREATE INDEX opportunities_rank_idx
  ON appsea.opportunities (workspace_id, state, synthetic, complaint_count DESC);
CREATE INDEX score_snapshots_rank_idx
  ON appsea.opportunity_score_snapshots (workspace_id, score DESC, calculated_at DESC);
CREATE INDEX outbox_unpublished_idx
  ON appsea.outbox_events (workspace_id, occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX deletion_tombstones_pending_idx
  ON appsea.deletion_tombstones (workspace_id, received_at)
  WHERE state IN ('pending', 'processing');

ALTER TABLE appsea.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.workspaces
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'research_campaigns',
    'research_runs',
    'source_items',
    'research_run_source_items',
    'evidence_records',
    'complaint_observations',
    'research_run_complaints',
    'complaint_cluster_versions',
    'cluster_memberships',
    'competitors',
    'opportunities',
    'opportunity_clusters',
    'opportunity_competitors',
    'opportunity_score_snapshots',
    'report_versions',
    'plan_package_versions',
    'audit_events',
    'cost_ledger_entries',
    'deletion_tombstones',
    'outbox_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE appsea.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE appsea.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY workspace_scope ON appsea.%I USING (workspace_id = appsea.current_workspace_id()) WITH CHECK (workspace_id = appsea.current_workspace_id())',
      table_name
    );
  END LOOP;
END
$$;


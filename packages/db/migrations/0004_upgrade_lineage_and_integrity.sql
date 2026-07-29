DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'opportunities',
    'opportunity_clusters',
    'opportunity_competitors',
    'opportunity_score_snapshots',
    'plan_package_versions',
    'report_versions',
    'research_run_opportunities',
    'research_run_score_snapshots',
    'research_run_plan_packages',
    'research_run_source_items',
    'research_runs',
    'source_items',
    'complaint_cluster_versions',
    'competitors'
  ]
  LOOP
    EXECUTE format('ALTER TABLE appsea.%I NO FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$$;

INSERT INTO appsea.research_run_opportunities
  (workspace_id, run_id, opportunity_id, linked_at)
SELECT workspace_id, source_run_id, opportunity_id, updated_at
  FROM appsea.opportunities
ON CONFLICT DO NOTHING;

INSERT INTO appsea.research_run_score_snapshots
  (workspace_id, run_id, score_snapshot_id, linked_at)
SELECT workspace_id, source_run_id, current_score_snapshot_id, updated_at
  FROM appsea.opportunities
 WHERE current_score_snapshot_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO appsea.research_run_plan_packages
  (workspace_id, run_id, plan_package_id, linked_at)
SELECT workspace_id, run_id, plan_package_id, generated_at
  FROM appsea.plan_package_versions
ON CONFLICT DO NOTHING;

INSERT INTO appsea.research_run_opportunities
  (workspace_id, run_id, opportunity_id, linked_at)
SELECT workspace_id, run_id, opportunity_id, generated_at
  FROM appsea.plan_package_versions
ON CONFLICT DO NOTHING;

INSERT INTO appsea.research_run_opportunities
  (workspace_id, run_id, opportunity_id, linked_at)
SELECT run_score.workspace_id,
       run_score.run_id,
       score.opportunity_id,
       run_score.linked_at
  FROM appsea.research_run_score_snapshots run_score
  JOIN appsea.opportunity_score_snapshots score
    ON score.workspace_id = run_score.workspace_id
   AND score.score_snapshot_id = run_score.score_snapshot_id
ON CONFLICT DO NOTHING;

INSERT INTO appsea.research_run_opportunities
  (workspace_id, run_id, opportunity_id, linked_at)
SELECT relation.workspace_id,
       cluster.run_id,
       relation.opportunity_id,
       cluster.created_at
  FROM appsea.opportunity_clusters relation
  JOIN appsea.complaint_cluster_versions cluster
    ON cluster.workspace_id = relation.workspace_id
   AND cluster.cluster_version_id = relation.cluster_version_id
ON CONFLICT DO NOTHING;

ALTER TABLE appsea.complaint_cluster_versions
  ADD CONSTRAINT complaint_cluster_run_identity_unique
  UNIQUE (workspace_id, run_id, cluster_version_id);

CREATE TABLE appsea.research_run_cluster_versions (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  opportunity_id text NOT NULL,
  cluster_version_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, run_id, opportunity_id, cluster_version_id),
  FOREIGN KEY (workspace_id, run_id, opportunity_id)
    REFERENCES appsea.research_run_opportunities(workspace_id, run_id, opportunity_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, run_id, cluster_version_id)
    REFERENCES appsea.complaint_cluster_versions(workspace_id, run_id, cluster_version_id)
    ON DELETE RESTRICT
);

CREATE TABLE appsea.research_run_competitors (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  opportunity_id text NOT NULL,
  competitor_id text NOT NULL,
  relation_type text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, run_id, opportunity_id, competitor_id),
  FOREIGN KEY (workspace_id, run_id, opportunity_id)
    REFERENCES appsea.research_run_opportunities(workspace_id, run_id, opportunity_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, competitor_id)
    REFERENCES appsea.competitors(workspace_id, competitor_id)
    ON DELETE RESTRICT
);

CREATE TABLE appsea.research_run_source_policies (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  source_id text NOT NULL,
  policy_version text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, run_id, source_id, policy_version),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (source_id, policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version) ON DELETE RESTRICT
);

INSERT INTO appsea.research_run_cluster_versions
  (workspace_id, run_id, opportunity_id, cluster_version_id, linked_at)
SELECT relation.workspace_id,
       cluster.run_id,
       relation.opportunity_id,
       relation.cluster_version_id,
       cluster.created_at
  FROM appsea.opportunity_clusters relation
  JOIN appsea.complaint_cluster_versions cluster
    ON cluster.workspace_id = relation.workspace_id
   AND cluster.cluster_version_id = relation.cluster_version_id
  JOIN appsea.research_run_opportunities run_opportunity
    ON run_opportunity.workspace_id = relation.workspace_id
   AND run_opportunity.run_id = cluster.run_id
   AND run_opportunity.opportunity_id = relation.opportunity_id
ON CONFLICT DO NOTHING;

INSERT INTO appsea.research_run_competitors
  (workspace_id, run_id, opportunity_id, competitor_id, relation_type, confidence, linked_at)
SELECT relation.workspace_id,
       opportunity.source_run_id,
       relation.opportunity_id,
       relation.competitor_id,
       relation.relation_type,
       relation.confidence,
       opportunity.updated_at
  FROM appsea.opportunity_competitors relation
  JOIN appsea.opportunities opportunity
    ON opportunity.workspace_id = relation.workspace_id
   AND opportunity.opportunity_id = relation.opportunity_id
ON CONFLICT DO NOTHING;

INSERT INTO appsea.research_run_source_policies
  (workspace_id, run_id, source_id, policy_version, linked_at)
SELECT DISTINCT run_item.workspace_id,
       run_item.run_id,
       source_item.source_id,
       source_item.source_policy_version,
       source_item.created_at
  FROM appsea.research_run_source_items run_item
  JOIN appsea.source_items source_item
    ON source_item.workspace_id = run_item.workspace_id
   AND source_item.source_item_id = run_item.source_item_id
ON CONFLICT DO NOTHING;

ALTER TABLE appsea.source_items
  ADD CONSTRAINT source_item_policy_identity_unique
  UNIQUE (workspace_id, source_item_id, source_id, source_policy_version);
ALTER TABLE appsea.research_run_source_items
  ADD COLUMN source_id text;
ALTER TABLE appsea.research_run_source_items
  ADD COLUMN source_policy_version text;
UPDATE appsea.research_run_source_items run_item
   SET source_id = source_item.source_id,
       source_policy_version = source_item.source_policy_version
  FROM appsea.source_items source_item
 WHERE source_item.workspace_id = run_item.workspace_id
   AND source_item.source_item_id = run_item.source_item_id;
ALTER TABLE appsea.research_run_source_items
  ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE appsea.research_run_source_items
  ALTER COLUMN source_policy_version SET NOT NULL;
ALTER TABLE appsea.research_run_source_items
  ADD CONSTRAINT research_run_source_item_policy_fk
  FOREIGN KEY (workspace_id, source_item_id, source_id, source_policy_version)
  REFERENCES appsea.source_items(workspace_id, source_item_id, source_id, source_policy_version)
  ON DELETE RESTRICT;
ALTER TABLE appsea.research_run_source_items
  ADD CONSTRAINT research_run_declared_source_policy_fk
  FOREIGN KEY (workspace_id, run_id, source_id, source_policy_version)
  REFERENCES appsea.research_run_source_policies(workspace_id, run_id, source_id, policy_version)
  ON DELETE RESTRICT;

ALTER TABLE appsea.research_run_score_snapshots
  ADD COLUMN opportunity_id text;
UPDATE appsea.research_run_score_snapshots run_score
   SET opportunity_id = score.opportunity_id
  FROM appsea.opportunity_score_snapshots score
 WHERE score.workspace_id = run_score.workspace_id
   AND score.score_snapshot_id = run_score.score_snapshot_id;
ALTER TABLE appsea.research_run_score_snapshots
  ALTER COLUMN opportunity_id SET NOT NULL;

ALTER TABLE appsea.research_run_plan_packages
  ADD COLUMN opportunity_id text;
UPDATE appsea.research_run_plan_packages run_plan
   SET opportunity_id = plan.opportunity_id
  FROM appsea.plan_package_versions plan
 WHERE plan.workspace_id = run_plan.workspace_id
   AND plan.plan_package_id = run_plan.plan_package_id;
ALTER TABLE appsea.research_run_plan_packages
  ALTER COLUMN opportunity_id SET NOT NULL;

ALTER TABLE appsea.opportunity_score_snapshots
  ADD CONSTRAINT opportunity_score_snapshot_owner_unique
  UNIQUE (workspace_id, opportunity_id, score_snapshot_id);
ALTER TABLE appsea.plan_package_versions
  ADD CONSTRAINT plan_package_owner_unique
  UNIQUE (workspace_id, opportunity_id, plan_package_id);
ALTER TABLE appsea.report_versions
  ADD CONSTRAINT report_owner_unique
  UNIQUE (workspace_id, opportunity_id, report_id);

ALTER TABLE appsea.research_run_score_snapshots
  ADD CONSTRAINT research_run_score_owner_fk
  FOREIGN KEY (workspace_id, opportunity_id, score_snapshot_id)
  REFERENCES appsea.opportunity_score_snapshots(workspace_id, opportunity_id, score_snapshot_id)
  ON DELETE RESTRICT;
ALTER TABLE appsea.research_run_score_snapshots
  ADD CONSTRAINT research_run_score_opportunity_fk
  FOREIGN KEY (workspace_id, run_id, opportunity_id)
  REFERENCES appsea.research_run_opportunities(workspace_id, run_id, opportunity_id)
  ON DELETE CASCADE;
ALTER TABLE appsea.research_run_score_snapshots
  ADD CONSTRAINT research_run_score_current_identity_unique
  UNIQUE (workspace_id, run_id, opportunity_id, score_snapshot_id);

ALTER TABLE appsea.research_run_plan_packages
  ADD CONSTRAINT research_run_plan_owner_fk
  FOREIGN KEY (workspace_id, opportunity_id, plan_package_id)
  REFERENCES appsea.plan_package_versions(workspace_id, opportunity_id, plan_package_id)
  ON DELETE RESTRICT;
ALTER TABLE appsea.research_run_plan_packages
  ADD CONSTRAINT research_run_plan_opportunity_fk
  FOREIGN KEY (workspace_id, run_id, opportunity_id)
  REFERENCES appsea.research_run_opportunities(workspace_id, run_id, opportunity_id)
  ON DELETE CASCADE;
ALTER TABLE appsea.research_run_plan_packages
  ADD CONSTRAINT research_run_plan_current_identity_unique
  UNIQUE (workspace_id, run_id, opportunity_id, plan_package_id);

ALTER TABLE appsea.opportunities DROP CONSTRAINT opportunities_current_score_fk;
ALTER TABLE appsea.opportunities
  ADD CONSTRAINT opportunities_current_score_owner_fk
  FOREIGN KEY (workspace_id, opportunity_id, current_score_snapshot_id)
  REFERENCES appsea.opportunity_score_snapshots(workspace_id, opportunity_id, score_snapshot_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE appsea.opportunities DROP CONSTRAINT opportunities_current_plan_fk;
ALTER TABLE appsea.opportunities
  ADD CONSTRAINT opportunities_current_plan_owner_fk
  FOREIGN KEY (workspace_id, opportunity_id, current_plan_package_id)
  REFERENCES appsea.plan_package_versions(workspace_id, opportunity_id, plan_package_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE appsea.opportunities
  ADD CONSTRAINT opportunities_source_run_fk
  FOREIGN KEY (workspace_id, source_run_id, opportunity_id)
  REFERENCES appsea.research_run_opportunities(workspace_id, run_id, opportunity_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE appsea.opportunities
  ADD CONSTRAINT opportunities_current_score_run_fk
  FOREIGN KEY (workspace_id, source_run_id, opportunity_id, current_score_snapshot_id)
  REFERENCES appsea.research_run_score_snapshots(
    workspace_id, run_id, opportunity_id, score_snapshot_id
  )
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE appsea.opportunities
  ADD CONSTRAINT opportunities_current_plan_run_fk
  FOREIGN KEY (workspace_id, source_run_id, opportunity_id, current_plan_package_id)
  REFERENCES appsea.research_run_plan_packages(
    workspace_id, run_id, opportunity_id, plan_package_id
  )
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE appsea.plan_package_versions
  DROP CONSTRAINT plan_package_versions_workspace_id_report_id_fkey;
ALTER TABLE appsea.plan_package_versions
  ADD CONSTRAINT plan_package_report_owner_fk
  FOREIGN KEY (workspace_id, opportunity_id, report_id)
  REFERENCES appsea.report_versions(workspace_id, opportunity_id, report_id)
  ON DELETE RESTRICT;

ALTER TABLE appsea.research_runs
  ADD CONSTRAINT research_run_campaign_identity_unique
  UNIQUE (workspace_id, campaign_id, run_id);
ALTER TABLE appsea.cost_ledger_entries
  ADD CONSTRAINT cost_ledger_run_campaign_fk
  FOREIGN KEY (workspace_id, campaign_id, run_id)
  REFERENCES appsea.research_runs(workspace_id, campaign_id, run_id)
  ON DELETE RESTRICT;

ALTER TABLE appsea.plan_package_versions DROP CONSTRAINT plan_package_versions_check;
ALTER TABLE appsea.plan_package_versions DROP CONSTRAINT plan_package_versions_check1;
ALTER TABLE appsea.plan_package_versions
  ADD CONSTRAINT plan_package_storage_boundary_check CHECK (
    (synthetic AND fixture_files IS NOT NULL AND package_object_ref IS NULL)
    OR
    (NOT synthetic AND fixture_files IS NULL AND package_object_ref IS NOT NULL)
  );

ALTER TABLE appsea.research_runs DROP CONSTRAINT research_runs_check;
ALTER TABLE appsea.research_runs ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE appsea.research_runs ADD COLUMN finished_at timestamptz;
UPDATE appsea.research_runs
   SET finished_at = COALESCE(completed_at, started_at, requested_at)
 WHERE state IN ('completed', 'partial', 'failed', 'canceled');
ALTER TABLE appsea.research_runs
  ADD CONSTRAINT research_run_lifecycle_check CHECK (
    ((state IN ('completed', 'partial', 'failed', 'canceled')) = (finished_at IS NOT NULL))
    AND ((state = 'completed') = (completed_at IS NOT NULL))
    AND (state NOT IN ('running', 'completed', 'partial', 'failed', 'canceled') OR started_at IS NOT NULL)
    AND (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
  );

ALTER TABLE appsea.deletion_tombstones
  ADD CONSTRAINT deletion_tombstone_lifecycle_check CHECK (
    (state = 'completed') = (completed_at IS NOT NULL)
  );

ALTER TABLE appsea.sources
  ADD CONSTRAINT active_source_requires_policy_check CHECK (
    lifecycle_state <> 'active' OR current_policy_version IS NOT NULL
  );

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'opportunities',
    'opportunity_clusters',
    'opportunity_competitors',
    'opportunity_score_snapshots',
    'plan_package_versions',
    'report_versions',
    'research_run_opportunities',
    'research_run_score_snapshots',
    'research_run_plan_packages',
    'research_run_source_items',
    'research_runs',
    'source_items',
    'complaint_cluster_versions',
    'competitors'
  ]
  LOOP
    EXECUTE format('ALTER TABLE appsea.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'research_run_cluster_versions',
    'research_run_competitors',
    'research_run_source_policies'
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

CREATE TABLE appsea.research_run_opportunities (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  opportunity_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, run_id, opportunity_id),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.research_run_score_snapshots (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  score_snapshot_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, run_id, score_snapshot_id),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, score_snapshot_id)
    REFERENCES appsea.opportunity_score_snapshots(workspace_id, score_snapshot_id) ON DELETE RESTRICT
);

CREATE TABLE appsea.research_run_plan_packages (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  plan_package_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, run_id, plan_package_id),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, plan_package_id)
    REFERENCES appsea.plan_package_versions(workspace_id, plan_package_id) ON DELETE RESTRICT
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'research_run_opportunities',
    'research_run_score_snapshots',
    'research_run_plan_packages'
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

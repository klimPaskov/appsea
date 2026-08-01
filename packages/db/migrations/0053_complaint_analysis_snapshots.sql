-- Persist the derived complaint-analysis checkpoint separately from source
-- evidence. The snapshot is validated at the TypeScript boundary and kept as
-- JSONB so revisions can add fields without rewriting immutable evidence.
ALTER TABLE appsea.complaint_observations
  ADD COLUMN IF NOT EXISTS analysis_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE appsea.complaint_observations
  DROP CONSTRAINT IF EXISTS complaint_analysis_snapshot_object;

ALTER TABLE appsea.complaint_observations
  ADD CONSTRAINT complaint_analysis_snapshot_object
  CHECK (jsonb_typeof(analysis_snapshot) = 'object');

-- Existing rows were written before the derived-analysis contract existed.
-- Backfill a conservative, reviewable snapshot from already persisted fields;
-- unresolved substitutes and competitors remain explicit rather than inferred.
UPDATE appsea.complaint_observations
   SET analysis_snapshot = jsonb_build_object(
     'complaintId', complaint_id,
     'classification', classification,
     'complaintType', CASE
       WHEN complaint_type IN ('missing_capability', 'broken_behavior', 'usability',
                               'performance', 'reliability', 'integration', 'pricing',
                               'privacy', 'security', 'support', 'accessibility',
                               'platform_restriction', 'workflow_gap')
         THEN complaint_type
       ELSE 'other'
     END,
     'problemStatement', problem_statement,
     'expectedOutcome', NULL,
     'observedOutcome', problem_statement,
     'consequence', NULL,
     'affectedWorkflow', affected_workflow,
     'workaround', NULL,
     'featureMentions', jsonb_build_array(target_feature),
     'userSegmentHints', '[]'::jsonb,
     'severity', severity,
     'recurrence', 'unknown',
     'switchingIntent', 'unknown',
     'paymentSignal', 'unknown',
     'actionabilityProbability', confidence,
     'classificationConfidence', confidence,
     'entityConfidence', confidence,
     'manipulationRisk', 0,
     'piiFlags', '[]'::jsonb,
     'policyFlags', CASE WHEN synthetic
       THEN jsonb_build_array('synthetic-fixture')
       ELSE jsonb_build_array('source-policy-representation-applied')
     END,
     'reviewState', review_state,
     'extractionVersion', extraction_version,
     'derivation', jsonb_build_object(
       'skillVersion', 'appsea-complaint-analysis-v1',
       'modelVersion', 'persisted-backfill-v1',
       'promptVersion', 'none'
     ),
     'entities', jsonb_build_object(
       'product', jsonb_build_object(
         'entityType', 'product', 'surfaceText', target_product,
         'canonicalName', target_product, 'confidence', confidence,
         'resolution', 'exact', 'evidence', 'source-field'
       ),
       'company', jsonb_build_object(
         'entityType', 'company', 'surfaceText', target_company,
         'canonicalName', target_company, 'confidence', confidence,
         'resolution', 'exact', 'evidence', 'source-field'
       ),
       'feature', jsonb_build_object(
         'entityType', 'feature', 'surfaceText', target_feature,
         'canonicalName', target_feature, 'confidence', confidence,
         'resolution', 'exact', 'evidence', 'source-field'
       ),
       'substitutes', '[]'::jsonb,
       'competitors', '[]'::jsonb,
       'unresolvedTypes', jsonb_build_array('substitute', 'competitor')
     )
   )
 WHERE analysis_snapshot = '{}'::jsonb;

-- Upgrade immutable run snapshots in place so readers can continue to replay
-- historical fixture and collection runs after the contract gains analyses.
UPDATE appsea.research_runs run
   SET artifact_snapshot = jsonb_set(
     run.artifact_snapshot,
     '{analyses}',
     COALESCE((
       SELECT jsonb_agg(complaint.analysis_snapshot ORDER BY complaint.complaint_id)
         FROM appsea.research_run_complaints link
         JOIN appsea.complaint_observations complaint
           ON complaint.workspace_id = link.workspace_id
          AND complaint.complaint_id = link.complaint_id
        WHERE link.workspace_id = run.workspace_id
          AND link.run_id = run.run_id
     ), '[]'::jsonb),
     true
   )
 WHERE jsonb_typeof(run.artifact_snapshot) = 'object'
   AND NOT (run.artifact_snapshot ? 'analyses');

UPDATE appsea.production_analysis_runs analysis
   SET artifact_snapshot = jsonb_set(
     analysis.artifact_snapshot,
     '{analyses}',
     COALESCE((
       SELECT jsonb_agg(complaint.analysis_snapshot ORDER BY complaint.complaint_id)
         FROM jsonb_array_elements(analysis.artifact_snapshot->'complaints') raw
         JOIN appsea.complaint_observations complaint
           ON complaint.workspace_id = analysis.workspace_id
          AND complaint.complaint_id = raw->>'id'
     ), '[]'::jsonb),
     true
   )
 WHERE jsonb_typeof(analysis.artifact_snapshot) = 'object'
   AND NOT (analysis.artifact_snapshot ? 'analyses');

COMMENT ON COLUMN appsea.complaint_observations.analysis_snapshot IS
  'Validated derived complaint classification and entity-resolution snapshot; source content remains in evidence_records.';

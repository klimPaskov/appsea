BEGIN;

-- Campaign deletion is an archive transition so runs, evidence, and audit
-- lineage remain addressable. Archived campaigns cannot be started again.
ALTER TABLE appsea.research_campaigns
  DROP CONSTRAINT research_campaigns_state_check;

ALTER TABLE appsea.research_campaigns
  ADD CONSTRAINT research_campaigns_state_check CHECK (
    state IN (
      'draft', 'validated', 'queued', 'running', 'paused', 'completed',
      'partial', 'failed', 'canceled', 'archived'
    )
  );

-- User-authenticated campaign edits still run through the service role, but
-- the writable columns stay narrower than the full table surface.
GRANT UPDATE (name, purpose) ON appsea.research_campaigns TO appsea_service;

COMMIT;

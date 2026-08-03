BEGIN;

-- Scheduled refresh state lives on the campaign aggregate so a claim and its
-- source-policy-derived request remain workspace-scoped and easy to inspect.
ALTER TABLE appsea.research_campaigns
  ADD COLUMN refresh_next_due_at timestamptz,
  ADD COLUMN refresh_claim_owner text,
  ADD COLUMN refresh_claim_token text,
  ADD COLUMN refresh_claim_until timestamptz,
  ADD COLUMN refresh_pending_due_at timestamptz,
  ADD COLUMN refresh_pending_run_id text,
  ADD COLUMN refresh_pending_workflow_id text,
  ADD COLUMN refresh_pending_idempotency_digest char(64),
  ADD COLUMN refresh_pending_input_hash char(64),
  ADD COLUMN refresh_pending_request jsonb,
  ADD COLUMN refresh_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN refresh_last_run_id text,
  ADD COLUMN refresh_last_workflow_id text,
  ADD COLUMN refresh_last_started_at timestamptz,
  ADD COLUMN refresh_failure_code text,
  ADD COLUMN refresh_failure_summary text,
  ADD COLUMN refresh_updated_at timestamptz DEFAULT clock_timestamp();

-- The migration role must backfill existing workspace rows even though this
-- aggregate is force-RLS protected for runtime callers.
ALTER TABLE appsea.research_campaigns NO FORCE ROW LEVEL SECURITY;

UPDATE appsea.research_campaigns
   SET refresh_next_due_at = CASE
       WHEN state = 'archived' THEN NULL
       ELSE updated_at + CASE configuration->>'refreshPolicy'
         WHEN 'daily' THEN interval '1 day'
         WHEN 'weekly' THEN interval '7 days'
         WHEN 'monthly' THEN interval '30 days'
       END
     END,
       refresh_updated_at = updated_at
 WHERE refresh_updated_at IS NULL;

ALTER TABLE appsea.research_campaigns
  ALTER COLUMN refresh_updated_at SET NOT NULL;

ALTER TABLE appsea.research_campaigns FORCE ROW LEVEL SECURITY;

ALTER TABLE appsea.research_campaigns
  ADD CONSTRAINT research_campaign_refresh_claim_check CHECK (
    (refresh_claim_owner IS NULL AND refresh_claim_token IS NULL AND refresh_claim_until IS NULL)
    OR (refresh_claim_owner IS NOT NULL AND refresh_claim_token IS NOT NULL AND refresh_claim_until IS NOT NULL)
  ),
  ADD CONSTRAINT research_campaign_refresh_claim_window_check CHECK (
    refresh_claim_until IS NULL OR refresh_claim_until > refresh_updated_at
  ),
  ADD CONSTRAINT research_campaign_refresh_pending_check CHECK (
    (refresh_pending_due_at IS NULL
      AND refresh_pending_run_id IS NULL
      AND refresh_pending_workflow_id IS NULL
      AND refresh_pending_idempotency_digest IS NULL
      AND refresh_pending_input_hash IS NULL
      AND refresh_pending_request IS NULL)
    OR (refresh_pending_due_at IS NOT NULL
      AND refresh_pending_run_id IS NOT NULL
      AND refresh_pending_workflow_id IS NOT NULL
      AND refresh_pending_idempotency_digest IS NOT NULL
      AND ((refresh_pending_input_hash IS NULL AND refresh_pending_request IS NULL)
        OR (refresh_pending_input_hash IS NOT NULL
          AND refresh_pending_request IS NOT NULL
          AND jsonb_typeof(refresh_pending_request) = 'object')))
  ),
  ADD CONSTRAINT research_campaign_refresh_attempt_check CHECK (
    refresh_attempt_count BETWEEN 0 AND 10
  ),
  ADD CONSTRAINT research_campaign_refresh_digest_check CHECK (
    refresh_pending_idempotency_digest IS NULL
    OR refresh_pending_idempotency_digest ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT research_campaign_refresh_input_hash_check CHECK (
    refresh_pending_input_hash IS NULL
    OR refresh_pending_input_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT research_campaign_refresh_failure_code_check CHECK (
    refresh_failure_code IS NULL
    OR refresh_failure_code ~ '^APPSEA_REFRESH_[A-Z0-9_:-]+$'
  ),
  ADD CONSTRAINT research_campaign_refresh_failure_summary_check CHECK (
    refresh_failure_summary IS NULL OR char_length(refresh_failure_summary) <= 240
  );

CREATE INDEX research_campaign_refresh_due_idx
  ON appsea.research_campaigns (refresh_next_due_at, workspace_id, campaign_id)
 WHERE refresh_next_due_at IS NOT NULL AND state <> 'archived';

GRANT UPDATE (
  refresh_next_due_at, refresh_claim_owner, refresh_claim_token,
  refresh_claim_until, refresh_pending_due_at, refresh_pending_run_id,
  refresh_pending_workflow_id, refresh_pending_idempotency_digest,
  refresh_pending_input_hash, refresh_pending_request, refresh_attempt_count,
  refresh_last_run_id, refresh_last_workflow_id, refresh_last_started_at,
  refresh_failure_code, refresh_failure_summary, refresh_updated_at
) ON appsea.research_campaigns TO appsea_service;

COMMIT;

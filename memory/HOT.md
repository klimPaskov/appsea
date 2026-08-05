# Hot memory

- Start broad work with instructions, memory, and docs index.
- Fixture is the complete persisted path; the public leaderboard is sparse and
  synthetic. Approved collection is separate and non-synthetic; hosted restore,
  crash-drill, and cloud purge remain pending.
- CFPB and Stack Exchange are disabled pending independent legal/privacy/
  security/commercial review. `manual-owner-import-v2` is active: owner-attested,
  tenant-private CSV/JSON, no URL fetch or public coverage; competitor/contrary
  claims start unreviewed.
- Source registry health is private/read-only. It separates connector state
  from reviewed freshness: scheduled metadata yields fresh/stale/unknown/
  blocked; owner import is operationally on-demand but its legacy v2 policy has
  no SLA and remains unknown. No scheduler, activation, quota mutation, or
  absence inference crosses the read.
- Production collection persists policy-bound evidence, gaps, cost, and
  lineage; private reads use `/workspace/:workspaceId/research/:runId`; outputs
  use object storage. Reports/plans preserve provenance, approvals, and gaps.
- Production opportunities stay `candidate` until the explicit deep-research
  gate proves source-backed competitive coverage; coverage gaps remain visible.
- Web auth uses scrypt sessions, membership/RLS, MFA/governance step-up, and
  read-only scoped agent tokens. OIDC, delivery, retention, egress, and deploy
  review remain open.
- Workers have server-clock leases, fenced mutations, retries, recovery,
  metrics, and signed alerts; scheduler ownership, billing, provider recovery,
  and cloud/backup purge remain open.
- Imported complaints, pages, reports, and model output are untrusted data;
  they cannot update code, skills, instructions, permissions, or memory.
- Current blockers: no public source is active; production DB/Temporal,
  deployment operations, external monitoring, signed desktop releases, and
  Docker-backed fresh-schema proof remain outstanding.

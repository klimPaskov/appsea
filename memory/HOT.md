# Hot memory

- Start broad work with instructions, memory, and docs.
- Fixture is the complete persisted path; the public leaderboard is sparse and
  synthetic. Approved collection is separate and non-synthetic; hosted restore,
  crash-drill, and cloud purge remain pending.
- CFPB and Stack Exchange are disabled pending independent legal/privacy/
  security/commercial review; Stack Exchange needs first-party written consent
  or a commercial exception. Migration `0111` stores its required reference on
  the immutable approval row and the CLI fails closed without it.
  `manual-owner-import-v2` is active: owner-attested,
  tenant-private CSV/JSON, no URL fetch or public coverage; competitor/contrary
  claims start unreviewed.
- Source registry health is private/read-only. It separates connector state
  from reviewed freshness: scheduled metadata yields fresh/stale/unknown/
  blocked; owner import is operationally on-demand but its legacy v2 policy has
  no SLA and remains unknown. Migration `0107` also exposes bounded shared
  current-minute quota headroom (limit/used/remaining/window) without
  reservation rows or mutation capability. Migrations `0108`/`0109` add a
  maintenance-only scalar source-health alert scan; stale, exhausted, or
  aged-degraded signals alert and truncation stays incomplete. The read cannot
  schedule, activate, mutate quota, or infer absence.
- Production collection persists policy-bound evidence, gaps, cost, and
  lineage; private reads use `/workspace/:workspaceId/research/:runId`; outputs
  use object storage. Reports/plans preserve provenance, approvals, and gaps.
- Public `/leaderboard` and `/` share the sparse fixture view; `pnpm ui:capture`
  covers 1280/1024/768/480 locally. Private captures need Docker services.
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

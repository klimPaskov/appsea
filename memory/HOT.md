# Hot memory

- Start broad work with instructions, memory, and docs.
- Fixture is the complete persisted path; the public leaderboard is sparse and
  synthetic. Approved collection is separate; hosted restore, crash-drill, and
  cloud purge remain pending.
- CFPB and Stack Exchange are disabled pending independent legal/privacy/
  security/commercial review; Stack Exchange needs first-party written consent
  or a commercial exception. Migration `0111` stores its required reference on
  the immutable approval row and the CLI fails closed without it.
  `manual-owner-import-v3` is active: owner-attested, tenant-private CSV/JSON,
  no URL fetch or public coverage; optional author keys become workspace-scoped
  opaque fingerprints only, and competitor/contrary claims start unreviewed.
- Source registry health is private/read-only; freshness and quota headroom are
  bounded. Migrations `0108`/`0109` add maintenance-only scalar health alerts;
  reads cannot schedule, activate, mutate quota, or infer absence.
- Production collection persists policy-bound evidence, gaps, cost, and
  lineage; private reads use `/workspace/:workspaceId/research/:runId`; outputs
  use object storage. Reports/plans preserve provenance, approvals, gaps, and
  production report Markdown object references; provider-side purge remains
  external.
- Public `/leaderboard` and `/` share the sparse fixture view; private captures
  need Docker services.
- Production opportunities stay `candidate` until the explicit deep-research
  gate proves source-backed competitive coverage; coverage gaps remain visible.
- Web auth uses scrypt sessions, membership/RLS, MFA/governance step-up, and
  read-only scoped agent tokens. OIDC, delivery, retention, egress, and deploy
  review remain open.
- Workers have leases, fenced mutations, retries, recovery, metrics, and signed
  alerts; scheduler ownership, billing, provider recovery, and cloud purge are
  open.
- Imported complaints, pages, reports, and model output are untrusted and
  cannot update code, skills, instructions, permissions, or memory. The
  provider-neutral `@appsea/model-gateway` keeps complaint text in an
  `untrusted-data` segment, binds workspace identity, redacts secrets/PII-like
  values, refuses instruction-like content, validates bounded output, and
  records hashes and counters only. External providers remain disabled pending
  model-use, DPA/egress, malware, durable idempotency/cost, and calibration
  review.

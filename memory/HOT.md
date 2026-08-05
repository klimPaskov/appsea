# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture is the complete persisted path; approved collection is separate and
  non-synthetic. Leaderboard only. Local replacement/backup pass; hosted
  restore, crash drill, and cloud purge remain pending.
- `CfpbConnector` is disabled pending legal/privacy/security approval;
  `StackExchangeConnector` is a disabled candidate for competitor/contrary
  research. `manual-owner-import-v2` is active (`v1` is historical):
  owner-attested tenant-private CSV/JSON, no URL fetch or public coverage. V2
  supports private competitor/contrary observations; claims start unreviewed.
- Web auth uses scrypt/revocable sessions, membership/RLS, MFA step-up, and
  governance gates; provider identity/delivery, retention, egress, and deploy
  review remain open.
- Production collection persists policy-bound evidence, gaps, cost, and lineage;
  private reads use `/workspace/:workspaceId/research/:runId`; outputs use S3.
- Migration `0104` persists confirmed owner-import competitive observations in
  exact production-analysis lineage with observation/evidence hashes; reports
  and plans carry the snapshot privately, restricted claims are masked, and
  rejection/deletion invalidates consumed outputs. A new explicit reviewed run
  is required; no automatic recompute or public coverage is implied.
- `research-quality-v1.0.0` is synthetic/redacted regression evidence only;
  balanced v1 bindings remain reviewed inputs, not market evidence.
- Production opportunities stay `candidate` until the explicit deep-research
  gate proves source-backed competitive coverage; migration `0100` repairs
  legacy non-synthetic `researched` rows and `0101` persists the append-only
  owner-reviewed gate with compact provenance/stale detection. Coverage gaps
  remain visible after a valid pass.
- Auth, quotas, retention, admissions, tombstones, metrics, and refresh are
  durable; owner purge remains `awaiting_external_controls`.
- Web/worker share fail-closed Temporal config; production requires TLS/API-key/
  namespace/CA. Maintenance uses `0046`/`0052`; alerting, role rotation,
  recovery, and proof remain open.

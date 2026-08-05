# Hot memory

- Start broad work with instructions, memory, and docs index.
- Fixture is complete persisted path; approved collection is separate and
  non-synthetic. Leaderboard only. Local backup pass; hosted
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
- Migration `0104` carries confirmed owner-import competitive observations into
  exact production-analysis lineage with hashes and redaction; rejection or
  deletion invalidates outputs and requires a new reviewed run.
- Migration `0105` adds append-only private decisions with identifier-only
  snapshots, stale/idempotent transitions, audited receipts, owner approval,
  and step-up web history; fixtures/MCP remain read-only. Auth JSON uses a
  streaming 32 KiB cap with `413` for oversized bodies.
- Migration `0106` adds append-only forced-RLS cluster review events with
  stale hashes, bounded split/merge lineage, membership-state updates, and
  identifier-only snapshots. Evidence exposes owner/editor curation;
  fixtures stay read-only and the deep-research gate blocks unreviewed clusters.
- `research-quality-v1.0.0` is synthetic/redacted regression evidence only;
  balanced v1 bindings remain reviewed inputs, not market evidence.
- Production opportunities stay `candidate` until the explicit deep-research
  gate proves source-backed competitive coverage; migration `0100` repairs
  legacy non-synthetic `researched` rows and `0101` persists the append-only
  owner-reviewed gate with compact provenance/stale detection. Coverage gaps
  remain visible after a valid pass.
- Auth, quotas, retention, admissions, tombstones, metrics, and refresh are
  durable; owner purge remains external.
- Web/worker share fail-closed Temporal config; production TLS, alerting,
  rotation, recovery, and proof remain open.

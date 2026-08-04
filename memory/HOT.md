# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture is the complete persisted path; approved collection is separate/non-synthetic. Leaderboard only.
- Fixture/collection tested; fresh PostgreSQL/Temporal CI-proven. Worker
  replacement and schema/role backup-restore pass locally; hosted restore,
  crash drill, and cloud purge remain pending.
- `CfpbConnector` is disabled pending legal/privacy/security approval;
  `StackExchangeConnector` is a disabled candidate for competitor/contrary
  research. `manual-owner-import-v1` is the only active non-fixture path and
  accepts owner-attested tenant-private CSV/JSON; it never fetches URLs or
  establishes public coverage.
- Web auth uses scrypt/revocable sessions, membership/RLS, password/MFA step-up, and governance gates; provider identity/delivery, retention, DNS/egress, deployment review, and unrelated mutations remain open.
- Production collection persists policy-bound evidence, complaints, gaps, cost, and lineage; private reads use `/workspace/:workspaceId/research/:runId`; outputs use filesystem/S3.
- The deterministic `research-quality-v1.0.0` benchmark is synthetic/redacted regression evidence only. Optional artifact/report snapshots expose classifier/entity, deduplication, clustering, stability, ranking, and calibration metrics with `reviewed-input-only` and `sourceCoverage: not-derived`; it does not calibrate live sources or derive score-factor provenance.
- Analysis v2 carries IDs/digests; the worker rebuilds artifacts in-activity. Legacy v1 drain, cloud/backup purge, role rotation, and scheduler ownership remain open. Collection writes lock leases; `0037` recovers stale dispatches.
- Auth, quotas, retention, admissions, tombstones, scheduler metrics, and
  refresh are durable; owner purge remains `awaiting_external_controls`.
- Web/worker share fail-closed Temporal config; production requires TLS/API-key/namespace/CA. Maintenance uses `0046`/`0052`; alerting, role rotation, recovery, and proof remain open.
- Runtime skill registry is dormant: independent proposer/evaluator/approver,
  signed review/transition evidence, and migration `0099` operator-only
  persistence/audit with expected-hash concurrency; no worker import/activation.
- Read-only MCP tokens recheck membership and use bounded PostgreSQL windows and
  leases; edge limits, secret storage, and hosted monitoring remain open.

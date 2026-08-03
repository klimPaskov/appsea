# Hot memory

- Start broad work with instructions, memory, and `docs/INDEX.md`.
- Fixture is the complete persisted path; approved collection is separate/non-synthetic. Leaderboard only.
- Fixture/collection tested; fresh PostgreSQL/Temporal CI-proven. Prod deployment/crash-drill and cloud/backup purge remain pending. `0043`/`0044` queue/retry output tombstones.
- `CfpbConnector` is disabled pending legal/privacy/security approval; `StackExchangeConnector` is a disabled candidate for competitor/contrary research; no real source is active.
- Web auth uses scrypt/revocable sessions, membership-before-RLS, step-up, and TOTP MFA with encrypted secrets, hash recovery codes, expiring challenges, `0081` markers, and `0086`/`0087` rewrap/status. Migration `0088` adds disabled OIDC links/sign-in with reviewed endpoints, private-host checks, state/nonce/PKCE, RS256/verified-email, POST step-up linking, database-bound MFA handoff, success-only telemetry, and closure deletion. Provider approval/delivery, retention/revocation, DNS/egress, provider-backed step-up, deployment review, and non-password-gated mutations remain open.
- Production collection persists policy-bound evidence, complaints, gaps, cost, and lineage; private reads use `/workspace/:workspaceId/research/:runId`; outputs use filesystem/S3.
- `0067` adds step-up owner/editor redaction receipts and masks; provenance, hashes, snapshots, raw deletion, and cloud/backup purge remain separate.
- Analysis v2 carries IDs/digests; the worker rebuilds artifacts in-activity. Legacy v1 drain, cloud/backup purge, role rotation, and scheduler ownership remain open. Collection writes lock leases; `0037` recovers stale dispatches.
- Auth, quotas, retention, admissions, purge, tombstones, scheduler metrics, and
  campaign refresh are durable; `maintenance:loop` is signal-safe. Owner purge
  remains `awaiting_external_controls`; no destructive operation is wired.
- Purge manifests/re-collection are explicit, private, idempotent, and never authorize deletion or automatic refetch.
- Web/worker share fail-closed Temporal config; production requires TLS/API-key/namespace/CA. Maintenance uses `0046` leases/`0052` fencing; direct source commands use `0051`; deployment alerting, role rotation, recovery, and proof remain open.
- Production packaging has non-root web/worker images, Compose preflight, and CI smoke; Tauri is CSP/capability-bounded; provider provisioning, signed images/desktop, and deployment drills remain open.

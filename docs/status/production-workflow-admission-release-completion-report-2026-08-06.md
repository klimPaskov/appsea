# Production workflow admission release — 2026-08-06

Status: repository tranche complete; hosted operation remains external.

Migration `0112` adds a security-definer release function for a production
collection admission that is still `reserved`, has not expired, matches the
input hash, and is being released by the authenticated owner/editor in the
same private non-fixture workspace. The function locks the row, is idempotent
for an already released row, and returns `false` for missing, consumed, or
expired reservations. It is executable only by `appsea_service` and is called
through the authenticated workspace transaction boundary.

The owner-import route now admits before staging, then releases only a newly
admitted reservation when normalized batch persistence fails. Replayed
admissions are left alone. A Temporal-start failure still leaves the admission
protected by the existing five-minute TTL because the external start outcome
may be uncertain.

Evidence:

- migration loader and SQL-boundary assertions cover `0112`, auth context,
  consumed-row protection, and least-privilege execution;
- repository tests cover authenticated release and digest validation;
- the manual-import route tests cover staging failure release and replay
  protection;
- PostgreSQL integration covers release, release idempotency, reuse after
  release, consume-then-no-release, and cleanup;
- backup/restore and fresh/populated persistence checks now target 112
  migrations.

This tranche does not activate a third-party source, remove the Temporal
uncertainty window, or provide hosted PostgreSQL/Temporal recovery evidence.

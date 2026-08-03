# Production packaging instructions

This directory contains deployment packaging and process topology only. It
does not hold credentials, provider state, migrations, or source activation.

- Keep `production.env` untracked and load secrets through the deployment
  secret mechanism.
- Preserve the one-shot `production:preflight` gate before web, worker, or
  maintenance startup.
- Keep migrations behind the explicit `migrate` Compose profile and use the
  dedicated migrator role; never add automatic destructive or down migrations.
- Treat PostgreSQL, Temporal, object storage, identity, alert delivery, and
  source-policy approval as external reviewed boundaries.
- Keep long-lived services non-root, read-only, capability-dropped, and
  loopback-bound by default unless a deployment review documents the change.

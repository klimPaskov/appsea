# 2026-08-03 production cancellation handoff

## Completed

- Migration `0071_production_collection_workflow_cancellation.sql` adds
  forced-RLS one-source cancellation intent with owner/editor trigger checks,
  service retry reads, and grants limited to intent columns.
- The PostgreSQL repository persists idempotent intent and audit/outbox receipts;
  the private workflow status route and campaign history/status UI expose the
  safe-boundary request.
- Source maintenance retries Temporal cancellation with a bounded lease-aware
  runner. The production workflow remains terminal-state authority.

## Validation

Focused contracts/db/worker/web suites pass at 86/124/100/132. Affected
typechecks and formatting pass. Fresh PostgreSQL/Temporal probes remain blocked
by the unavailable Docker Desktop Linux engine pipe.

## Next

Run the guidance checkpoint and full repository verification. Keep the remaining
production blockers visible: source approval, PostgreSQL/Temporal provisioning,
identity/provider operations, cloud purge/backup controls, alert routing, and
signed Windows/macOS release validation.

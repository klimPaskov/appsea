# Evidence redaction completion report — 2026-08-02

Status: implemented as a reviewed private projection slice; not a claim of
production readiness or source activation.

## Delivered

- Migration `0067_field_level_evidence_redaction.sql` adds field masks to
  source/evidence rows, a forced-RLS immutable receipt table, a
  security-definer application function, a transaction-local capability, and
  identifier-only audit/outbox receipts.
- Contracts define strict redaction fields/reasons/results and pure read-time
  masking helpers. Production-only evidence lineage survives masking.
- The PostgreSQL repository binds each request to the authenticated workspace,
  collection run, complaint, and evidence record; replay is idempotent and
  conflicting receipt reuse is rejected.
- Private collection, opportunity, analysis, report, coding-plan, leaderboard,
  and export readers union persisted masks. The web collection route requires
  same-origin session,
  recent password reauthentication, and editor/owner authorization. The UI
  exposes a small per-evidence privacy-redaction control.
- Raw source-object removal, cloud object-store/backup purge, export purge, and
  automatic re-analysis remain separate operations.

## Validation

- `@appsea/contracts` typecheck and tests pass (81 tests).
- `@appsea/db` typecheck and tests pass (117 tests across 27 files).
- `@appsea/web` typecheck and tests pass (route and private UI coverage is
  included in the package suite).
- Migration loader assertions include version `0067` and the redaction
  function/table/capability markers.
- Docker-backed PostgreSQL integration was attempted through the repository
  persistence gate but remains unavailable on this host because the Docker
  Desktop Linux engine pipe is missing. No fresh-RLS/migration proof is claimed.

## Deliberate simplifications and gaps

- The immutable analysis snapshot and content-addressed output bodies are not
  rewritten; private read mappers apply the mask. Operators must run the
  source-policy deletion/purge workflow when raw object deletion is required.
- The privacy marker is intentionally stable and generic; it does not expose
  the redaction reason or original content.
- No source connector was enabled and no fixture content is presented as real
  market evidence.

# Privacy-safe author coverage completion report — 2026-08-10

Status: **implemented in the repository; database execution proof remains
environment-blocked**.

## Delivered

- `manual-owner-import-v3` is the current reviewed owner-authorized source
  policy. v1 and v2 remain immutable historical snapshots.
- CSV and JSON imports accept only bounded opaque author keys. The connector
  applies domain-separated, workspace-scoped SHA-256 before staging and
  retains no raw author value. Email addresses, URLs, whitespace-bearing
  values, and unscoped values are rejected.
- PostgreSQL migration `0122_manual_import_author_fingerprints.sql` adds the
  digest column, expands the redaction contract, clears the digest during
  source deletion or explicit author-field redaction, and records the v3
  policy/review snapshot.
- Production collection carries the digest through the complaint projection;
  reports and inert Markdown exports expose available, partial, or unavailable
  author coverage with an explicit gap. Public leaderboard output remains
  sparse and fixture-safe.
- Private evidence redaction can clear the opaque digest, and the private
  report view labels the value as an opaque source identity rather than a
  person.

## Proof

- `pnpm test` — passed all 15 packages, including 119 contract tests, 40
  connector tests, 191 database tests, 14 report tests, 146 worker tests, and
  241 web tests.
- `pnpm --filter @appsea/web typecheck` and `pnpm --filter @appsea/web lint` —
  passed.
- `pnpm format:check` — passed after formatting the changed TypeScript and
  audit files.
- `pnpm smoke:web` — passed the sparse leaderboard, opportunity routes, and
  fixture API; the persisted 2026-08-10 UI capture set reports no runtime or
  horizontal-overflow failures at the checked desktop widths.
- Connector, contract, report, and database unit tests cover deterministic
  hashing, invalid raw inputs, redaction clearing, report gap disclosure, and
  migration presence.

## Boundary and remaining blocker

This capability is tenant-private owner-attested evidence; it does not create
public market coverage or authorize CFPB, Stack Exchange, or another
third-party source. Fixture reports disclose that unique-author coverage is
unavailable. Docker Desktop's `dockerDesktopLinuxEngine` pipe is unavailable in
this environment, so fresh/upgrade PostgreSQL, RLS, deletion propagation, and
backup/restore execution against migration `0122` remain deployment-proof
work.

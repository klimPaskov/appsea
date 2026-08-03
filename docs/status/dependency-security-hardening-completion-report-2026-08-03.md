# Dependency security hardening completion report

Status: implemented and validated; deployment still owns runtime and provider
security controls.

## Delivered

- Updated the web runtime from Next.js `16.2.10` to `16.2.12`, which includes
  fixes for the reported App Router, Server Action, cache, rewrite, image,
  and internal endpoint advisories.
- Added workspace-level pnpm overrides for patched `postcss` `8.5.25`,
  `fast-uri` `3.1.4`, and `sharp` `0.35.3`. The overrides cover transitive
  dependencies pulled by Next.js and Temporal's worker bundler without
  changing AppSea application contracts.
- Added `pnpm security:audit` and made the GitHub verification job run it
  after the frozen install, so a high-severity production dependency finding
  fails CI before the general proof suite.

## Validation

- `pnpm audit --prod --json` reports zero informational, low, moderate, high,
  or critical vulnerabilities across the current production graph.
- Web lint, typecheck, 147 web tests, and the production build pass on Next.js
  `16.2.12`.
- Worker lint/typecheck and 118 worker tests pass with the patched transitive
  graph.
- Turbo now serializes each package's `build` after its `typecheck`, preventing
  concurrent Next route-type generation/build cleanup from producing a false
  clean-checkout failure.
- GitHub Actions run `30819616149` passed `pnpm security:audit`, the full
  verification suite, fresh PostgreSQL persistence, and fresh Temporal
  workflow checks for commit `1cc781c`.

## Remaining security scope

This tranche does not claim provider-side TLS, secret-manager, database,
Temporal, object-storage, backup, identity-provider, source-policy, or signed
desktop security approval. Those deployment and legal/privacy/security gates
remain explicit in the production-readiness audit.

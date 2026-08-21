# Dependency security hardening completion report — 2026-08-21

Status: verified for the repository dependency graph; provider, deployment,
and runtime security controls remain separate release work.

## Finding and change

`pnpm security:audit` identified a high-severity `nanoid` advisory because the
workspace override resolved `postcss` to `nanoid@3.3.17`, which is vulnerable
below `3.3.18`. The override in `pnpm-workspace.yaml` and the checked-in
`pnpm-lock.yaml` now pin `nanoid` to `3.3.18`. No application contract,
source-policy behavior, or runtime authorization boundary changed.

## Validation

- `pnpm install --lockfile-only` completed and the lockfile supply-chain policy
  check passed.
- `pnpm why nanoid` resolves only `nanoid@3.3.18` through PostCSS.
- `pnpm security:audit` passes with `No known vulnerabilities found`.
- The existing full tests, typecheck, lint, build, web smoke, release static
  checks, memory validation, and documentation validation remain green from
  the preceding tranche.

## Remaining security scope

This closes the identified repository dependency finding only. Production
secret management, TLS and database/Temporal hardening, object-store and
backup controls, identity-provider operations, source-policy approval, alert
endpoint ownership, and signed desktop security review remain explicit
deployment or legal/privacy/security gates.

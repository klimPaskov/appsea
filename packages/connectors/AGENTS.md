# Connector instructions

Read the root `AGENTS.md` and `appsea-source-connector` skill before changing this package.

Every connector needs an explicit `SourcePolicy`. The connector must fail closed when the policy is disabled, commercially unknown, expired, or incompatible with the requested display mode. Preserve provenance and deletion identifiers. Never place credentials in source code or fixtures.

Source activation also requires the database-bound review integrity boundary:
canonical reviewer identity, an allowed independent role, and explicit
attestation. A connector must not treat a free-form reviewer label or legacy
approval as sufficient activation evidence.

Production connector construction must receive the immutable policy payload
returned by the database approval read and compare it with the effective
activation snapshot before any source request. Tests may omit that payload only
when they stay in the explicit test environment; production callers must fail
closed when the reviewed snapshot is absent.

# Connector instructions

Read the root `AGENTS.md` and `appsea-source-connector` skill before changing this package.

Every connector needs an explicit `SourcePolicy`. The connector must fail closed when the policy is disabled, commercially unknown, expired, or incompatible with the requested display mode. Preserve provenance and deletion identifiers. Never place credentials in source code or fixtures.

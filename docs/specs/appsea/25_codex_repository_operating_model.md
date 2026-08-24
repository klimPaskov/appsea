# Codex repository operating model

## Start sequence

A coding agent opens the repository root and reads:

1. root `AGENTS.md`
2. `START_HERE.md`
3. hot, user, and active memory
4. documentation index
5. active plan
6. relevant scoped instructions and native skills

## Work sequence

The main agent inspects existing patterns, selects a complete vertical slice, implements it, validates it, updates documentation and memory, then runs a guidance checkpoint.

## Guidance checkpoint

After meaningful work, classify new information:

- current state goes to active memory
- stable fact goes to project memory
- accepted architecture goes to an ADR
- reusable procedure goes to a skill
- local rule goes to a scoped `AGENTS.md`
- stable global rule goes to root `AGENTS.md`
- one-off history goes to a session handoff or completion report

The root instructions remain below 32 KiB. Generated catalogs are synchronized
from skill and subagent metadata. An intentionally empty, user-owned root
`AGENTS.md` is preserved by synchronization; scoped guidance and the generated
catalogs remain the source of operational detail in that case.

## Completion proof

Large goals require aligned code, tests, artifacts, docs, memory, skills, and an honest statement of remaining gaps and simplifications.

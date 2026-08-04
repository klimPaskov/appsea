# Runtime skill governance completion report

Status: implemented and locally validated; no runtime skill is active.

## Delivered

- `packages/skill-registry` now owns proposal, evaluation, approval, hydration,
  and activation transitions.
- Records carry proposer, evaluator, and approver identities plus immutable
  evaluation and approval evidence.
- Approval evidence signs the requested permission set and complete review
  chain with an operator-held HMAC secret. Active and retired transitions also
  sign their target state, canonical actor/timestamp, transition identifier,
  and complete review chain. Permission edits, forged status/timestamps/actors,
  unknown states, copied evidence, wrong-registry secrets, and plain objects
  fail closed.
- Privileged permissions require an evaluator and an independent approver;
  proposers cannot evaluate or approve their own skill.
- The package remains a dormant contract foundation. It is not imported by the
  worker, does not activate sources, and does not grant production permissions.

## Validation

- `pnpm --filter @appsea/skill-registry lint`
- `pnpm --filter @appsea/skill-registry typecheck`
- `pnpm --filter @appsea/skill-registry test` (6 tests)

The tests cover unapproved and forged activation, independent review, persisted
approval/active/retired tamper detection, canonical transition validation,
malformed signatures, and rejection of evidence signed by another registry.

The latest hosted GitHub Actions run `30930177455` for commit `e3d5f69` was
blocked before repository steps by the account payment/spending-limit gate.
The local proof above is independent of that hosted billing state.

## Remaining gaps

The future runtime still needs a reviewed persistence adapter, authenticated
operator identity, audit/event storage, permission-specific policy review, and
an explicit activation operation. Imported evidence remains untrusted and
cannot update the registry, code, skills, instructions, permissions, or
memory.

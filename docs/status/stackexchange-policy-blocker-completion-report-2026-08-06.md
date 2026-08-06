# Stack Exchange policy blocker completion report — 2026-08-06

## Outcome

The disabled `stackexchange-stackoverflow` candidate now records the current
first-party automated-collection restriction as an explicit policy blocker.
The source remains unregistered and cannot create non-synthetic production
evidence.

This tranche does not determine legal permission. It preserves the source as a
fixture-tested engineering candidate while requiring independent legal,
privacy, and security review plus express prior written consent or an
applicable commercial exception before any activation decision.

## Evidence and decisions

- The first-party [Network Acceptable Use Policy](https://stackoverflow.com/legal/acceptable-use-policy)
  restricts automated gathering for building a similar or competitive
  product/service or for generative-AI work unless prior written consent or a
  commercial exception applies.
- The [Stack Exchange API documentation](https://api.stackexchange.com/docs?tab=type)
  describes v2.3 access, throttling, and bounded page sizes; API access does
  not override the Network AUP.
- The [API Terms of Use](https://engineering.stackexchange.com/legal/api-terms-of-use)
  require visible attribution, and the [licensing guidance](https://stackoverflow.com/help/licensing)
  describes time-dependent CC BY-SA terms. Those facts do not by themselves
  establish permission for AppSea's intended automated route.
- `packages/connectors/src/index.ts` now records `commercialUse: 'unknown'`,
  the AUP blocker, and the written-consent/exception requirement in the
  immutable draft policy metadata.
- `assertPolicyAllowsCollection` therefore fails closed for an enabled,
  otherwise approved-looking copy of the draft until a reviewed policy changes
  the commercial-use state. HTTP fixture tests use a separate hypothetical
  restricted-use policy to exercise request mapping without activating the
  draft.

## Validation

- `pnpm --filter @appsea/connectors test`
- `pnpm --filter @appsea/connectors lint`
- `pnpm --filter @appsea/connectors typecheck`
- `pnpm format:check`
- `pnpm memory:check`
- `pnpm repo:check --docs-only`

The full repository verification and Docker-backed persistence evidence remain
separate gates. No source was registered, enabled, fetched, or activated by
this tranche.

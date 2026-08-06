# Model gateway boundary

The model gateway is a provider-neutral trust boundary for future complaint
analysis. It is implemented in `packages/model-gateway` and is called inside
the production-analysis worker activity after policy-validated rows are read.
The gateway receives fixed system/developer segments plus one
`untrusted-data` segment. Imported text is normalized in memory, secret and
PII-like values are redacted before any transport boundary, and instruction-like
content is refused. Results and artifact snapshots contain only structured
labels, hashes, fixed safety findings, and bounded counters; they never contain
the complaint text or a raw prompt. Requests also carry the workspace identity
for tenant-scoped audit and egress binding. Source policy fields are provenance
only: callers cannot set model-use approval, and snapshot policy state is
derived from the server-owned gateway context.

## Local proof

Run the package contract and adversarial tests:

```powershell
pnpm --filter @appsea/contracts test
pnpm --filter @appsea/model-gateway test
pnpm --filter @appsea/model-gateway typecheck
pnpm --filter @appsea/worker typecheck
```

The production activity uses `deterministic-fallback-v1`. This fallback is a
bounded review signal only; deterministic/human-corrected `ComplaintAnalysis`
snapshots remain authoritative for clustering, scoring, reports, and plans. A
production artifact records a `model-gateway-v1` summary and a visible coverage
gap stating that no external model-use policy is approved.

The local replay cache is bounded for process safety. It is not durable across
worker replacement or activity retry; any real provider must add a durable
idempotency record and cost ledger before activation.

## Activation gate

The `external-disabled` provider is fail-closed, including when a source's
collection policy is approved. Before adding a real provider, an independent
review must establish all of the following:

- a source-specific model-use permission separate from collection approval;
- provider DPA, retention, training-use, residency, and deletion terms;
- a credential/egress boundary with rate, timeout, retry, and cost budgets;
- content-type and malware scanning for file inputs;
- prompt, model, and structured-output schema versions with adversarial tests;
- redaction/leak tests and an approved policy for storing model metadata; and
- calibration/evaluation evidence before model suggestions can influence a
  reviewed analysis.

No provider credential, endpoint, or network call belongs in this repository
slice. Imported content remains hostile input and cannot modify code, skills,
instructions, permissions, or repository memory.

# Fixture research runbook

Run:

```bash
pnpm worker:fixture
```

Expected output:

```text
artifacts/research/seed-research-artifact.json
```

The artifact must validate through shared contracts, identify fixture mode, include a source policy, preserve synthetic complaint provenance, contain one versioned complaint-analysis snapshot per complaint, contain complaint clusters, and include a versioned deterministic score. Analysis may label unresolved competitor or substitute dimensions, but it must not turn fixture content into market evidence.

Generate a coding-agent package with:

```bash
pnpm plan:sample
```

Expected folder:

```text
artifacts/plans/inbox-relay/
```

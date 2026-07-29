# Fixture research runbook

Run:

```bash
pnpm worker:fixture
```

Expected output:

```text
artifacts/research/seed-research-artifact.json
```

The artifact must validate through shared contracts, identify fixture mode, include a source policy, preserve synthetic complaint provenance, contain complaint clusters, and include a versioned deterministic score.

Generate a coding-agent package with:

```bash
pnpm plan:sample
```

Expected folder:

```text
artifacts/plans/inbox-relay/
```

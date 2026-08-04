# Score-factor provenance handoff — 2026-08-04

## Outcome

Balanced `opportunity-score-v1.0.0` inputs and snapshots now require a
complete factor-keyed provenance map. Each binding is either
`source-evidence` or `reviewed-seed`; explanations preserve the basis and IDs,
and deterministic replay includes the map.

## Validation boundary

Production analysis accepts a source binding only when its identifier is one of
the retained complaint evidence IDs in the same analysis input. Reviewed-seed
bindings must start with `reviewed-seed:<immutable seed review ID>:`. This keeps
reviewed assumptions distinct from market evidence and blocks unrelated IDs at
both analysis-input and artifact validation boundaries.

## Files and proof

- Contracts/scoring: `packages/contracts/src/index.ts` and
  `packages/scoring/src/index.ts`.
- Fixtures/smoke: `packages/scoring/src/scoring.test.ts`,
  `packages/research/src/research.test.ts`, and
  `scripts/smoke_local_stack.mjs`.
- Decision/status: `docs/adrs/0027-score-factor-provenance.md` and
  `docs/status/score-factor-provenance-completion-report-2026-08-04.md`.
- Package tests and typechecks for contracts, scoring, and research pass.

## Remaining work

No source connector was activated. Live calibration, source-backed competitor /
contrary research, provider infrastructure, cloud purge, identity operations,
desktop release evidence, and hosted CI billing remain external blockers.

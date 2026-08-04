# Website brand mark completion report — 2026-08-04

Status: implemented and locally validated as a narrow website-only visual
slice. This report does not change the sparse leaderboard contract or make a
desktop release claim.

## What changed

- Added `apps/web/public/appsea-mark-generated.png`, a generated, non-text
  AppSea mark intended to remain legible at the 32px header size.
- Replaced the header's placeholder `A` character with a semantic `next/image`
  asset while preserving the existing accessible `AppSea leaderboard` label,
  navigation, and layout.
- Kept the Tauri `icon.png`/`icon.ico` pair unchanged. A website raster mark is
  not sufficient evidence for an aligned desktop icon pair, signing, updater,
  notarization, or installation support.

## Asset provenance

The asset was generated with the built-in image-generation workflow on
2026-08-04 from a prompt requesting a compact abstract wave-and-signal mark,
without text, numbers, or brand imitation. It is a product asset, not imported
complaint or market content. The generated source remains in the Codex output
directory; the checked-in copy is the only repository reference. The checked-in
copy is a 256×256 PNG resized with the repository's existing image-processing
dependency; no Python geometry or hand-drawn replacement was used.

## Validation

- `pnpm --filter @appsea/web test` — 51 files, 190 tests.
- `pnpm --filter @appsea/web lint` — passed.
- `pnpm --filter @appsea/web typecheck` — passed.

The full repository proof remains required before a broader completion claim.

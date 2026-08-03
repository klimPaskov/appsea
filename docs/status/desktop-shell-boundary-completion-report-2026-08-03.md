# Desktop shell boundary completion report — 2026-08-03

Status: compilable repository boundary; signed Windows/macOS release is not
claimed.

## Delivered

- Added the Tauri build script and committed Rust dependency lockfile so the
  shell compiles with `cargo check`.
- Added a deterministic AppSea window icon required by the Windows resource
  build and declared it in the bundle configuration.
- Added a minimal `core:default` capability for the main window.
- Replaced the permissive `null` CSP with a local same-origin policy that
  denies plugin content and keeps the development web origin explicit.
- Added a Windows GitHub Actions job that runs the boundary check and Rust
  compile independently of the web/worker CI jobs.

## Validation

- `pnpm --filter @appsea/desktop build` passed locally.
- `pnpm desktop:check` passed locally on Windows after the Tauri build hook
  and icon were added.
- GitHub Actions run `30824653661` passed for commit `98ef62e`, including the
  Windows desktop boundary/Rust compile job, full verification, fresh
  PostgreSQL and Temporal checks, Compose validation, and both container image
  builds. It does not build or sign an installer.

## Explicit limits

Bundling remains disabled. This tranche does not configure an updater, sign
artifacts, notarize macOS builds, test installers, or claim a Windows/macOS
release. A production desktop configuration must review the hosted web origin,
capability expansion, CSP changes, secret handling, update trust, and platform
release process separately.

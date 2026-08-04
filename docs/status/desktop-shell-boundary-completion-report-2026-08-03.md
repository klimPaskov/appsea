# Desktop shell boundary completion report — 2026-08-03

Status: compilable repository boundary; signed Windows/macOS release is not
claimed.

## Delivered

- Added the Tauri build script and committed Rust dependency lockfile so the
  shell compiles with `cargo check`.
- Added deterministic AppSea PNG and ICO icon assets and declared both in the
  bundle configuration for cross-platform compilation.
- Added a minimal `core:default` capability for the main window.
- Replaced the permissive `null` CSP with a local same-origin policy that
  denies plugin content and keeps the development web origin explicit.
- Added independent Windows and macOS GitHub Actions jobs that run the
  boundary check and Rust compile independently of the web/worker CI jobs.

## Validation

- `pnpm --filter @appsea/desktop build` passed locally.
- `pnpm desktop:check` passed locally on Windows after the Tauri build hook
  and icon were added.
- The macOS compile boundary is covered by the independent `desktop-macos` CI
  job; this is a compile check, not a signed installer or notarization proof.
- GitHub Actions run `30887742764` passed for commit `b833a69`, including both
  independent Windows/macOS desktop boundary jobs, full verification, fresh
  PostgreSQL and Temporal checks, the loopback private-stack smoke, Compose
  validation, and both container image builds. It does not build or sign an
  installer.

## Explicit limits

Bundling remains disabled. This tranche does not configure an updater, sign
artifacts, notarize macOS builds, test installers, or claim a Windows/macOS
release. A production desktop configuration must review the hosted web origin,
capability expansion, CSP changes, secret handling, update trust, and platform
release process separately.

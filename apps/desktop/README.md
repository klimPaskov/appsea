# AppSea desktop boundary

This folder reserves a Tauri 2 shell for Windows and macOS. The website remains the source of truth while the product contract is still changing.

The shell has a compilable Tauri build boundary, a minimal capability set, and
a restrictive local CSP. It records the intended bundle identity, window
defaults, and development URL. It is not a signed desktop release.

## Development checks

From the repository root:

```bash
pnpm --filter @appsea/desktop build
pnpm desktop:check
```

`desktop:check` compiles the Rust shell for the current platform. The shell
does not duplicate web product logic; it wraps the web contract and keeps
bundling disabled until the signed-release gates below are complete.

Before a release claim, add:

- Tauri CLI development/build integration
- production web asset strategy
- application signing
- updater configuration
- Windows installation tests
- macOS installation and notarization tests
- desktop-specific security review

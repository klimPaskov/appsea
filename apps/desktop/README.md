# AppSea desktop boundary

This folder reserves a Tauri 2 shell for Windows and macOS. The website remains the source of truth while the product contract is still changing.

The scaffold records the intended bundle identity, window defaults, and development URL. It is not a signed desktop release.

Before a release claim, add:

- Tauri CLI and Rust build integration
- production web asset strategy
- application signing
- updater configuration
- Windows installation tests
- macOS installation and notarization tests
- desktop-specific security review

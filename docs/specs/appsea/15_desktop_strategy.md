# Windows and macOS desktop strategy

## Goal

Provide a desktop application without duplicating the web product or moving the heavy research system onto user machines.

## Recommended approach

Use Tauri as a thin shell that loads the shared web application and adds carefully selected desktop capabilities.

The cloud service remains the source of truth for research, evidence, scores, reports, skills, and workflows.

## Desktop capabilities for the first release

- secure sign-in with browser-based OIDC and PKCE
- native application window
- deep links to opportunities, reports, and runs
- system notifications for completed research and review requests
- secure local storage for minimal session material
- signed automatic updates
- download and open exported plan packages
- optional menu-bar or tray status
- native file picker for imports and exports

## Capabilities to defer

- full offline research
- local social connectors
- local model execution
- local production database
- arbitrary local repository modification
- background shell execution

These increase security and support cost. Add them only for a defined user need.

## Shared code

Share:

- UI components
- routes where practical
- API client
- contracts
- authentication state machine
- telemetry helpers
- feature flags
- plan-package viewer

Keep Tauri-specific code in `apps/desktop`.

## Security

- use system web authentication
- do not embed long-lived secrets in the binary
- store tokens in the operating-system credential store through approved plugins
- use a strict Tauri capability configuration
- deny filesystem and shell access by default
- validate deep links
- verify update signatures
- pin update channels
- prevent web content from invoking unrestricted native commands

## File handling

The desktop app may import:

- CSV
- JSON
- JSONL
- Markdown packages
- ZIP plan packages

Uploads go through the same server validation as the web product.

Downloaded exports should include hashes and manifest validation.

## Update channels

- internal
- beta
- stable

Promotion requires automated tests, platform signing, malware scanning, and release approval.

Provide rollback to the previous stable version where the updater permits it.

## Windows requirements

- code signing
- WebView2 availability handling
- installer choice documented
- per-user installation by default
- protocol handler registration
- update and uninstall testing

## macOS requirements

- Apple Developer signing
- notarization
- hardened runtime
- entitlements kept minimal
- universal build when supported and useful
- deep link and update testing

## Desktop acceptance

- sign-in works on supported Windows and macOS versions
- leaderboard and opportunity flows match web behavior
- exports open correctly
- notifications respect user settings
- no native permission is granted without a product need
- update packages are signed and verified
- deep links reject malformed or untrusted targets
- offline state is clear and does not show stale data as current

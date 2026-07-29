# Architecture direction

## Desktop shell

Use Tauri with a shared web UI package. Keep platform-specific capability adapters behind a narrow interface.

## Local core

The local core owns app inventory, capability detection, permission state, settings links, local notes, and privacy-safe diagnostics. It must never expose unrestricted operating-system APIs to web content.

## Cloud boundary

The first useful prototype can run without a cloud account. A later service may sync non-sensitive preferences, release metadata, and product analytics after explicit consent.

## Platform adapter contract

Each adapter reports:

- capability identifier
- support state
- evidence source or experiment
- required permission
- data read
- data changed
- settings target
- failure and recovery state

## Security constraints

- strict allowlist for native commands
- no arbitrary shell execution
- signed desktop updates
- OS-backed secure storage for tokens
- no notification content in telemetry
- local data encryption where the platform supports it
- versioned permission and privacy explanation

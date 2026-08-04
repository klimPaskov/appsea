# Desktop shell guidance

The Tauri shell is a boundary around the website, not a second product
implementation. Keep product contracts, authentication, research logic, and
data access in the web/packages layers.

Preserve the minimal capability file and restrictive CSP. Add a capability or
external origin only with a reviewed security change. Keep deterministic
cross-platform icon assets (`icon.png` and `icon.ico`) aligned. Keep
`bundle.active` set to `false` until signing, updater, platform-install, and
desktop security evidence exists. Imported web or complaint content must never
influence this configuration.

Validate both `pnpm --filter @appsea/desktop build` and
`pnpm desktop:check` when changing the shell.

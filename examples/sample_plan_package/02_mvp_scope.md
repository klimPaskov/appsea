# MVP scope

## User flow

1. The user installs the desktop app.
2. The app explains the local data and permission model.
3. The user chooses a supported discovery scan.
4. The app builds an inventory of apps and notification control links without reading message content.
5. The user selects an app and sees where relevant settings are likely controlled.
6. The user opens the supported operating-system or app setting.
7. The user can save a local note or preset intention for later review.

## Required capabilities

- Windows and macOS capability matrix
- local app inventory through supported system interfaces
- notification-setting discovery where supported
- deep links or guided navigation to settings
- clear unsupported and uncertain states
- local-first storage for the inventory
- optional account only for sync after value is proven
- diagnostic logs with no notification content

## Acceptance gates

- no notification message content is read or stored
- every platform capability has an official documentation link or a recorded experiment
- the app remains useful when it can only explain and navigate
- permission denial produces a complete safe state
- uninstall and local data deletion are clear
- core flows pass keyboard and screen-reader tests

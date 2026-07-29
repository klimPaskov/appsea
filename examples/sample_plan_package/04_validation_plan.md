# Validation plan

## Product validation

Run a permission and workflow prototype with 12 to 20 target users. Measure whether they can identify the control surface for a noisy app, whether the explanation changes broad muting behavior, and whether they would install a local helper with the stated permissions.

## Technical validation

Build small platform experiments before the main app. Record what can be detected, opened, changed, and verified on supported Windows and macOS versions.

## Privacy validation

Review every native command and telemetry event. Add automated assertions that notification titles, bodies, senders, and message identifiers never enter storage or logs.

## Failure criteria

Stop or narrow the product if supported APIs cannot provide a useful inventory, users reject the required permissions, or native settings already solve the problem after a recent platform change.

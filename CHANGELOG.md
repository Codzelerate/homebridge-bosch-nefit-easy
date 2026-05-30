# Changelog

All notable changes to `homebridge-bosch-nefit-easy` will be documented here.

## [2.1.3] - 2026-05-30

### Changed
- Repository moved to [Codzelerate/homebridge-bosch-nefit-easy](https://github.com/Codzelerate/homebridge-bosch-nefit-easy)

## [2.1.2] - 2026-05-30

### Fixed
- Removed `onSet` handler for `TargetHeatingCoolingState` entirely — matching the original `homebridge-nefit-easy` reference plugin exactly. With `validValues:[AUTO]` HomeKit should not send SET for other values; having an `onSet` that rejected or corrected them was causing the bounce-to-Off behaviour on every HomeKit state restore

## [2.1.1] - 2026-05-30

### Fixed
- `TargetHeatingCoolingState` SET now throws `READ_ONLY_CHARACTERISTIC` — the correct HAP response that tells HomeKit the mode cannot be changed, rather than accepting the SET and pushing back which caused the bounce-to-Off behaviour

## [2.1.0] - 2026-05-30

### Changed
- `TargetHeatingCoolingState` reverted to **Auto**, matching the behaviour of the original `homebridge-nefit-easy` reference plugin — the mode picker is greyed out (non-interactive) in the Home app and the temperature wheel remains always accessible
- `onSet` now corrects back to Auto synchronously (no `setTimeout`) so there is no flash or race condition
- Every poll pushes Auto to clear any stale cached state HomeKit may hold from earlier plugin versions

## [2.0.9] - 2026-05-30

### Fixed
- `TargetHeatingCoolingState` is now locked to **Heat** (not Auto) — `validValues:[AUTO]` did not hide Off/Heat/Cool from the iOS mode picker so the thermostat could still be set to Off, which disabled the temperature wheel entirely
- Mode is corrected back to Heat immediately (synchronously, no setTimeout) on any SET attempt, preventing the ping-pong flash seen in v2.0.8
- Every poll now pushes `Heat` to HomeKit so any stale cached `Off` state is corrected within one poll cycle rather than persisting until a restart

## [2.0.8] - 2026-05-30

### Fixed
- `TargetHeatingCoolingState` now immediately pushes **Auto** back to HomeKit when any SET is received — prevents HomeKit from latching onto a cached Off/Heat value and showing "Off" on the thermostat dial even after upgrading to v2.0.7

## [2.0.7] - 2026-05-30

### Changed
- `TargetHeatingCoolingState` is now locked to **Auto** — the Nefit Easy always manages heating automatically based on the setpoint; exposing Off/Heat as toggleable states was misleading because the thermostat has no true off command and the Home app label "Heat to 15°" when the room is already warm confused users

## [2.0.6] - 2026-05-30

### Fixed
- **Root cause of all PUT failures identified and fixed**: `bosch-xmpp` joins PUT request headers with `\n` by default; the Bosch device accepts `\n` for GET but requires strict `\r\n` line endings for PUT and returns HTTP 400 otherwise. Setting `LINE_SEPARATOR = '\r'` on the client causes `buildMessage` to encode them as `&#13;\n` in the XMPP XML stanza — which the backend decodes back to proper `\r\n`. This matches the behaviour of the original `nefit-easy-core` library that the device was designed around.

## [2.0.5] - 2026-05-30

### Fixed
- Temperature SET now sends all three required PUTs in parallel (`temperatureRoomManual`, `manualTempOverride/status=on`, `manualTempOverride/temperature`) — the override endpoints are what makes the change stick in both clock and manual mode; sending only `temperatureRoomManual` alone always returned HTTP 400
- Hot water switch now uses the correct endpoint path (`/dhwCircuits/dhwA/dhwOperationClockMode` or `dhwOperationManualMode` depending on current mode) — previous path `/dhwCircuits/dhw1/operationMode` does not exist on the device
- Manual mode switch now uses the correct endpoint `/heatingCircuits/hc1/usermode` — previous endpoint `operationMode` was wrong

## [2.0.4] - 2026-05-30

### Fixed
- Temperature SET now automatically switches the thermostat from schedule mode to manual mode before writing the setpoint — fixes HTTP 400 rejections on devices running in clock/schedule mode
- `UMD` (user mode) is now always tracked from uiStatus regardless of whether the Manual Mode feature flag is enabled, so the mode switch logic has accurate state on first use
- Each temperature PUT now also retries with a string-formatted value (`"17.0"`) if the numeric form is rejected, covering devices whose JSON parser requires a decimal point

## [2.0.3] - 2026-05-30

### Fixed
- Temperature SET now tries three endpoint paths in order (`temperatureRoomManual`, `manualTempOverride/setpoint`, `temperatureManual`) to handle different Nefit Easy firmware versions
- Each endpoint attempt is logged separately so failures can be diagnosed precisely
- GET probe and PUT are now in separate try/catch blocks — a failed probe no longer silently swallows the PUT error

## [2.0.2] - 2026-05-30

### Fixed
- Status line now only logs when temperature, setpoint, or burner state actually changes — eliminates repetitive log noise during stable conditions
- Removed internal `BAI` field from normal log output; it now appears only when debug logging is enabled

## [2.0.1] - 2026-05-30

### Added
- **Hot Water Switch** — toggle domestic hot water on/off from HomeKit
- **Manual / Schedule Mode Switch** — switch between manual temperature control and the thermostat's built-in weekly schedule
- **Holiday Mode Indicator** — read-only switch showing whether Holiday Mode is active
- **Home / Away Occupancy Sensor** — shows home/away status; useful for HomeKit automations
- **Outdoor Temperature Sensor** — displays outdoor temperature (requires outdoor sensor fitted to thermostat)
- **Hot Water Temperature Sensor** — displays the current hot water tank temperature
- All new features are **opt-in** — each enabled individually under **Optional Features** in the plugin settings

### Changed
- `TargetHeatingCoolingState` now shows **Off** when the room is at or above the setpoint, and **Heat** only when the room actually needs warming — fixes the misleading "Heat to 15°" label

## [1.0.8] - 2026-05-30

### Added
- **Hot Water Switch** — toggle domestic hot water on/off from HomeKit
- **Manual / Schedule Mode Switch** — switch between manual temperature control and the thermostat's built-in weekly schedule
- **Holiday Mode Indicator** — read-only switch showing whether Holiday Mode is active on the thermostat
- **Home / Away Occupancy Sensor** — shows whether the thermostat considers the home occupied or away; useful for automations
- **Outdoor Temperature Sensor** — displays outdoor temperature (requires an outdoor sensor connected to the thermostat)
- **Hot Water Temperature Sensor** — displays the current hot water tank temperature
- All new features are **opt-in** — each can be individually enabled in the plugin settings under **Optional Features**

## [1.0.7] - 2026-05-30

### Changed
- `TargetHeatingCoolingState` now reflects actual need: shows **Off** when the room is at or above the setpoint, and **Heat** only when the room needs warming. Fixes the misleading "Heat to 15°" display when the room is already warmer than the setpoint.

## [1.0.6] - 2026-05-30

### Fixed
- Added `repository`, `bugs`, and `homepage` fields to `package.json` so the Homebridge UI can retrieve the changelog and release notes from GitHub correctly
- Added `author` field (Codzelerate)

## [1.0.5] - 2026-05-30

### Changed
- Manufacturer now shows **Bosch** (clean, no slash) in the Home app
- Firmware version now reflects the installed plugin version (e.g. 1.0.5) instead of 0.0
- Model correctly shows **Nefit Easy**

## [1.0.0] - 2026-05-30

### Added
- Initial release as `homebridge-bosch-nefit-easy` (renamed from `homebridge-nefit-easy2`)
- Homebridge v2 accessory plugin for the Bosch Nefit Easy thermostat
- Uses `bosch-xmpp` library — Node.js 22+ compatible, replaces broken `nefit-easy-core`
- Persistent XMPP connection with automatic reconnect after 30 seconds on failure
- Polling interval configurable via UI (default 60 s)
- HomeKit Thermostat service: CurrentTemperature, TargetTemperature (5–30 °C, step 0.5), CurrentHeatingCoolingState, TargetHeatingCoolingState (Off / Heat)
- Debug logging flag in plugin settings for troubleshooting
- Child bridge support for process isolation
- Homebridge UI X compatible config schema with field descriptions

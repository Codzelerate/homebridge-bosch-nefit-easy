# homebridge-bosch-nefit-easy

[![npm version](https://img.shields.io/npm/v/homebridge-bosch-nefit-easy.svg)](https://www.npmjs.com/package/homebridge-bosch-nefit-easy)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-bosch-nefit-easy.svg)](https://www.npmjs.com/package/homebridge-bosch-nefit-easy)
[![Homebridge](https://img.shields.io/badge/Homebridge-v2.x-purple)](https://homebridge.io)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A **Homebridge v2** plugin that integrates the **Bosch Nefit Easy** thermostat with Apple HomeKit. Built on the [`bosch-xmpp`](https://github.com/robertklep/bosch-xmpp) library — fully compatible with Node.js 22 and 24.

> This plugin replaces the deprecated `homebridge-nefit-easy` package, which relied on `nefit-easy-core` and `node-xmpp-client` — both broken on Node.js 22+.

---

## Features

- Real-time temperature monitoring via HomeKit
- Set target temperature directly from the Home app or Siri
- Persistent XMPP connection — no per-poll reconnections
- Automatic reconnect on connection failure
- Configurable polling interval
- Runs as an isolated **child bridge** for maximum stability — configured automatically on install via the Homebridge UI
- Full [Homebridge UI X](https://github.com/homebridge/homebridge-config-ui-x) support — no manual JSON editing required
- Built-in debug logging toggle for troubleshooting
- Optional features: Hot Water switch, Manual/Schedule Mode switch, Holiday Mode indicator, Home/Away Occupancy Sensor, Outdoor Temperature Sensor, Hot Water Temperature Sensor

---

## Requirements

| Requirement | Version |
|---|---|
| [Homebridge](https://homebridge.io) | v2.0 or later |
| Node.js | 22 or 24 |
| Bosch Nefit Easy thermostat | Any generation |

---

## Installation

### Via Homebridge UI (Recommended)

1. Open the Homebridge UI in your browser
2. Go to the **Plugins** tab
3. Search for **homebridge-bosch-nefit-easy**
4. Click **Install**
5. When prompted, configure the child bridge and enter your credentials in the Settings form
6. Restart Homebridge and pair the new bridge in the Apple Home app

### Via Terminal

```bash
npm install -g homebridge-bosch-nefit-easy
```

---

## Finding Your Credentials

Your credentials are found inside the **Nefit Easy mobile app**:

1. Open the Nefit Easy app on your phone
2. Tap the **hamburger menu** (☰) in the top-left
3. Go to **Settings → About**

You will find:
- **Serial Number** — a numeric string (e.g. `123456789`)
- **Access Key** — an alphanumeric string displayed below the serial number

The **Password** is the one you chose when you first set up the Nefit Easy app during initial installation.

---

## Configuration

### Using the Homebridge UI

After installation, click **Settings** on the plugin to open the configuration form. Fill in your credentials and click Save.

### Manual JSON Configuration

Add the following to the `platforms` array in your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "BoschNefitEasy",
      "name": "Thermostat",
      "serialNumber": "YOUR_SERIAL_NUMBER",
      "accessKey": "YOUR_ACCESS_KEY",
      "password": "YOUR_PASSWORD",
      "pollingInterval": 60,
      "debug": false,
      "features": {
        "hotWater": false,
        "manualMode": false,
        "holidayMode": false,
        "awayMode": false,
        "outdoorTemperature": false,
        "hotWaterTemperature": false
      }
    }
  ]
}
```

---

## Configuration Parameters

### Required

#### `platform`
**Type:** `string` — **Must be** `"BoschNefitEasy"`

The Homebridge platform identifier. This value must match exactly.

---

#### `name`
**Type:** `string` — **Default:** `"Thermostat"`

The display name for the thermostat as it will appear in the Apple Home app and throughout HomeKit.

---

#### `serialNumber`
**Type:** `string`

The serial number of your Nefit Easy thermostat. Found in the Nefit Easy app under **Settings → About**.

---

#### `accessKey`
**Type:** `string`

The access key associated with your thermostat. Found in the Nefit Easy app under **Settings → About**.

---

#### `password`
**Type:** `string`

The password you chose when you first configured the Nefit Easy app. This is not your Bosch account password — it is a device-specific password set during the thermostat's initial app pairing.

---

### Optional

#### `pollingInterval`
**Type:** `integer` — **Default:** `60` — **Range:** `10–600`

How often (in seconds) the plugin polls the thermostat for updated temperature and status readings. The plugin maintains a persistent XMPP connection, so polling is lightweight.

| Value | Behaviour |
|---|---|
| `10` | Near real-time updates — suitable for active monitoring |
| `60` | Default — good balance of responsiveness and efficiency |
| `300` | Minimal traffic — suitable for passive monitoring |

---

#### `debug`
**Type:** `boolean` — **Default:** `false`

When enabled, the plugin writes detailed diagnostic information to the Homebridge log, including raw API responses, XMPP connection steps, every HomeKit characteristic read and write, and full error stack traces.

**Enable this only when troubleshooting.**

---

#### `features`
**Type:** `object`

Each feature adds a separate tile in the Apple Home app. All are disabled by default — enable only what you need.

| Feature | Type | Description |
|---|---|---|
| `hotWater` | boolean | Switch to turn domestic hot water on or off |
| `manualMode` | boolean | Switch to toggle between manual temperature control and the thermostat's built-in weekly schedule |
| `holidayMode` | boolean | Read-only switch showing whether Holiday Mode is active |
| `awayMode` | boolean | Occupancy Sensor showing whether the thermostat considers the home occupied or away |
| `outdoorTemperature` | boolean | Temperature Sensor showing outdoor temperature (requires outdoor sensor on thermostat) |
| `hotWaterTemperature` | boolean | Temperature Sensor showing hot water tank temperature |

---

## HomeKit Capabilities

The plugin exposes a **Thermostat** service with the following characteristics:

| Characteristic | Access | Range | Description |
|---|---|---|---|
| Current Temperature | Read | — | Live indoor temperature as reported by the thermostat sensor |
| Target Temperature | Read / Write | 5–30 °C, step 0.5 °C | The desired temperature setpoint |
| Current Heating State | Read | Off / Heat | Whether the boiler burner is currently active |
| Target Heating State | Read | Auto | Locked to Auto — the Nefit Easy manages heating automatically based on the setpoint |
| Temperature Display Units | Read | Celsius | Always reported in Celsius |

---

## Child Bridge

The plugin runs as an isolated **child bridge** by default when installed via the Homebridge UI. This isolates it in a separate process — if the XMPP connection hangs or the plugin crashes, it will not affect your main Homebridge instance or other accessories.

When installing via the UI, you will be prompted to configure the child bridge automatically. After restarting Homebridge, open the Apple Home app and pair the new bridge using the PIN shown in the Homebridge UI.

---

## Known Limitations

- **Cooling mode is not supported.** The Nefit Easy is a heating-only device.
- **Target Heating State is locked to Auto.** The temperature wheel in the Home app remains always accessible. The Nefit Easy does not support a hard-off command over the XMPP API.
- **Weekly schedules are not exposed.** The thermostat's built-in programs continue to run on the device itself. This plugin controls the manual setpoint only.
- **Multiple heating circuits are not supported.** The plugin always targets `hc1`. If your installation has multiple circuits, only the first will be controlled.
- **Credentials are stored in plain text** in `config.json`. Ensure your Homebridge host is on a trusted network.

---

## Migrating from homebridge-nefit-easy

1. Open the Homebridge UI → **Plugins** tab
2. Uninstall `homebridge-nefit-easy`
3. Install `homebridge-bosch-nefit-easy`
4. Click **Settings** and enter your credentials (same serial number, access key, and password)
5. Restart Homebridge and pair the new bridge in the Apple Home app

---

## Troubleshooting

### The plugin connects but shows NaN temperatures

Enable **Debug Logging** in the plugin settings and restart. Check the log for the `Raw uiStatus response` line and share the output in a [GitHub issue](https://github.com/Codzelerate/homebridge-bosch-nefit-easy/issues).

### Connection keeps failing with a timeout

- Verify your serial number, access key, and password are correct (copy-paste from the app to avoid typos)
- Check that your Homebridge host has outbound internet access to `wa2-mz36-qrmzh6.bosch.de` on port `5222`
- The Bosch backend occasionally has maintenance windows — try again after a few minutes

### The thermostat tile disappeared from HomeKit after updating

If you upgraded from v2.1.x (accessory plugin) to v2.2.x (platform plugin), HomeKit sees it as a brand new accessory. Remove the old thermostat tile in the Home app, then pair the new bridge using the PIN in the Homebridge UI.

### Plugin does not start after installation

Make sure your credentials are entered in the plugin Settings. The plugin will not connect until Serial Number, Access Key, and Password are all provided.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

---

## Built by Codzelerate

This plugin is developed and maintained by [**Codzelerate**](https://www.codzelerate.com?utm_source=github&utm_medium=plugin&utm_campaign=homebridge-bosch-nefit-easy) — a software development studio focused on smart home automation, IoT integrations, and Apple platform development.

For questions, bug reports, or feature requests, please [open an issue](https://github.com/Codzelerate/homebridge-bosch-nefit-easy/issues) on GitHub.

---

## License

MIT © [Codzelerate](https://www.codzelerate.com?utm_source=github&utm_medium=plugin&utm_campaign=homebridge-bosch-nefit-easy)

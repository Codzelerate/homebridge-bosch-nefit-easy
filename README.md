# @codzelerate/homebridge-bosch-nefit-easy

[![npm version](https://img.shields.io/npm/v/@codzelerate/homebridge-bosch-nefit-easy.svg)](https://www.npmjs.com/package/@codzelerate/homebridge-bosch-nefit-easy)
[![npm downloads](https://img.shields.io/npm/dt/@codzelerate/homebridge-bosch-nefit-easy.svg)](https://www.npmjs.com/package/@codzelerate/homebridge-bosch-nefit-easy)
[![Homebridge](https://img.shields.io/badge/Homebridge-v2.x-purple)](https://homebridge.io)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A **Homebridge v2** plugin that integrates the **Bosch Nefit Easy** thermostat with Apple HomeKit. Built on the [`bosch-xmpp`](https://github.com/robertklep/bosch-xmpp) library — fully compatible with Node.js 22 and 24.

> This plugin replaces the deprecated `homebridge-nefit-easy` package, which relied on `nefit-easy-core` and `node-xmpp-client` — both broken on Node.js 22+.

---

## Features

- Real-time temperature monitoring via HomeKit
- Set target temperature directly from the Home app or Siri
- Heating on/off control
- Persistent XMPP connection — no per-poll reconnections
- Automatic reconnect on connection failure
- Configurable polling interval
- Runs as an isolated **child bridge** for maximum stability
- Full [Homebridge UI X](https://github.com/homebridge/homebridge-config-ui-x) support — no manual JSON editing required
- Built-in debug logging toggle for troubleshooting

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
3. Search for **@codzelerate/homebridge-bosch-nefit-easy**
4. Click **Install**

### Via Terminal

```bash
npm install -g @codzelerate/homebridge-bosch-nefit-easy
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

Add the following to the `accessories` array in your Homebridge `config.json`:

```json
{
  "accessories": [
    {
      "accessory": "BoschNefitEasy",
      "name": "Thermostat",
      "serialNumber": "YOUR_SERIAL_NUMBER",
      "accessKey": "YOUR_ACCESS_KEY",
      "password": "YOUR_PASSWORD",
      "pollingInterval": 60,
      "debug": false
    }
  ]
}
```

---

## Configuration Parameters

### Required

#### `accessory`
**Type:** `string` — **Must be** `"BoschNefitEasy"`

The Homebridge accessory identifier. This value must match exactly — it tells Homebridge which plugin to use for this accessory entry.

---

#### `name`
**Type:** `string` — **Default:** `"Thermostat"`

The display name for the thermostat as it will appear in the Apple Home app and throughout HomeKit. Choose something meaningful if you have multiple thermostats (e.g. `"Ground Floor Thermostat"`).

---

#### `serialNumber`
**Type:** `string`

The serial number of your Nefit Easy thermostat. This is used to identify your device on the Bosch XMPP backend. Found in the Nefit Easy app under **Settings → About**.

---

#### `accessKey`
**Type:** `string`

The access key associated with your thermostat. Together with the serial number and password, this forms the three-part credential set required to authenticate with the Bosch backend. Found in the Nefit Easy app under **Settings → About**.

---

#### `password`
**Type:** `string`

The password you chose when you first configured the Nefit Easy app. This is not the password to your Bosch account — it is a device-specific password set during the thermostat's initial app pairing.

---

### Optional

#### `pollingInterval`
**Type:** `integer` — **Default:** `60` — **Range:** `10–600`

How often (in seconds) the plugin polls the thermostat for updated temperature and status readings. The plugin maintains a persistent XMPP connection, so polling is lightweight. Lower values give more responsive HomeKit updates; higher values reduce network traffic.

| Value | Behaviour |
|---|---|
| `10` | Near real-time updates — suitable for active monitoring |
| `60` | Default — good balance of responsiveness and efficiency |
| `300` | Minimal traffic — suitable for passive monitoring |

---

#### `debug`
**Type:** `boolean` — **Default:** `false`

When enabled, the plugin writes detailed diagnostic information to the Homebridge log, including:

- Raw API response payloads from the thermostat
- XMPP connection steps and timing
- Every HomeKit characteristic read and write
- Full error stack traces on failure

**Enable this only when troubleshooting.** Debug output is verbose and will fill your logs quickly during normal operation.

---

## HomeKit Capabilities

The plugin exposes a single **Thermostat** service with the following characteristics:

| Characteristic | Access | Range | Description |
|---|---|---|---|
| Current Temperature | Read | — | Live indoor temperature as reported by the thermostat sensor |
| Target Temperature | Read / Write | 5–30 °C, step 0.5 °C | The desired temperature setpoint |
| Current Heating State | Read | Off / Heat | Whether the boiler burner is currently active |
| Target Heating State | Read / Write | Off / Heat | Set to Off to drop setpoint to minimum; set to Heat to resume |
| Temperature Display Units | Read | Celsius | Always reported in Celsius |

---

## Child Bridge (Recommended)

Running the plugin as a **child bridge** isolates it in a separate process. If the XMPP connection hangs or the plugin crashes, it will not affect your main Homebridge instance or other accessories.

To enable via the Homebridge UI:

1. Go to **Plugins** → find **Homebridge Bosch Nefit Easy** → click the **⋮ menu**
2. Select **Bridge Settings**
3. Toggle **Use Child Bridge** on
4. Save and restart Homebridge
5. Open the Apple Home app and pair the new bridge using your Homebridge PIN

---

## Known Limitations

- **Cooling and Auto modes are not supported.** The Nefit Easy is a heating-only device. Only Off and Heat states are exposed in HomeKit.
- **Turning Off via HomeKit** drops the target temperature to 5 °C (the minimum) rather than fully disabling the thermostat. The Nefit Easy does not support a hard-off command over the XMPP API.
- **Weekly schedules are not exposed.** The thermostat's built-in programs continue to run on the device itself. This plugin controls the manual setpoint only.
- **Multiple heating circuits are not supported.** The plugin always targets `hc1`. If your installation has multiple circuits, only the first will be controlled.
- **Credentials are stored in plain text** in `config.json`. Ensure your Homebridge host is on a trusted network and access is appropriately restricted.

---

## Migrating from homebridge-nefit-easy

1. Open the Homebridge UI → **Plugins** tab
2. Uninstall `homebridge-nefit-easy`
3. Install `@codzelerate/homebridge-bosch-nefit-easy`
4. Re-enter your credentials in the plugin settings (same serial number, access key, and password)
5. Restart Homebridge

---

## Troubleshooting

### The plugin connects but shows NaN temperatures

Enable **Debug Logging** in the plugin settings and restart. Check the log for the `Raw uiStatus response` line and share the output.

### Connection keeps failing with a timeout

- Verify your serial number, access key, and password are correct (copy-paste from the app to avoid typos)
- Check that your Homebridge host has outbound internet access to `wa2-mz36-qrmzh6.bosch.de` on port `5222`
- The Bosch backend occasionally has maintenance windows — try again after a few minutes

### The accessory disappeared from HomeKit after updating

If you switched from `homebridge-nefit-easy` (old plugin), HomeKit sees it as a brand new accessory. Remove the old thermostat tile in the Home app and pair the new one.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

---

## Built by Codzelerate

This plugin is developed and maintained by [**Codzelerate**](https://www.codzelerate.com?utm_source=github&utm_medium=plugin&utm_campaign=@codzelerate/homebridge-bosch-nefit-easy) — a software development studio focused on smart home automation, IoT integrations, and Apple platform development.

For questions, bug reports, or feature requests, please [open an issue](https://github.com/Codzelerate/@codzelerate/homebridge-bosch-nefit-easy/issues) on GitHub.

---

## License

MIT © [Codzelerate](https://www.codzelerate.com?utm_source=github&utm_medium=plugin&utm_campaign=@codzelerate/homebridge-bosch-nefit-easy)

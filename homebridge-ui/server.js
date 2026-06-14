'use strict';

// Homebridge Custom Plugin UI backend.
// Runs inside the homebridge-config-ui-x process and exposes request handlers
// that the settings page (public/index.html) calls via homebridge.request().
//
// The heavy lifting — talking to the Bosch backend over XMPP — happens here so
// the browser only ever deals with already-parsed, typed status data.

const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');
const { NefitEasyClient } = require('bosch-xmpp');

// Reuse the exact same parsing the plugin itself uses, so the dashboard can
// never disagree with what HomeKit will show.
const { parseUiStatus, parseScalarTemperature } = require('../dist/status');

class NefitUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/test-connection', (payload) => this.testConnection(payload));

    // Tell the UI framework we are ready to accept requests.
    this.ready();
  }

  /**
   * Connect to the Bosch backend with the supplied credentials, read the live
   * status, and return it parsed. Optional sensor reads are best-effort.
   */
  async testConnection(payload = {}) {
    const { serialNumber, accessKey, password, features = {} } = payload;

    if (!serialNumber || !accessKey || !password) {
      throw new RequestError('Serial Number, Access Key and Password are all required.', { status: 400 });
    }

    let client;
    try {
      client = NefitEasyClient({ serialNumber, accessKey, password });
      // Match the plugin's PUT line-ending workaround (harmless for reads).
      client.LINE_SEPARATOR = '\r';

      await client.connect();

      const raw = await client.get('/ecus/rrc/uiStatus');
      const status = parseUiStatus(raw.value);

      const result = {
        connected: true,
        status,
        sensors: {},
      };

      if (features.outdoorTemperature) {
        result.sensors.outdoorTemperature = await this.readScalar(client, '/system/sensors/temperatures/outdoor_t1');
      }
      if (features.hotWaterTemperature) {
        result.sensors.hotWaterTemperature = await this.readScalar(client, '/dhwCircuits/dhw1/actualTemp');
      }

      return result;
    } catch (err) {
      // Surface a clean, actionable message to the UI.
      const message = (err && err.message) ? err.message : 'Unable to reach the Nefit Easy backend.';
      throw new RequestError(message, { status: 502 });
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          /* ignore close errors */
        }
      }
    }
  }

  /** Best-effort scalar read: returns the number, or null if unavailable. */
  async readScalar(client, uri) {
    try {
      const res = await client.get(uri);
      return parseScalarTemperature(res);
    } catch {
      return null;
    }
  }
}

// Instantiate — the framework keeps the process alive.
(() => new NefitUiServer())();

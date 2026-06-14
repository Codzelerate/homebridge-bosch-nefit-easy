import type {
  API,
  CharacteristicValue,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import {
  parseScalarTemperature,
  parseUiStatus,
  type ScalarResponse,
  type UiStatus,
} from './status';

// bosch-xmpp exports named factory functions, not a createClient helper.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NefitEasyClient } = require('bosch-xmpp');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PLUGIN_VERSION: string = require('../package.json').version;

// ─── Config ──────────────────────────────────────────────────────────────────

interface NefitFeatures {
  hotWater?: boolean;
  manualMode?: boolean;
  holidayMode?: boolean;
  awayMode?: boolean;
  outdoorTemperature?: boolean;
  hotWaterTemperature?: boolean;
}

interface NefitConfig extends PlatformConfig {
  serialNumber: string;
  accessKey: string;
  password: string;
  pollingInterval?: number;
  debug?: boolean;
  features?: NefitFeatures;
}

// ─── Backend client ───────────────────────────────────────────────────────────

// Minimal structural type for the bosch-xmpp client, which ships without types.
interface NefitClient {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
  get(uri: string): Promise<unknown>;
  put(uri: string, data: unknown): Promise<unknown>;
  LINE_SEPARATOR: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_TEMP        = 5;
const MAX_TEMP        = 30;
const TEMP_STEP       = 0.5;
const RECONNECT_DELAY = 30_000;

// ─── Accessory ────────────────────────────────────────────────────────────────

export class NefitEasyAccessory {
  private readonly log: Logging;
  private readonly config: NefitConfig;
  private readonly api: API;
  private readonly feat: NefitFeatures;
  private readonly debugEnabled: boolean;

  // Services
  private readonly thermostatService: Service;
  private hotWaterService?: Service;
  private manualModeService?: Service;
  private holidayModeService?: Service;
  private awayModeService?: Service;
  private outdoorTempService?: Service;
  private hotWaterTempService?: Service;

  // Connection state
  private client: NefitClient | null = null;
  private connected = false;
  private reconnecting = false;
  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Cached values
  private currentTemperature  = 20;
  private targetTemperature   = 20;
  private currentHeatingState = 0;
  private hotWaterActive      = false;
  private manualModeActive    = false;
  private holidayModeActive   = false;
  private awayModeActive      = false;
  private outdoorTemperature  = 0;
  private hotWaterTemperature = 0;

  constructor(
    log: Logging,
    config: PlatformConfig,
    api: API,
    private readonly platformAccessory: PlatformAccessory,
  ) {
    this.log          = log;
    this.config       = config as NefitConfig;
    this.api          = api;
    this.feat         = this.config.features ?? {};
    this.debugEnabled = this.config.debug === true;

    this.dbg('Debug logging enabled');

    const { Service, Characteristic } = this.api.hap;

    this.log.info('Initializing BoschNefitEasy accessory...');

    // ── Accessory Information ─────────────────────────────────────────────────
    const infoService = this.platformAccessory.getService(Service.AccessoryInformation)!;
    infoService
      .setCharacteristic(Characteristic.Manufacturer,     'Bosch')
      .setCharacteristic(Characteristic.Model,            'Nefit Easy')
      .setCharacteristic(Characteristic.SerialNumber,     this.config.serialNumber ?? 'Unknown')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    // ── Thermostat (always on) ────────────────────────────────────────────────
    this.thermostatService =
      this.platformAccessory.getService(Service.Thermostat) ||
      this.platformAccessory.addService(Service.Thermostat, this.config.name ?? 'Thermostat');

    this.thermostatService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => {
        this.dbg(`GET CurrentTemperature => ${this.currentTemperature}`);
        return this.currentTemperature;
      });

    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: MIN_TEMP, maxValue: MAX_TEMP, minStep: TEMP_STEP })
      .onGet(() => {
        this.dbg(`GET TargetTemperature => ${this.targetTemperature}`);
        return this.targetTemperature;
      })
      .onSet((value) => this.handleSetTargetTemperature(value));

    this.thermostatService
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(() => {
        this.dbg(`GET CurrentHeatingCoolingState => ${this.currentHeatingState}`);
        return this.currentHeatingState;
      });

    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [Characteristic.TargetHeatingCoolingState.AUTO] })
      .onGet(() => Characteristic.TargetHeatingCoolingState.AUTO);

    this.thermostatService
      .getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .onGet(() => Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet(() => { /* read-only */ });

    // ── Hot Water Switch ──────────────────────────────────────────────────────
    if (this.feat.hotWater) {
      this.hotWaterService =
        this.platformAccessory.getService(Service.Switch) ||
        this.platformAccessory.addService(Service.Switch, 'Hot Water', 'hot-water');
      this.hotWaterService
        .getCharacteristic(Characteristic.On)
        .onGet(() => {
          this.dbg(`GET HotWater => ${this.hotWaterActive}`);
          return this.hotWaterActive;
        })
        .onSet((value) => this.handleSetHotWater(value));
      this.log.info('Feature enabled: Hot Water switch');
    }

    // ── Manual Mode Switch ────────────────────────────────────────────────────
    if (this.feat.manualMode) {
      this.manualModeService =
        this.platformAccessory.getServiceById(Service.Switch, 'manual-mode') ||
        this.platformAccessory.addService(Service.Switch, 'Manual Mode', 'manual-mode');
      this.manualModeService
        .getCharacteristic(Characteristic.On)
        .onGet(() => {
          this.dbg(`GET ManualMode => ${this.manualModeActive}`);
          return this.manualModeActive;
        })
        .onSet((value) => this.handleSetManualMode(value));
      this.log.info('Feature enabled: Manual Mode switch');
    }

    // ── Holiday Mode Switch (read-only) ───────────────────────────────────────
    if (this.feat.holidayMode) {
      this.holidayModeService =
        this.platformAccessory.getServiceById(Service.Switch, 'holiday-mode') ||
        this.platformAccessory.addService(Service.Switch, 'Holiday Mode', 'holiday-mode');
      this.holidayModeService
        .getCharacteristic(Characteristic.On)
        .onGet(() => {
          this.dbg(`GET HolidayMode => ${this.holidayModeActive}`);
          return this.holidayModeActive;
        })
        .onSet((_value) => {
          this.log.warn('Holiday Mode cannot be toggled from HomeKit — set it on the thermostat directly.');
          setTimeout(() => {
            this.holidayModeService!
              .getCharacteristic(Characteristic.On)
              .updateValue(this.holidayModeActive);
          }, 500);
        });
      this.log.info('Feature enabled: Holiday Mode indicator (read-only)');
    }

    // ── Away Mode Occupancy Sensor ────────────────────────────────────────────
    if (this.feat.awayMode) {
      this.awayModeService =
        this.platformAccessory.getService(Service.OccupancySensor) ||
        this.platformAccessory.addService(Service.OccupancySensor, 'Home / Away', 'away-mode');
      this.awayModeService
        .getCharacteristic(Characteristic.OccupancyDetected)
        .onGet(() => {
          const occupied = !this.awayModeActive;
          this.dbg(`GET OccupancyDetected => ${occupied} (awayMode=${this.awayModeActive})`);
          return occupied
            ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
        });
      this.log.info('Feature enabled: Away Mode occupancy sensor');
    }

    // ── Outdoor Temperature Sensor ────────────────────────────────────────────
    if (this.feat.outdoorTemperature) {
      this.outdoorTempService =
        this.platformAccessory.getServiceById(Service.TemperatureSensor, 'outdoor-temp') ||
        this.platformAccessory.addService(Service.TemperatureSensor, 'Outdoor Temperature', 'outdoor-temp');
      this.outdoorTempService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -40, maxValue: 60 })
        .onGet(() => {
          this.dbg(`GET OutdoorTemperature => ${this.outdoorTemperature}`);
          return this.outdoorTemperature;
        });
      this.log.info('Feature enabled: Outdoor Temperature sensor');
    }

    // ── Hot Water Temperature Sensor ──────────────────────────────────────────
    if (this.feat.hotWaterTemperature) {
      this.hotWaterTempService =
        this.platformAccessory.getServiceById(Service.TemperatureSensor, 'hw-temp') ||
        this.platformAccessory.addService(Service.TemperatureSensor, 'Hot Water Temperature', 'hw-temp');
      this.hotWaterTempService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: 0, maxValue: 100 })
        .onGet(() => {
          this.dbg(`GET HotWaterTemperature => ${this.hotWaterTemperature}`);
          return this.hotWaterTemperature;
        });
      this.log.info('Feature enabled: Hot Water Temperature sensor');
    }

    this.connect();
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  private createClient(): NefitClient {
    this.dbg('Creating NefitEasyClient instance via factory function');
    const c = NefitEasyClient({
      serialNumber: this.config.serialNumber,
      accessKey:    this.config.accessKey,
      password:     this.config.password,
    }) as NefitClient;
    // bosch-xmpp joins PUT body lines with this.LINE_SEPARATOR (defaults to '\n').
    // NefitEasyClient.buildMessage encodes \r as &#13;\n in the XMPP XML stanza,
    // which the Bosch backend decodes back to \r\n — proper HTTP/1.1 line endings.
    // Without this, PUT bodies use bare \n and the device returns HTTP 400.
    c.LINE_SEPARATOR = '\r';
    return c;
  }

  // Close and discard the current client so its XMPP socket is not leaked when
  // we reconnect. connect() always creates a fresh client, so the old one is
  // never reused after this point.
  private async teardownClient(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.connected = false;
    if (c) {
      try {
        await c.end();
      } catch (err) {
        this.dbg(`Error while closing client: ${(err as Error).message}`);
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.reconnecting || this.disposed) {
      this.dbg('connect() skipped — already reconnecting or disposed');
      return;
    }
    try {
      this.log.info('Connecting to Nefit Easy backend…');
      this.dbg(`XMPP host: wa2-mz36-qrmzh6.bosch.de:5222, serial: ${this.config.serialNumber}`);
      this.client = this.createClient();
      this.dbg('Client created, calling client.connect()…');
      await this.client.connect();
      this.connected = true;
      this.reconnecting = false;
      this.log.info('Connected to Nefit Easy backend.');
      await this.poll();
      this.startPolling();
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.log.error(`Connection failed: ${msg}. Retrying in ${RECONNECT_DELAY / 1000} s…`);
      this.dbg(`Full error: ${(err as Error).stack ?? msg}`);
      await this.teardownClient();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || this.disposed) { return; }
    this.reconnecting = true;
    this.stopPolling();
    this.dbg(`Scheduling reconnect in ${RECONNECT_DELAY / 1000} s…`);
    setTimeout(() => {
      this.reconnecting = false;
      this.connect();
    }, RECONNECT_DELAY);
  }

  // Called by the platform on Homebridge shutdown — stop polling and close the
  // backend connection cleanly so no timers or sockets are left running.
  public dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.dbg('Disposing accessory — stopping polling and closing connection');
    this.stopPolling();
    void this.teardownClient();
  }

  private startPolling(): void {
    this.stopPolling();
    const interval = (this.config.pollingInterval ?? 60) * 1000;
    this.dbg(`Starting poll timer every ${interval / 1000} s`);
    this.pollTimer = setInterval(() => this.poll(), interval);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ─── Polling ─────────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.connected || !this.client) {
      this.dbg('poll() skipped — not connected');
      return;
    }
    try {
      this.dbg('Polling /ecus/rrc/uiStatus…');
      const status = await this.client.get('/ecus/rrc/uiStatus') as UiStatus;
      this.dbg(`Raw uiStatus: ${JSON.stringify(status)}`);
      this.applyUiStatus(status);

      // Optional sensors are independent; poll them concurrently. Each call
      // swallows its own errors so a missing sensor never trips a reconnect.
      const extras: Promise<void>[] = [];
      if (this.feat.outdoorTemperature) {
        extras.push(this.pollOutdoorTemperature());
      }
      if (this.feat.hotWaterTemperature) {
        extras.push(this.pollHotWaterTemperature());
      }
      await Promise.all(extras);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.log.warn(`Poll failed: ${msg}. Will retry after reconnect.`);
      this.dbg(`Poll error: ${(err as Error).stack ?? msg}`);
      await this.teardownClient();
      this.scheduleReconnect();
    }
  }

  private async pollOutdoorTemperature(): Promise<void> {
    try {
      this.dbg('Polling /system/sensors/temperatures/outdoor_t1…');
      const res = await this.client!.get('/system/sensors/temperatures/outdoor_t1') as ScalarResponse;
      const temp = parseScalarTemperature(res);
      if (temp !== null) {
        this.outdoorTemperature = temp;
        this.outdoorTempService!
          .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
          .updateValue(temp);
        this.dbg(`Outdoor temperature: ${temp}°C`);
      }
    } catch (err) {
      this.log.warn(`Outdoor temperature poll failed: ${(err as Error).message}`);
    }
  }

  private async pollHotWaterTemperature(): Promise<void> {
    try {
      this.dbg('Polling /dhwCircuits/dhw1/actualTemp…');
      const res = await this.client!.get('/dhwCircuits/dhw1/actualTemp') as ScalarResponse;
      const temp = parseScalarTemperature(res);
      if (temp !== null) {
        this.hotWaterTemperature = temp;
        this.hotWaterTempService!
          .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
          .updateValue(temp);
        this.dbg(`Hot water temperature: ${temp}°C`);
      }
    } catch (err) {
      this.log.warn(`Hot water temperature poll failed: ${(err as Error).message}`);
    }
  }

  // ─── Status application ───────────────────────────────────────────────────────

  private applyUiStatus(status: UiStatus): void {
    const { Characteristic } = this.api.hap;
    const s = parseUiStatus(status.value);

    this.dbg(`Parsed — IHT:${s.currentTemperature} TSP:${s.targetTemperature} BAI:${status.value.BAI} ` +
      `burner:${s.burnerOn} DHW:${s.hotWaterOn} manual:${s.manualMode} holiday:${s.holidayMode} away:${s.awayMode}`);

    // Capture previous values BEFORE mutating cached state, so the change
    // detection below reflects what actually changed since the last poll.
    // (Current temperature drifts constantly, so it is intentionally excluded
    // from the info-level status line to avoid flooding the log.)
    const prevSetpoint    = this.targetTemperature;
    const prevBurnerOn    = this.currentHeatingState === Characteristic.CurrentHeatingCoolingState.HEAT;

    // ── Core temperatures ────────────────────────────────────────────────────
    if (s.currentTemperature !== null) {
      if (s.currentTemperature !== this.currentTemperature) {
        this.currentTemperature = s.currentTemperature;
        this.thermostatService
          .getCharacteristic(Characteristic.CurrentTemperature)
          .updateValue(s.currentTemperature);
      }
    } else {
      this.log.warn(`Unexpected IHT value: ${status.value.IHT}`);
    }

    if (s.targetTemperature !== null) {
      if (s.targetTemperature !== this.targetTemperature) {
        this.targetTemperature = s.targetTemperature;
        this.thermostatService
          .getCharacteristic(Characteristic.TargetTemperature)
          .updateValue(s.targetTemperature);
      }
    } else {
      this.log.warn(`Unexpected TSP value: ${status.value.TSP}`);
    }

    // CurrentHeatingCoolingState — reflects actual burner activity
    const newCurrentState = s.burnerOn
      ? Characteristic.CurrentHeatingCoolingState.HEAT
      : Characteristic.CurrentHeatingCoolingState.OFF;

    if (newCurrentState !== this.currentHeatingState) {
      this.currentHeatingState = newCurrentState;
      this.thermostatService
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .updateValue(newCurrentState);
    }

    // Always push AUTO so any cached Off/Heat state in HomeKit gets corrected each poll.
    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .updateValue(Characteristic.TargetHeatingCoolingState.AUTO);

    // Log an info status line only when the setpoint or burner state changes —
    // the events a user actually acts on. Current temperature still updates
    // HomeKit every poll and is recorded in the debug log above.
    const burnerOnNow = this.currentHeatingState === Characteristic.CurrentHeatingCoolingState.HEAT;
    const statusChanged =
      this.targetTemperature !== prevSetpoint ||
      burnerOnNow            !== prevBurnerOn;

    if (statusChanged) {
      this.log.info(`Status — current: ${this.currentTemperature}°C, ` +
        `setpoint: ${this.targetTemperature}°C, burner: ${burnerOnNow ? 'on' : 'off'}`);
    }

    // ── Hot Water ─────────────────────────────────────────────────────────────
    if (this.feat.hotWater && this.hotWaterService) {
      if (s.hotWaterOn !== this.hotWaterActive) {
        this.hotWaterActive = s.hotWaterOn;
        this.hotWaterService
          .getCharacteristic(Characteristic.On)
          .updateValue(s.hotWaterOn);
        this.dbg(`Hot water state updated: ${s.hotWaterOn}`);
      }
    }

    // ── Manual Mode ───────────────────────────────────────────────────────────
    // Always track UMD so handleSetTargetTemperature knows the current mode.
    this.manualModeActive = s.manualMode;
    if (this.feat.manualMode && this.manualModeService) {
      this.manualModeService
        .getCharacteristic(Characteristic.On)
        .updateValue(s.manualMode);
      this.dbg(`Manual mode updated: ${s.manualMode}`);
    }

    // ── Holiday Mode ──────────────────────────────────────────────────────────
    if (this.feat.holidayMode && this.holidayModeService) {
      if (s.holidayMode !== this.holidayModeActive) {
        this.holidayModeActive = s.holidayMode;
        this.holidayModeService
          .getCharacteristic(Characteristic.On)
          .updateValue(s.holidayMode);
        this.dbg(`Holiday mode updated: ${s.holidayMode}`);
      }
    }

    // ── Away Mode ─────────────────────────────────────────────────────────────
    if (this.feat.awayMode && this.awayModeService) {
      if (s.awayMode !== this.awayModeActive) {
        this.awayModeActive = s.awayMode;
        const occupied = s.awayMode
          ? Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
          : Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
        this.awayModeService
          .getCharacteristic(Characteristic.OccupancyDetected)
          .updateValue(occupied);
        this.dbg(`Away mode updated: ${s.awayMode} => occupancy: ${occupied}`);
      }
    }
  }

  // ─── Handlers ────────────────────────────────────────────────────────────────

  private async handleSetTargetTemperature(value: CharacteristicValue): Promise<void> {
    const temp = value as number;
    this.log.info(`Setting target temperature to ${temp}°C`);
    if (!this.connected || !this.client) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    const data = { value: temp };
    this.dbg(`PUT temperatureRoomManual + manualTempOverride/status + manualTempOverride/temperature ${JSON.stringify(data)}`);
    try {
      await Promise.all([
        this.client.put('/heatingCircuits/hc1/temperatureRoomManual',          data),
        this.client.put('/heatingCircuits/hc1/manualTempOverride/status',      { value: 'on' }),
        this.client.put('/heatingCircuits/hc1/manualTempOverride/temperature', data),
      ]);
      this.targetTemperature = temp;
      this.log.info(`Target temperature set to ${temp}°C`);
    } catch (err) {
      const e = err as Error & { response?: { statusCode?: number } };
      this.log.error(`Failed to set temperature: ${e.message} (HTTP ${e.response?.statusCode ?? 'unknown'})`);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async handleSetHotWater(value: CharacteristicValue): Promise<void> {
    const on = value as boolean;
    this.log.info(`Setting hot water: ${on ? 'on' : 'off'}`);
    if (!this.connected || !this.client) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    // Endpoint depends on current user mode (clock vs manual).
    const endpoint = this.manualModeActive
      ? '/dhwCircuits/dhwA/dhwOperationManualMode'
      : '/dhwCircuits/dhwA/dhwOperationClockMode';
    this.dbg(`PUT ${endpoint} {"value":"${on ? 'on' : 'off'}"}`);
    try {
      await this.client.put(endpoint, { value: on ? 'on' : 'off' });
      this.hotWaterActive = on;
      this.log.info(`Hot water set to ${on ? 'on' : 'off'}`);
    } catch (err) {
      const e = err as Error & { response?: { statusCode?: number } };
      this.log.error(`Failed to set hot water: ${e.message} (HTTP ${e.response?.statusCode ?? 'unknown'})`);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async handleSetManualMode(value: CharacteristicValue): Promise<void> {
    const manual = value as boolean;
    const mode = manual ? 'manual' : 'clock';
    this.log.info(`Setting heating mode to: ${mode}`);
    if (!this.connected || !this.client) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.dbg(`PUT /heatingCircuits/hc1/usermode {"value":"${mode}"}`);
    try {
      await this.client.put('/heatingCircuits/hc1/usermode', { value: mode });
      this.manualModeActive = manual;
      this.log.info(`Heating mode set to ${mode}`);
    } catch (err) {
      const e = err as Error & { response?: { statusCode?: number } };
      this.log.error(`Failed to set heating mode: ${e.message} (HTTP ${e.response?.statusCode ?? 'unknown'})`);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private dbg(msg: string): void {
    if (this.debugEnabled) {
      this.log.info(`[DEBUG] ${msg}`);
    }
  }
}

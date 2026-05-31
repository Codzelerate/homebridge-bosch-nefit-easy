"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NefitEasyAccessory = void 0;
// bosch-xmpp exports named factory functions, not a createClient helper.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NefitEasyClient } = require('bosch-xmpp');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PLUGIN_VERSION = require('../package.json').version;
// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_TEMP = 5;
const MAX_TEMP = 30;
const TEMP_STEP = 0.5;
const RECONNECT_DELAY = 30_000;
// ─── Accessory ────────────────────────────────────────────────────────────────
class NefitEasyAccessory {
    platformAccessory;
    log;
    config;
    api;
    feat;
    debugEnabled;
    // Services
    thermostatService;
    hotWaterService;
    manualModeService;
    holidayModeService;
    awayModeService;
    outdoorTempService;
    hotWaterTempService;
    // Connection state
    client = null;
    connected = false;
    reconnecting = false;
    pollTimer = null;
    // Cached values
    currentTemperature = 20;
    targetTemperature = 20;
    currentHeatingState = 0;
    hotWaterActive = false;
    manualModeActive = false;
    holidayModeActive = false;
    awayModeActive = false;
    outdoorTemperature = 0;
    hotWaterTemperature = 0;
    constructor(log, config, api, platformAccessory) {
        this.platformAccessory = platformAccessory;
        this.log = log;
        this.config = config;
        this.api = api;
        this.feat = this.config.features ?? {};
        this.debugEnabled = this.config.debug === true;
        this.dbg('Debug logging enabled');
        const { Service, Characteristic } = this.api.hap;
        this.log.info('Initializing BoschNefitEasy accessory...');
        // ── Accessory Information ─────────────────────────────────────────────────
        const infoService = this.platformAccessory.getService(Service.AccessoryInformation);
        infoService
            .setCharacteristic(Characteristic.Manufacturer, 'Bosch')
            .setCharacteristic(Characteristic.Model, 'Nefit Easy')
            .setCharacteristic(Characteristic.SerialNumber, this.config.serialNumber ?? 'Unknown')
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
            .onSet(() => { });
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
                    this.holidayModeService
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
    createClient() {
        this.dbg('Creating NefitEasyClient instance via factory function');
        const c = NefitEasyClient({
            serialNumber: this.config.serialNumber,
            accessKey: this.config.accessKey,
            password: this.config.password,
        });
        // bosch-xmpp joins PUT body lines with this.LINE_SEPARATOR (defaults to '\n').
        // NefitEasyClient.buildMessage encodes \r as &#13;\n in the XMPP XML stanza,
        // which the Bosch backend decodes back to \r\n — proper HTTP/1.1 line endings.
        // Without this, PUT bodies use bare \n and the device returns HTTP 400.
        c.LINE_SEPARATOR = '\r';
        return c;
    }
    async connect() {
        if (this.reconnecting) {
            this.dbg('connect() called while already reconnecting — skipping');
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
        }
        catch (err) {
            const msg = err.message ?? String(err);
            this.log.error(`Connection failed: ${msg}. Retrying in 30 s…`);
            this.dbg(`Full error: ${err.stack ?? msg}`);
            this.connected = false;
            this.client = null;
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        if (this.reconnecting) {
            return;
        }
        this.reconnecting = true;
        this.stopPolling();
        this.dbg(`Scheduling reconnect in ${RECONNECT_DELAY / 1000} s…`);
        setTimeout(() => {
            this.reconnecting = false;
            this.connect();
        }, RECONNECT_DELAY);
    }
    startPolling() {
        this.stopPolling();
        const interval = (this.config.pollingInterval ?? 60) * 1000;
        this.dbg(`Starting poll timer every ${interval / 1000} s`);
        this.pollTimer = setInterval(() => this.poll(), interval);
    }
    stopPolling() {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    // ─── Polling ─────────────────────────────────────────────────────────────────
    async poll() {
        if (!this.connected || !this.client) {
            this.dbg('poll() skipped — not connected');
            return;
        }
        try {
            this.dbg('Polling /ecus/rrc/uiStatus…');
            const status = await this.client.get('/ecus/rrc/uiStatus');
            this.dbg(`Raw uiStatus: ${JSON.stringify(status)}`);
            this.applyUiStatus(status);
            if (this.feat.outdoorTemperature) {
                await this.pollOutdoorTemperature();
            }
            if (this.feat.hotWaterTemperature) {
                await this.pollHotWaterTemperature();
            }
        }
        catch (err) {
            const msg = err.message ?? String(err);
            this.log.warn(`Poll failed: ${msg}. Will retry after reconnect.`);
            this.dbg(`Poll error: ${err.stack ?? msg}`);
            this.connected = false;
            this.client = null;
            this.scheduleReconnect();
        }
    }
    async pollOutdoorTemperature() {
        try {
            this.dbg('Polling /system/sensors/temperatures/outdoor_t1…');
            const res = await this.client.get('/system/sensors/temperatures/outdoor_t1');
            const temp = Number(res.value);
            if (!Number.isNaN(temp)) {
                this.outdoorTemperature = temp;
                this.outdoorTempService
                    .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
                    .updateValue(temp);
                this.dbg(`Outdoor temperature: ${temp}°C`);
            }
        }
        catch (err) {
            this.log.warn(`Outdoor temperature poll failed: ${err.message}`);
        }
    }
    async pollHotWaterTemperature() {
        try {
            this.dbg('Polling /dhwCircuits/dhw1/actualTemp…');
            const res = await this.client.get('/dhwCircuits/dhw1/actualTemp');
            const temp = Number(res.value);
            if (!Number.isNaN(temp)) {
                this.hotWaterTemperature = temp;
                this.hotWaterTempService
                    .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
                    .updateValue(temp);
                this.dbg(`Hot water temperature: ${temp}°C`);
            }
        }
        catch (err) {
            this.log.warn(`Hot water temperature poll failed: ${err.message}`);
        }
    }
    // ─── Status application ───────────────────────────────────────────────────────
    applyUiStatus(status) {
        const { Characteristic } = this.api.hap;
        const v = status.value;
        // ── Core temperatures ────────────────────────────────────────────────────
        const inHouseTemp = Number(v.IHT);
        const setpoint = Number(v.TSP);
        const burnerOn = v.BAI !== 'No' && v.BAI !== '' && v.BAI !== undefined;
        this.dbg(`Parsed — IHT:${inHouseTemp} TSP:${setpoint} BAI:${v.BAI} DHW:${v.DHW} UMD:${v.UMD} HMD:${v.HMD} DAS:${v.DAS}`);
        if (!Number.isNaN(inHouseTemp)) {
            this.currentTemperature = inHouseTemp;
            this.thermostatService
                .getCharacteristic(Characteristic.CurrentTemperature)
                .updateValue(inHouseTemp);
        }
        else {
            this.log.warn(`Unexpected IHT value: ${v.IHT}`);
        }
        if (!Number.isNaN(setpoint)) {
            this.targetTemperature = setpoint;
            this.thermostatService
                .getCharacteristic(Characteristic.TargetTemperature)
                .updateValue(setpoint);
        }
        else {
            this.log.warn(`Unexpected TSP value: ${v.TSP}`);
        }
        // CurrentHeatingCoolingState — reflects actual burner activity
        const newCurrentState = burnerOn
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
        this.dbg(`BAI=${v.BAI}, burnerOn=${burnerOn}`);
        const statusChanged = inHouseTemp !== this.currentTemperature ||
            setpoint !== this.targetTemperature ||
            burnerOn !== (this.currentHeatingState === Characteristic.CurrentHeatingCoolingState.HEAT);
        if (statusChanged) {
            this.log.info(`Status — current: ${inHouseTemp}°C, setpoint: ${setpoint}°C, burner: ${burnerOn ? 'on' : 'off'}`);
        }
        // ── Hot Water ─────────────────────────────────────────────────────────────
        if (this.feat.hotWater && this.hotWaterService) {
            const hwOn = v.DHW === 'on';
            if (hwOn !== this.hotWaterActive) {
                this.hotWaterActive = hwOn;
                this.hotWaterService
                    .getCharacteristic(Characteristic.On)
                    .updateValue(hwOn);
                this.dbg(`Hot water state updated: ${hwOn}`);
            }
        }
        // ── Manual Mode ───────────────────────────────────────────────────────────
        // Always track UMD so handleSetTargetTemperature knows the current mode.
        const manual = v.UMD === 'manual';
        this.manualModeActive = manual;
        if (this.feat.manualMode && this.manualModeService) {
            this.manualModeService
                .getCharacteristic(Characteristic.On)
                .updateValue(manual);
            this.dbg(`Manual mode updated: ${manual}`);
        }
        // ── Holiday Mode ──────────────────────────────────────────────────────────
        if (this.feat.holidayMode && this.holidayModeService) {
            const holiday = v.HMD === 'on';
            if (holiday !== this.holidayModeActive) {
                this.holidayModeActive = holiday;
                this.holidayModeService
                    .getCharacteristic(Characteristic.On)
                    .updateValue(holiday);
                this.dbg(`Holiday mode updated: ${holiday}`);
            }
        }
        // ── Away Mode ─────────────────────────────────────────────────────────────
        if (this.feat.awayMode && this.awayModeService) {
            const away = v.DAS === 'on';
            if (away !== this.awayModeActive) {
                this.awayModeActive = away;
                const occupied = away
                    ? Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
                    : Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
                this.awayModeService
                    .getCharacteristic(Characteristic.OccupancyDetected)
                    .updateValue(occupied);
                this.dbg(`Away mode updated: ${away} => occupancy: ${occupied}`);
            }
        }
    }
    // ─── Handlers ────────────────────────────────────────────────────────────────
    async handleSetTargetTemperature(value) {
        const temp = value;
        this.log.info(`Setting target temperature to ${temp}°C`);
        if (!this.connected || !this.client) {
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
        const data = { value: temp };
        this.dbg(`PUT temperatureRoomManual + manualTempOverride/status + manualTempOverride/temperature ${JSON.stringify(data)}`);
        try {
            await Promise.all([
                this.client.put('/heatingCircuits/hc1/temperatureRoomManual', data),
                this.client.put('/heatingCircuits/hc1/manualTempOverride/status', { value: 'on' }),
                this.client.put('/heatingCircuits/hc1/manualTempOverride/temperature', data),
            ]);
            this.targetTemperature = temp;
            this.log.info(`Target temperature set to ${temp}°C`);
        }
        catch (err) {
            const e = err;
            this.log.error(`Failed to set temperature: ${e.message} (HTTP ${e.response?.statusCode ?? 'unknown'})`);
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    async handleSetHotWater(value) {
        const on = value;
        this.log.info(`Setting hot water: ${on ? 'on' : 'off'}`);
        if (!this.connected || !this.client) {
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
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
        }
        catch (err) {
            const e = err;
            this.log.error(`Failed to set hot water: ${e.message} (HTTP ${e.response?.statusCode ?? 'unknown'})`);
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    async handleSetManualMode(value) {
        const manual = value;
        const mode = manual ? 'manual' : 'clock';
        this.log.info(`Setting heating mode to: ${mode}`);
        if (!this.connected || !this.client) {
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
        this.dbg(`PUT /heatingCircuits/hc1/usermode {"value":"${mode}"}`);
        try {
            await this.client.put('/heatingCircuits/hc1/usermode', { value: mode });
            this.manualModeActive = manual;
            this.log.info(`Heating mode set to ${mode}`);
        }
        catch (err) {
            const e = err;
            this.log.error(`Failed to set heating mode: ${e.message} (HTTP ${e.response?.statusCode ?? 'unknown'})`);
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────────
    dbg(msg) {
        if (this.debugEnabled) {
            this.log.info(`[DEBUG] ${msg}`);
        }
    }
}
exports.NefitEasyAccessory = NefitEasyAccessory;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NefitEasyPlatform = void 0;
const settings_1 = require("./settings");
const accessory_1 = require("./accessory");
class NefitEasyPlatform {
    log;
    config;
    api;
    cachedAccessories = [];
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
    }
    // Called by Homebridge for each cached accessory on startup.
    configureAccessory(accessory) {
        this.log.info('Restoring cached accessory:', accessory.displayName);
        this.cachedAccessories.push(accessory);
    }
    discoverDevices() {
        // Validate required credentials before attempting anything.
        if (!this.config.serialNumber || !this.config.accessKey || !this.config.password) {
            this.log.error('Plugin not configured — open the Homebridge UI, click Settings on this plugin, and enter your Serial Number, Access Key, and Password.');
            return;
        }
        // Use serialNumber as the UUID seed so it's stable across restarts.
        const uuid = this.api.hap.uuid.generate(this.config.serialNumber ?? 'nefit-easy-thermostat');
        const existing = this.cachedAccessories.find(a => a.UUID === uuid);
        if (existing) {
            this.log.info('Restoring existing accessory:', existing.displayName);
            new accessory_1.NefitEasyAccessory(this.log, this.config, this.api, existing);
        }
        else {
            this.log.info('Registering new accessory:', this.config.name ?? 'Thermostat');
            const accessory = new this.api.platformAccessory(this.config.name ?? 'Thermostat', uuid);
            new accessory_1.NefitEasyAccessory(this.log, this.config, this.api, accessory);
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
        }
    }
}
exports.NefitEasyPlatform = NefitEasyPlatform;

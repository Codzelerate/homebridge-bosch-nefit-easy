import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { NefitEasyAccessory } from './accessory';

export class NefitEasyPlatform implements DynamicPlatformPlugin {
  private readonly cachedAccessories: PlatformAccessory[] = [];
  private accessory?: NefitEasyAccessory;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
    // Clean up timers and the XMPP connection when Homebridge stops or reloads.
    this.api.on('shutdown', () => {
      this.accessory?.dispose();
    });
  }

  // Called by Homebridge for each cached accessory on startup.
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  private discoverDevices(): void {
    // Validate required credentials before attempting anything.
    if (!this.config.serialNumber || !this.config.accessKey || !this.config.password) {
      this.log.error(
        'Plugin not configured — open the Homebridge UI, click Settings on this plugin, and enter your Serial Number, Access Key, and Password.',
      );
      return;
    }

    // Use serialNumber as the UUID seed so it's stable across restarts.
    const uuid = this.api.hap.uuid.generate(
      this.config.serialNumber ?? 'nefit-easy-thermostat',
    );

    const existing = this.cachedAccessories.find(a => a.UUID === uuid);

    // Drop any cached accessories that no longer match the configured device
    // (e.g. after the serial number changed) so they don't linger as ghost tiles.
    const stale = this.cachedAccessories.filter(a => a.UUID !== uuid);
    if (stale.length > 0) {
      this.log.info(`Removing ${stale.length} stale cached accessory(ies).`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }

    if (existing) {
      this.log.info('Restoring existing accessory:', existing.displayName);
      this.accessory = new NefitEasyAccessory(this.log, this.config, this.api, existing);
    } else {
      this.log.info('Registering new accessory:', this.config.name ?? 'Thermostat');
      const accessory = new this.api.platformAccessory(
        this.config.name ?? 'Thermostat',
        uuid,
      );
      this.accessory = new NefitEasyAccessory(this.log, this.config, this.api, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}

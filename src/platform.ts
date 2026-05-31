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

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  // Called by Homebridge for each cached accessory on startup.
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  private discoverDevices(): void {
    // Use serialNumber as the UUID seed so it's stable across restarts.
    const uuid = this.api.hap.uuid.generate(
      this.config.serialNumber ?? 'nefit-easy-thermostat',
    );

    const existing = this.cachedAccessories.find(a => a.UUID === uuid);

    if (existing) {
      this.log.info('Restoring existing accessory:', existing.displayName);
      new NefitEasyAccessory(this.log, this.config, this.api, existing);
    } else {
      this.log.info('Registering new accessory:', this.config.name ?? 'Thermostat');
      const accessory = new this.api.platformAccessory(
        this.config.name ?? 'Thermostat',
        uuid,
      );
      new NefitEasyAccessory(this.log, this.config, this.api, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}

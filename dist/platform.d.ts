import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
export declare class NefitEasyPlatform implements DynamicPlatformPlugin {
    readonly log: Logging;
    readonly config: PlatformConfig;
    readonly api: API;
    private readonly cachedAccessories;
    constructor(log: Logging, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private discoverDevices;
}

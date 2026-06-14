// Pure parsing / normalisation helpers for the Nefit Easy backend responses.
// Deliberately free of any Homebridge / HAP dependency so they can be unit
// tested directly without mocking the platform.

// ─── API response shapes ──────────────────────────────────────────────────────

/** Raw `value` object returned by `/ecus/rrc/uiStatus`. */
export interface UiStatusValue {
  IHT: string;   // in-house temperature
  TSP: string;   // temperature setpoint
  BAI: string;   // burner active indicator
  DHW: string;   // domestic hot water active
  UMD: string;   // user mode: "manual" | "clock"
  HMD: string;   // holiday mode: "on" | "off"
  DAS: string;   // domestic away status: "on" | "off"
  [key: string]: unknown;
}

export interface UiStatus {
  id: string;
  type: string;
  value: UiStatusValue;
}

export interface ScalarResponse {
  value: number | string;
}

// ─── Normalised state ─────────────────────────────────────────────────────────

/** Thermostat state derived from a raw uiStatus payload. */
export interface NefitStatus {
  /** In-house temperature in °C, or null if the device returned a non-numeric value. */
  currentTemperature: number | null;
  /** Setpoint in °C, or null if the device returned a non-numeric value. */
  targetTemperature: number | null;
  /** True when the boiler burner is firing. */
  burnerOn: boolean;
  hotWaterOn: boolean;
  manualMode: boolean;
  holidayMode: boolean;
  awayMode: boolean;
}

/** Coerce a raw API value to a finite number, or null when it is not numeric. */
export function parseTemperature(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a raw uiStatus `value` object into typed thermostat state. */
export function parseUiStatus(v: UiStatusValue): NefitStatus {
  return {
    currentTemperature: parseTemperature(v.IHT),
    targetTemperature:  parseTemperature(v.TSP),
    burnerOn:           v.BAI !== 'No' && v.BAI !== '' && v.BAI !== undefined,
    hotWaterOn:         v.DHW === 'on',
    manualMode:         v.UMD === 'manual',
    holidayMode:        v.HMD === 'on',
    awayMode:           v.DAS === 'on',
  };
}

/** Extract a finite temperature from a scalar `{ value }` response, or null. */
export function parseScalarTemperature(res: ScalarResponse | undefined | null): number | null {
  return parseTemperature(res?.value);
}

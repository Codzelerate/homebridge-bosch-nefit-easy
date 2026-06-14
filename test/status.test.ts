import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScalarTemperature,
  parseTemperature,
  parseUiStatus,
  type UiStatusValue,
} from '../src/status';

function uiStatus(overrides: Partial<UiStatusValue> = {}): UiStatusValue {
  return {
    IHT: '20',
    TSP: '20',
    BAI: 'No',
    DHW: 'off',
    UMD: 'clock',
    HMD: 'off',
    DAS: 'off',
    ...overrides,
  };
}

test('parseTemperature coerces numeric strings', () => {
  assert.equal(parseTemperature('21.5'), 21.5);
  assert.equal(parseTemperature('0'), 0);
  assert.equal(parseTemperature(-3.2), -3.2);
});

test('parseTemperature returns null for non-numeric / empty / missing values', () => {
  assert.equal(parseTemperature('foo'), null);
  assert.equal(parseTemperature(''), null);
  assert.equal(parseTemperature(undefined), null);
  assert.equal(parseTemperature(null), null);
  assert.equal(parseTemperature(NaN), null);
  assert.equal(parseTemperature(Infinity), null);
});

test('parseUiStatus reads core temperatures', () => {
  const s = parseUiStatus(uiStatus({ IHT: '21.5', TSP: '19' }));
  assert.equal(s.currentTemperature, 21.5);
  assert.equal(s.targetTemperature, 19);
});

test('parseUiStatus surfaces unparseable temperatures as null', () => {
  const s = parseUiStatus(uiStatus({ IHT: '', TSP: 'n/a' }));
  assert.equal(s.currentTemperature, null);
  assert.equal(s.targetTemperature, null);
});

test('parseUiStatus treats any non-"No" burner indicator as firing', () => {
  assert.equal(parseUiStatus(uiStatus({ BAI: 'No' })).burnerOn, false);
  assert.equal(parseUiStatus(uiStatus({ BAI: '' })).burnerOn, false);
  assert.equal(parseUiStatus(uiStatus({ BAI: 'CH' })).burnerOn, true);
  assert.equal(parseUiStatus(uiStatus({ BAI: 'HW' })).burnerOn, true);
});

test('parseUiStatus maps the on/off flags', () => {
  const on = parseUiStatus(uiStatus({ DHW: 'on', UMD: 'manual', HMD: 'on', DAS: 'on' }));
  assert.deepEqual(
    { hw: on.hotWaterOn, manual: on.manualMode, holiday: on.holidayMode, away: on.awayMode },
    { hw: true, manual: true, holiday: true, away: true },
  );

  const off = parseUiStatus(uiStatus());
  assert.deepEqual(
    { hw: off.hotWaterOn, manual: off.manualMode, holiday: off.holidayMode, away: off.awayMode },
    { hw: false, manual: false, holiday: false, away: false },
  );
});

test('parseScalarTemperature handles values, strings and missing payloads', () => {
  assert.equal(parseScalarTemperature({ value: 7.4 }), 7.4);
  assert.equal(parseScalarTemperature({ value: '12.8' }), 12.8);
  assert.equal(parseScalarTemperature(undefined), null);
  assert.equal(parseScalarTemperature(null), null);
});

// Regression guard for the info-level status line: it must fire only when the
// setpoint or burner state changes — NOT when the current temperature drifts
// (which it does every poll, and would otherwise flood the log).
test('status line triggers on setpoint/burner change, not temperature drift', () => {
  const prev = parseUiStatus(uiStatus({ IHT: '20.0', TSP: '21', BAI: 'No' }));
  const tempDrift = parseUiStatus(uiStatus({ IHT: '20.3', TSP: '21', BAI: 'No' }));
  const setpoint = parseUiStatus(uiStatus({ IHT: '20.0', TSP: '22', BAI: 'No' }));
  const burner = parseUiStatus(uiStatus({ IHT: '20.0', TSP: '21', BAI: 'CH' }));

  // Mirrors the trigger used in applyUiStatus.
  const triggersLog = (a: typeof prev, b: typeof prev) =>
    a.targetTemperature !== b.targetTemperature ||
    a.burnerOn !== b.burnerOn;

  assert.equal(triggersLog(prev, tempDrift), false); // temperature drift is silent
  assert.equal(triggersLog(prev, setpoint), true);   // setpoint change logs
  assert.equal(triggersLog(prev, burner), true);     // burner change logs
});

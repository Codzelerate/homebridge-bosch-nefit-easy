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

// Regression guard for the status-change detection: a poll that reports the
// same values as the previous one must be detectable as "no change", and a
// differing value as "changed". This is the contract applyUiStatus relies on.
test('status change detection compares parsed snapshots', () => {
  const prev = parseUiStatus(uiStatus({ IHT: '20', TSP: '21', BAI: 'No' }));
  const same = parseUiStatus(uiStatus({ IHT: '20', TSP: '21', BAI: 'No' }));
  const diff = parseUiStatus(uiStatus({ IHT: '20', TSP: '21', BAI: 'CH' }));

  const changed = (a: typeof prev, b: typeof prev) =>
    a.currentTemperature !== b.currentTemperature ||
    a.targetTemperature !== b.targetTemperature ||
    a.burnerOn !== b.burnerOn;

  assert.equal(changed(prev, same), false);
  assert.equal(changed(prev, diff), true);
});

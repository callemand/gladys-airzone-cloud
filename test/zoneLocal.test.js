import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLocalPollStates,
  buildLocalSetChange,
  isFahrenheit,
  toCelsius,
  toFahrenheit,
} from '../src/devices/zoneLocal.js';
import { AC_MODE } from '../src/constants.js';
import { LOCAL_ZONE_STATUS } from './fixtures.js';

const ids = {
  device: 'ext:airzone-cloud:zone:zone-1',
  feature: (code) => `ext:airzone-cloud:zone:zone-1:${code}`,
};

test('buildLocalPollStates maps a local master zone status', () => {
  assert.deepEqual(buildLocalPollStates(ids, LOCAL_ZONE_STATUS), [
    { device_feature_external_id: ids.feature('power'), state: 1 },
    { device_feature_external_id: ids.feature('temperature'), state: 21 },
    { device_feature_external_id: ids.feature('room-temperature'), state: 19.5 },
    { device_feature_external_id: ids.feature('humidity'), state: 42 },
    // Local mode 3 is heating (the cloud uses 3 for heating too, but 1 for auto:
    // the two code tables differ, hence the dedicated mapping).
    { device_feature_external_id: ids.feature('mode'), state: AC_MODE.HEATING },
  ]);
});

test('buildLocalPollStates exposes no mode on a zone that does not control it', () => {
  const states = buildLocalPollStates(ids, {
    ...LOCAL_ZONE_STATUS,
    on: 0,
    modes: undefined,
  });
  assert.deepEqual(
    states.map((s) => s.device_feature_external_id.split(':').pop()),
    ['power', 'temperature', 'room-temperature', 'humidity'],
  );
  assert.equal(states[0].state, 0);
});

test('buildLocalPollStates maps every local mode code', () => {
  const modeOf = (mode) =>
    buildLocalPollStates(ids, { ...LOCAL_ZONE_STATUS, mode }).find(
      (s) => s.device_feature_external_id === ids.feature('mode'),
    )?.state;

  assert.equal(modeOf(2), AC_MODE.COOLING);
  assert.equal(modeOf(3), AC_MODE.HEATING);
  assert.equal(modeOf(4), AC_MODE.FAN);
  assert.equal(modeOf(5), AC_MODE.DRYING);
  assert.equal(modeOf(6), AC_MODE.HEATING, 'aux heating is reported as heating');
  assert.equal(modeOf(7), AC_MODE.AUTO);
  // STOP is power off, not a Gladys mode, and an unknown code is skipped.
  assert.equal(modeOf(1), undefined);
  assert.equal(modeOf(42), undefined);
});

test('buildLocalPollStates skips the values the zone does not report', () => {
  const states = buildLocalPollStates(ids, { systemID: 1, zoneID: 3, on: 0 });
  assert.deepEqual(states, [{ device_feature_external_id: ids.feature('power'), state: 0 }]);
});

test('a Fahrenheit installation is converted to Celsius', () => {
  const status = { ...LOCAL_ZONE_STATUS, units: 1, roomTemp: 67, setpoint: 70 };
  assert.equal(isFahrenheit(status), true);
  const states = buildLocalPollStates(ids, status);
  const stateOf = (code) =>
    states.find((s) => s.device_feature_external_id === ids.feature(code)).state;
  assert.equal(stateOf('room-temperature'), 19.4);
  assert.equal(stateOf('temperature'), 21.1);
});

test('temperature conversions round to one decimal', () => {
  assert.equal(toCelsius(68), 20);
  assert.equal(toFahrenheit(20), 68);
  assert.equal(toCelsius(toFahrenheit(21.5)), 21.5);
});

test('buildLocalSetChange maps Gladys commands to local API fields', () => {
  assert.deepEqual(buildLocalSetChange('power', 1), { on: 1 });
  assert.deepEqual(buildLocalSetChange('power', 0), { on: 0 });
  assert.deepEqual(buildLocalSetChange('mode', AC_MODE.COOLING), { mode: 2 });
  assert.deepEqual(buildLocalSetChange('mode', AC_MODE.AUTO), { mode: 7 });
  assert.deepEqual(buildLocalSetChange('temperature', 22), { setpoint: 22 });
  // A read-only feature and an unknown mode are not controllable.
  assert.equal(buildLocalSetChange('room-temperature', 20), null);
  assert.equal(buildLocalSetChange('mode', 99), null);
});

test('a setpoint is written in the unit of the installation', () => {
  assert.deepEqual(buildLocalSetChange('temperature', 21, { units: 1 }), { setpoint: 69.8 });
  assert.deepEqual(buildLocalSetChange('temperature', 21, { units: 0 }), { setpoint: 21 });
  // Unknown unit (no status read yet): Celsius, the default of the API.
  assert.deepEqual(buildLocalSetChange('temperature', 21, undefined), { setpoint: 21 });
});

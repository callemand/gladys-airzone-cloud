import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildZoneFeatures,
  buildPollStates,
  buildSetZoneChange,
  getParam,
  getTemperature,
} from '../src/devices/zone.js';
import { AC_MODE } from '../src/constants.js';
import {
  ZONE_DEVICE,
  ZONE_STATUS,
  REGULAR_ZONE_STATUS,
  AIR_QUALITY_ZONE_STATUS,
} from './fixtures.js';

const EXTERNAL_ID = 'ext:airzone-cloud:zone:zone-1';
// Same contract as gladys.externalIds(): { device, feature(featureKey) }.
const ids = {
  device: EXTERNAL_ID,
  feature: (featureKey) => `${EXTERNAL_ID}:${featureKey}`,
};

test('getParam reads raw values, unwraps { value } objects and tolerates absence', () => {
  assert.equal(getParam({ power: true }, 'power'), true);
  assert.equal(getParam({ mode: { value: 3 } }, 'mode'), 3);
  assert.equal(getParam({ power: null }, 'power'), null);
  assert.equal(getParam({}, 'power'), undefined);
  assert.equal(getParam(undefined, 'power'), undefined);
  const obj = { foo: 'bar' };
  assert.equal(getParam({ power: obj }, 'power'), obj);
});

test('getTemperature reads the celsius value of an Airzone temperature object', () => {
  assert.equal(getTemperature({ local_temp: { celsius: 19.5, fah: 67 } }, 'local_temp'), 19.5);
  assert.equal(getTemperature({ t: { value: 21 } }, 't'), 21);
  assert.equal(getTemperature({ t: 22 }, 't'), 22);
  assert.equal(getTemperature({ t: { fah: 70 } }, 't'), undefined);
  assert.equal(getTemperature({}, 'local_temp'), undefined);
});

test('buildZoneFeatures exposes power, mode, temperatures and humidity for a master zone', () => {
  const features = buildZoneFeatures(ids, { ...ZONE_DEVICE, status: ZONE_STATUS });
  // No particulate values reported -> no PM features.
  assert.equal(features.length, 5);

  assert.deepEqual(
    features.map((f) => ({ external_id: f.external_id, category: f.category, type: f.type })),
    [
      { external_id: `${EXTERNAL_ID}:power`, category: 'air-conditioning', type: 'binary' },
      { external_id: `${EXTERNAL_ID}:mode`, category: 'air-conditioning', type: 'mode' },
      {
        external_id: `${EXTERNAL_ID}:temperature`,
        category: 'air-conditioning',
        type: 'target-temperature',
      },
      {
        external_id: `${EXTERNAL_ID}:room-temperature`,
        category: 'temperature-sensor',
        type: 'decimal',
      },
      {
        external_id: `${EXTERNAL_ID}:humidity`,
        category: 'humidity-sensor',
        type: 'decimal',
      },
    ],
  );

  // The target temperature bounds come from the current mode's setpoint range
  // (heating -> range_sp_hot_air_*).
  const temperature = features.find((f) => f.external_id.endsWith(':temperature'));
  assert.equal(temperature.min, 16);
  assert.equal(temperature.max, 30);

  // The controllable AC features have feedback; the sensors are read-only.
  const [power, mode, target] = features;
  [power, mode, target].forEach((feature) => {
    assert.equal(feature.read_only, false);
    assert.equal(feature.has_feedback, true);
  });
  assert.equal(features.find((f) => f.external_id.endsWith(':room-temperature')).read_only, true);
  assert.equal(features.find((f) => f.external_id.endsWith(':humidity')).read_only, true);
});

test('buildZoneFeatures omits the Mode feature on a non-master zone (keeps humidity)', () => {
  const features = buildZoneFeatures(ids, { status: REGULAR_ZONE_STATUS });
  assert.deepEqual(
    features.map((f) => f.external_id),
    [
      `${EXTERNAL_ID}:power`,
      `${EXTERNAL_ID}:temperature`,
      `${EXTERNAL_ID}:room-temperature`,
      `${EXTERNAL_ID}:humidity`,
    ],
  );
  // Cooling mode -> bounds come from range_sp_cool_air_*.
  const temperature = features.find((f) => f.external_id.endsWith(':temperature'));
  assert.equal(temperature.min, 18);
  assert.equal(temperature.max, 30);
});

test('buildZoneFeatures exposes PM2.5 / PM10 only when the zone reports them', () => {
  const features = buildZoneFeatures(ids, { status: AIR_QUALITY_ZONE_STATUS });
  const pm25 = features.find((f) => f.external_id.endsWith(':pm25'));
  const pm10 = features.find((f) => f.external_id.endsWith(':pm10'));
  assert.ok(pm25 && pm10, 'PM features are present');
  assert.equal(pm25.category, 'pm25-sensor');
  assert.equal(pm10.category, 'pm10-sensor');
  assert.equal(pm25.unit, 'microgram-per-cubic-meter');
});

test('buildZoneFeatures falls back to default bounds when no range is reported', () => {
  const withoutRange = buildZoneFeatures(ids, { status: {} }).find((f) =>
    f.external_id.endsWith(':temperature'),
  );
  assert.equal(withoutRange.min, 10);
  assert.equal(withoutRange.max, 30);
});

test('buildPollStates maps a master zone status to Gladys states', () => {
  const states = buildPollStates(ids, ZONE_STATUS);
  // PM2.5 / PM10 are null -> dropped.
  assert.deepEqual(states, [
    { device_feature_external_id: `${EXTERNAL_ID}:power`, state: 1 },
    { device_feature_external_id: `${EXTERNAL_ID}:temperature`, state: 21 },
    { device_feature_external_id: `${EXTERNAL_ID}:room-temperature`, state: 19.5 },
    { device_feature_external_id: `${EXTERNAL_ID}:humidity`, state: 42 },
    { device_feature_external_id: `${EXTERNAL_ID}:mode`, state: AC_MODE.HEATING },
  ]);
});

test('buildPollStates on a non-master zone omits the mode state', () => {
  const states = buildPollStates(ids, REGULAR_ZONE_STATUS);
  assert.deepEqual(states, [
    { device_feature_external_id: `${EXTERNAL_ID}:power`, state: 0 },
    { device_feature_external_id: `${EXTERNAL_ID}:temperature`, state: 25 },
    { device_feature_external_id: `${EXTERNAL_ID}:room-temperature`, state: 24.2 },
    { device_feature_external_id: `${EXTERNAL_ID}:humidity`, state: 55 },
  ]);
});

test('buildPollStates includes PM2.5 / PM10 when the zone reports them', () => {
  const states = buildPollStates(ids, AIR_QUALITY_ZONE_STATUS);
  assert.deepEqual(
    states.filter((s) => /:(pm25|pm10)$/.test(s.device_feature_external_id)),
    [
      { device_feature_external_id: `${EXTERNAL_ID}:pm25`, state: 12 },
      { device_feature_external_id: `${EXTERNAL_ID}:pm10`, state: 20 },
    ],
  );
});

test('buildPollStates skips power off and unknown mode / missing values', () => {
  const states = buildPollStates(ids, { power: false, mode: 99, mode_available: [2, 3] });
  assert.deepEqual(states, [{ device_feature_external_id: `${EXTERNAL_ID}:power`, state: 0 }]);
});

test('buildSetZoneChange maps Gladys commands to Airzone changes', () => {
  assert.deepEqual(buildSetZoneChange('power', 1), { param: 'power', value: true });
  assert.deepEqual(buildSetZoneChange('power', 0), { param: 'power', value: false });
  assert.deepEqual(buildSetZoneChange('mode', AC_MODE.COOLING), { param: 'mode', value: 2 });
  assert.deepEqual(buildSetZoneChange('mode', AC_MODE.AUTO), { param: 'mode', value: 1 });
  assert.deepEqual(buildSetZoneChange('temperature', 22.5), {
    param: 'setpoint',
    value: 22.5,
    opts: { units: 0 },
  });
  assert.equal(buildSetZoneChange('mode', 999), null);
  assert.equal(buildSetZoneChange('room-temperature', 20), null);
  assert.equal(buildSetZoneChange('unknown', 1), null);
});

test('mode mappings round-trip between Gladys and Airzone', () => {
  const airzoneModes = {
    1: AC_MODE.AUTO,
    2: AC_MODE.COOLING,
    3: AC_MODE.HEATING,
    4: AC_MODE.FAN,
    5: AC_MODE.DRYING,
  };
  Object.entries(airzoneModes).forEach(([airzoneMode, gladysMode]) => {
    const [state] = buildPollStates(ids, {
      mode: Number(airzoneMode),
      mode_available: [1, 2, 3, 4, 5],
    }).filter((s) => s.device_feature_external_id.endsWith(':mode'));
    assert.equal(state.state, gladysMode);
    assert.equal(buildSetZoneChange('mode', gladysMode).value, Number(airzoneMode));
  });
});

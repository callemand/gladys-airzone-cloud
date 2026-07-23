import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildZoneFeatures,
  buildPollStates,
  buildSetZoneChange,
  getParam,
} from '../src/devices/zone.js';
import { AC_MODE } from '../src/constants.js';
import { ZONE_DEVICE, ZONE_STATUS } from './fixtures.js';

const EXTERNAL_ID = 'ext:airzone-cloud:zone:zone-1';

test('getParam reads raw values, unwraps { value } objects and tolerates absence', () => {
  assert.equal(getParam({ power: true }, 'power'), true);
  assert.equal(getParam({ setpoint: { value: 21 } }, 'setpoint'), 21);
  assert.equal(getParam({ power: null }, 'power'), null);
  assert.equal(getParam({}, 'power'), undefined);
  assert.equal(getParam(undefined, 'power'), undefined);
  const obj = { foo: 'bar' };
  assert.equal(getParam({ power: obj }, 'power'), obj);
});

test('buildZoneFeatures exposes power, mode, target and room temperature', () => {
  const features = buildZoneFeatures(EXTERNAL_ID, { ...ZONE_DEVICE, status: ZONE_STATUS });
  assert.equal(features.length, 4);

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
    ],
  );

  // The target temperature bounds come from the zone setpoint range.
  const temperature = features.find((f) => f.external_id.endsWith(':temperature'));
  assert.equal(temperature.min, 16);
  assert.equal(temperature.max, 30);

  // The three AC features are controllable with feedback; the room sensor is read-only.
  const [power, mode, target, room] = features;
  [power, mode, target].forEach((feature) => {
    assert.equal(feature.read_only, false);
    assert.equal(feature.has_feedback, true);
  });
  assert.equal(room.read_only, true);
});

test('buildZoneFeatures falls back to air range then default bounds', () => {
  const withAirRange = buildZoneFeatures(EXTERNAL_ID, {
    status: { range_air_min: 17, range_air_max: 27 },
  }).find((f) => f.external_id.endsWith(':temperature'));
  assert.equal(withAirRange.min, 17);
  assert.equal(withAirRange.max, 27);

  const withoutRange = buildZoneFeatures(EXTERNAL_ID, { status: {} }).find((f) =>
    f.external_id.endsWith(':temperature'),
  );
  assert.equal(withoutRange.min, 10);
  assert.equal(withoutRange.max, 30);
});

test('buildPollStates maps the zone status to Gladys states', () => {
  const states = buildPollStates(EXTERNAL_ID, ZONE_STATUS);
  assert.deepEqual(states, [
    { device_feature_external_id: `${EXTERNAL_ID}:power`, state: 1 },
    { device_feature_external_id: `${EXTERNAL_ID}:mode`, state: AC_MODE.HEATING },
    { device_feature_external_id: `${EXTERNAL_ID}:temperature`, state: 21 },
    { device_feature_external_id: `${EXTERNAL_ID}:room-temperature`, state: 19.5 },
  ]);
});

test('buildPollStates skips power off and unknown mode / missing values', () => {
  const states = buildPollStates(EXTERNAL_ID, { power: false, mode: 99 });
  assert.deepEqual(states, [{ device_feature_external_id: `${EXTERNAL_ID}:power`, state: 0 }]);
});

test('buildSetZoneChange maps Gladys commands to Airzone changes', () => {
  assert.deepEqual(buildSetZoneChange('power', 1), { param: 'power', value: true });
  assert.deepEqual(buildSetZoneChange('power', 0), { param: 'power', value: false });
  assert.deepEqual(buildSetZoneChange('mode', AC_MODE.COOLING), { param: 'mode', value: 2 });
  assert.deepEqual(buildSetZoneChange('mode', AC_MODE.AUTO), { param: 'mode', value: 7 });
  assert.deepEqual(buildSetZoneChange('temperature', 22.5), { param: 'setpoint', value: 22.5 });
  assert.equal(buildSetZoneChange('mode', 999), null);
  assert.equal(buildSetZoneChange('room-temperature', 20), null);
  assert.equal(buildSetZoneChange('unknown', 1), null);
});

test('mode mappings round-trip between Gladys and Airzone', () => {
  const airzoneModes = {
    2: AC_MODE.COOLING,
    3: AC_MODE.HEATING,
    4: AC_MODE.FAN,
    5: AC_MODE.DRYING,
    7: AC_MODE.AUTO,
  };
  Object.entries(airzoneModes).forEach(([airzoneMode, gladysMode]) => {
    const [state] = buildPollStates(EXTERNAL_ID, { mode: Number(airzoneMode) }).filter((s) =>
      s.device_feature_external_id.endsWith(':mode'),
    );
    assert.equal(state.state, gladysMode);
    assert.equal(buildSetZoneChange('mode', gladysMode).value, Number(airzoneMode));
  });
});

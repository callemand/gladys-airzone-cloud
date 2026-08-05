import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEVICE_TYPES,
  buildDiscoveredDevices,
  buildTransportEntries,
  findTypeByDevice,
} from '../src/devices/index.js';
import { getInstallationId } from '../src/devices/common.js';
import { ZONE_DEVICE, ZONE_STATUS, AIR_QUALITY_DEVICE, AIR_QUALITY_STATUS } from './fixtures.js';

// Minimal stand-in for the SDK: only externalId()/externalIds() are used by the
// device registry (same contract as GladysIntegration).
const gladys = {
  externalId: (suffix) => `ext:airzone-cloud:${suffix}`,
  externalIds: (type, platformId) => {
    const device = `ext:airzone-cloud:${type}:${platformId}`;
    return { device, feature: (featureKey) => `${device}:${featureKey}` };
  },
};

const INVENTORY = {
  zones: [{ ...ZONE_DEVICE, installationId: 'install-1', status: ZONE_STATUS }],
  airQualitySensors: [
    { ...AIR_QUALITY_DEVICE, installationId: 'install-1', status: AIR_QUALITY_STATUS },
  ],
};

test('buildDiscoveredDevices converts a zone', () => {
  const [device] = buildDiscoveredDevices(gladys, INVENTORY);

  assert.equal(device.name, 'Living room');
  assert.equal(device.external_id, 'ext:airzone-cloud:zone:zone-1');
  assert.equal(device.model, 'ws_az');
  assert.equal(device.poll_frequency, 60000);
  assert.equal(device.should_poll, true);
  assert.equal(device.features.length, 5);
  assert.deepEqual(device.params, [{ name: 'installationId', value: 'install-1' }]);
});

test('buildDiscoveredDevices converts an az_airqsensor', () => {
  const device = buildDiscoveredDevices(gladys, INVENTORY).at(-1);

  // Empty API name -> friendly default; airq slug in the external id.
  assert.equal(device.name, 'Air quality');
  assert.equal(device.external_id, 'ext:airzone-cloud:airq:airq-1');
  assert.equal(device.features.length, 8);
  assert.deepEqual(device.params, [{ name: 'installationId', value: 'install-1' }]);
});

test('every feature carries a unique selector based on its external_id', () => {
  const features = buildDiscoveredDevices(gladys, INVENTORY).flatMap((d) => d.features);
  // The selector must equal the (globally-unique) external_id, so features
  // named the same (e.g. "Humidity" on the zone and the air-quality sensor)
  // never collide on the global t_device_feature.selector constraint.
  features.forEach((f) => assert.equal(f.selector, f.external_id));
  const selectors = features.map((f) => f.selector);
  assert.equal(new Set(selectors).size, selectors.length, 'selectors are unique');
});

test('a zone falls back to the device id and a null model', () => {
  const [device] = buildDiscoveredDevices(gladys, {
    zones: [{ device_id: 'zone-2', installationId: 'install-1', status: {} }],
  });

  assert.equal(device.name, 'zone-2');
  assert.equal(device.model, null);
});

test('findTypeByDevice routes a device to its type', () => {
  const zone = findTypeByDevice(gladys, { external_id: 'ext:airzone-cloud:zone:zone-1' });
  assert.equal(zone.type.slug, 'zone');
  assert.equal(zone.deviceId, 'zone-1');

  const airq = findTypeByDevice(gladys, { external_id: 'ext:airzone-cloud:airq:airq-1' });
  assert.equal(airq.type.slug, 'airq');
  assert.equal(airq.deviceId, 'airq-1');

  // An unknown slug is not an error: no type owns it.
  assert.equal(
    findTypeByDevice(gladys, { external_id: 'ext:airzone-cloud:other:1' }).type,
    undefined,
  );

  assert.throws(
    () => findTypeByDevice(gladys, { external_id: 'philips-hue:1' }),
    /should start with "ext:airzone-cloud:"/,
  );
  assert.throws(
    () => findTypeByDevice(gladys, { external_id: 'ext:airzone-cloud:zone' }),
    /should be "ext:airzone-cloud:<slug>:<deviceId>"/,
  );
});

test('only the zone type is controllable, both types poll', () => {
  const byType = Object.fromEntries(DEVICE_TYPES.map((type) => [type.slug, type]));
  assert.equal(typeof byType.zone.onSetValue, 'function');
  assert.equal(byType.airq.onSetValue, undefined);
  DEVICE_TYPES.forEach((type) => assert.equal(typeof type.onPoll, 'function'));
});

test('every device reports the cloud transport', () => {
  const devices = buildDiscoveredDevices(gladys, INVENTORY);
  assert.deepEqual(buildTransportEntries(gladys, devices), [
    { external_id: 'ext:airzone-cloud:zone:zone-1', transport: 'cloud' },
    { external_id: 'ext:airzone-cloud:airq:airq-1', transport: 'cloud' },
  ]);
});

test('getInstallationId reads the installationId param', () => {
  assert.equal(
    getInstallationId({
      external_id: 'x',
      params: [{ name: 'installationId', value: 'install-1' }],
    }),
    'install-1',
  );
  assert.throws(
    () => getInstallationId({ external_id: 'x', params: [] }),
    /has no "installationId" param/,
  );
  assert.throws(() => getInstallationId({ external_id: 'x' }), /has no "installationId" param/);
});

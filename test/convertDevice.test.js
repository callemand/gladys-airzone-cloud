import test from 'node:test';
import assert from 'node:assert/strict';

import {
  convertDevice,
  convertAirQualitySensor,
  getInstallationId,
} from '../src/devices/convertDevice.js';
import { ZONE_DEVICE, ZONE_STATUS, AIR_QUALITY_DEVICE, AIR_QUALITY_STATUS } from './fixtures.js';

// Minimal stand-in for the SDK: only externalIds() is used by convertDevice
// (same contract as GladysIntegration#externalIds).
const gladys = {
  externalIds: (type, platformId) => {
    const device = `ext:airzone-cloud:${type}:${platformId}`;
    return { device, feature: (featureKey) => `${device}:${featureKey}` };
  },
};

test('convertDevice converts a zone', () => {
  const device = convertDevice(gladys, {
    ...ZONE_DEVICE,
    installationId: 'install-1',
    status: ZONE_STATUS,
  });

  assert.equal(device.name, 'Living room');
  assert.equal(device.external_id, 'ext:airzone-cloud:zone:zone-1');
  assert.equal(device.model, 'ws_az');
  assert.equal(device.poll_frequency, 10000);
  assert.equal(device.should_poll, true);
  assert.equal(device.features.length, 5);
  assert.deepEqual(device.params, [{ name: 'installationId', value: 'install-1' }]);
});

test('convertAirQualitySensor converts an az_airqsensor', () => {
  const device = convertAirQualitySensor(gladys, {
    ...AIR_QUALITY_DEVICE,
    installationId: 'install-1',
    status: AIR_QUALITY_STATUS,
  });

  // Empty API name -> friendly default; airq slug in the external id.
  assert.equal(device.name, 'Air quality');
  assert.equal(device.external_id, 'ext:airzone-cloud:airq:airq-1');
  assert.equal(device.features.length, 8);
  assert.deepEqual(device.params, [{ name: 'installationId', value: 'install-1' }]);
});

test('convertDevice falls back to the device id and a null model', () => {
  const device = convertDevice(gladys, {
    device_id: 'zone-2',
    installationId: 'install-1',
    status: {},
  });

  assert.equal(device.name, 'zone-2');
  assert.equal(device.model, null);
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

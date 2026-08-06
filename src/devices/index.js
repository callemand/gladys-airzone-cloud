// -----------------------------------------------------------------------------
// Device registry.
//
// Add or remove device types here. Each device type lives in its own file and
// exposes the same shape:
//   - slug                          : segment of the external ids, used to route
//     a Gladys command back to the right device type (`zone`, `airq`)
//   - buildDevice(gladys, entry)    : the discovery payload of ONE device, from
//     its Airzone Cloud entry
//   - onPoll(gladys, context)        (optional): periodic read + publishStates.
//     May return `{ transport, degraded, message }`: the channel it ACTUALLY
//     used, which index.js publishes as the device's transport badge
//   - onSetValue(gladys, context)    (optional): run a user command
//   - transport(gladys, config)      (optional): channel the device is expected
//     to use, shown as a badge in Gladys
//
// Unlike the official template, where each blueprint stands for ONE static
// device, an Airzone account exposes an arbitrary number of devices per type
// (one per zone): a blueprint therefore builds a device from an Airzone entry,
// and the dispatch keys on the type slug instead of a fixed external id.
// -----------------------------------------------------------------------------

import { airQualityDevice } from './airQualitySensor.js';
import { parseDeviceExternalId } from './common.js';
import { zoneDevice } from './zone.js';

export const DEVICE_TYPES = [zoneDevice, airQualityDevice];

/**
 * Build the discovery payload for Gladys (every device of the account).
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} inventory the account inventory (from airzone.listDevices())
 * @returns {Array} Gladys discovered devices
 */
export function buildDiscoveredDevices(gladys, { zones = [], airQualitySensors = [] }) {
  return [
    ...zones.map((zone) => zoneDevice.buildDevice(gladys, zone)),
    ...airQualitySensors.map((sensor) => airQualityDevice.buildDevice(gladys, sensor)),
  ];
}

/**
 * Find the device type that owns a given Gladys device, and the Airzone ids it
 * needs (used to route onPoll / onSetValue to the right device type).
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} device the Gladys device
 * @returns {{ type: object|undefined, deviceId: string }}
 */
export function findTypeByDevice(gladys, device) {
  const { slug, deviceId } = parseDeviceExternalId(gladys, device.external_id);
  return { type: DEVICE_TYPES.find((candidate) => candidate.slug === slug), deviceId };
}

/**
 * Build the `publishTransports` payload of the published devices: the channel
 * each device is actually reached through, rendered as a badge in Gladys.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {Array} devices the discovered devices published to Gladys
 * @param {object} config the integration config
 * @returns {Array} entries for gladys.publishTransports()
 */
export function buildTransportEntries(gladys, devices, config) {
  return devices
    .map((device) => {
      const { type } = findTypeByDevice(gladys, device);
      if (!type || typeof type.transport !== 'function') {
        return null;
      }
      const reported = type.transport(gladys, config);
      const entry = typeof reported === 'string' ? { transport: reported } : reported;
      return { external_id: device.external_id, ...entry };
    })
    .filter(Boolean);
}

// -----------------------------------------------------------------------------
// Convert an Airzone Cloud zone (from installations -> groups -> devices) into
// a Gladys discovered-device payload.
//
// External id scheme (built with gladys.externalIds(), mandatory prefix
// `ext:<selector>:`):
//   device  -> ext:<selector>:zone:<deviceId>     e.g. ext:airzone-cloud:zone:abc
//   feature -> ext:<selector>:zone:<deviceId>:<power|mode|temperature|room-temperature>
//
// The Airzone installationId is stored as a device param: Gladys sends the
// params back with every poll / set-value command, and the status / command
// endpoints require it.
// -----------------------------------------------------------------------------

import { POLL_FREQUENCY } from '../constants.js';
import { buildZoneFeatures } from './zone.js';
import { buildAirQualityFeatures } from './airQualitySensor.js';

export const INSTALLATION_ID_PARAM = 'installationId';

export const ZONE_SLUG = 'zone';
export const AIR_QUALITY_SLUG = 'airq';

/**
 * Build the external ids (device + feature factory) of an Airzone zone.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {string} deviceId Airzone device id
 * @returns {object} `{ device, feature(featureKey) }`
 */
export function zoneExternalIds(gladys, deviceId) {
  return gladys.externalIds(ZONE_SLUG, String(deviceId));
}

/**
 * Build the external ids of an Airzone air-quality sensor.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {string} deviceId Airzone device id
 * @returns {object} `{ device, feature(featureKey) }`
 */
export function airQualityExternalIds(gladys, deviceId) {
  return gladys.externalIds(AIR_QUALITY_SLUG, String(deviceId));
}

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} zone Airzone zone entry (annotated with installationId + status)
 * @returns {object} Gladys discovered device
 */
export function convertDevice(gladys, zone) {
  const ids = zoneExternalIds(gladys, zone.device_id);

  return {
    name: zone.name || String(zone.device_id),
    external_id: ids.device,
    // The Airzone Cloud API does not expose an AC model name; the connected
    // webserver firmware type is the closest hardware descriptor available.
    model: zone.ws_type || null,
    poll_frequency: POLL_FREQUENCY,
    should_poll: true,
    features: buildZoneFeatures(ids, zone),
    params: [
      {
        name: INSTALLATION_ID_PARAM,
        value: zone.installationId,
      },
    ],
  };
}

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} sensor Airzone air-quality sensor entry (installationId + status)
 * @returns {object} Gladys discovered device
 */
export function convertAirQualitySensor(gladys, sensor) {
  const ids = airQualityExternalIds(gladys, sensor.device_id);

  return {
    name: sensor.name || 'Air quality',
    external_id: ids.device,
    model: sensor.ws_type || null,
    poll_frequency: POLL_FREQUENCY,
    should_poll: true,
    features: buildAirQualityFeatures(ids),
    params: [
      {
        name: INSTALLATION_ID_PARAM,
        value: sensor.installationId,
      },
    ],
  };
}

/**
 * Read the Airzone installationId stored in the device params.
 * @param {object} device Gladys device (as sent with poll / set-value commands)
 * @returns {string} the installationId
 */
export function getInstallationId(device) {
  const param = (device.params || []).find(({ name }) => name === INSTALLATION_ID_PARAM);
  if (!param) {
    throw new Error(
      `Airzone device "${device.external_id}" has no "${INSTALLATION_ID_PARAM}" param`,
    );
  }
  return param.value;
}

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

export const INSTALLATION_ID_PARAM = 'installationId';

const ZONE_SLUG = 'zone';

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} zone Airzone zone entry (annotated with installationId + status)
 * @returns {object} Gladys discovered device
 */
export function convertDevice(gladys, zone) {
  const ids = gladys.externalIds(ZONE_SLUG, String(zone.device_id));

  return {
    name: zone.name || String(zone.device_id),
    external_id: ids.device,
    // The Airzone Cloud API does not expose an AC model name; the connected
    // webserver firmware type is the closest hardware descriptor available.
    model: zone.ws_type || null,
    poll_frequency: POLL_FREQUENCY,
    should_poll: true,
    features: buildZoneFeatures(ids.device, zone),
    params: [
      {
        name: INSTALLATION_ID_PARAM,
        value: zone.installationId,
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

// -----------------------------------------------------------------------------
// Plumbing shared by every Airzone device type.
//
// External id scheme (built with gladys.externalIds(), mandatory prefix
// `ext:<selector>:`):
//   device  -> ext:<selector>:<slug>:<deviceId>   e.g. ext:airzone-cloud:zone:abc
//   feature -> ext:<selector>:<slug>:<deviceId>:<featureCode>
//
// The Airzone installationId is stored as a device param: Gladys sends the
// params back with every poll / set-value command, and the status / command
// endpoints require it.
// -----------------------------------------------------------------------------

export const INSTALLATION_ID_PARAM = 'installationId';

/**
 * Build the external ids (device + feature factory) of an Airzone device.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {string} slug device type slug (`zone`, `airq`)
 * @param {string} deviceId Airzone device id
 * @returns {object} `{ device, feature(featureKey) }`
 */
export function externalIds(gladys, slug, deviceId) {
  return gladys.externalIds(slug, String(deviceId));
}

/**
 * Split a device external id (`ext:<selector>:<slug>:<deviceId>`) into its type
 * slug and Airzone device id.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {string} externalId the device external id
 * @returns {{ slug: string, deviceId: string }}
 */
export function parseDeviceExternalId(gladys, externalId) {
  const prefix = gladys.externalId('');
  if (!externalId || !externalId.startsWith(prefix)) {
    throw new Error(
      `Airzone device external_id is invalid: "${externalId}" should start with "${prefix}"`,
    );
  }
  const parts = externalId.slice(prefix.length).split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Airzone device external_id is invalid: "${externalId}" should be "${prefix}<slug>:<deviceId>"`,
    );
  }
  return { slug: parts[0], deviceId: parts[1] };
}

/**
 * Stamp an explicit, globally-unique selector on each feature.
 *
 * A Gladys device-feature `selector` is UNIQUE across the whole instance. When
 * a feature is published without one, Gladys derives it from the name
 * (e.g. "Power" -> "power"), which collides with any other device/integration
 * exposing a feature with the same name. Basing it on the already-unique
 * external_id (Gladys slugifies it, e.g. "ext-airzone-cloud-zone-<id>-power")
 * keeps it globally unique.
 * @param {Array} features Gladys features (each with an external_id)
 * @returns {Array} the same features, each carrying a unique `selector`
 */
export function withFeatureSelectors(features) {
  return features.map((feature) => ({ ...feature, selector: feature.external_id }));
}

/**
 * The device param carrying the Airzone installation id.
 * @param {object} entry Airzone device entry (annotated with installationId)
 * @returns {Array} Gladys device params
 */
export function buildDeviceParams(entry) {
  return [{ name: INSTALLATION_ID_PARAM, value: entry.installationId }];
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

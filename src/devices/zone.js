// -----------------------------------------------------------------------------
// Device type: AIRZONE ZONE (az_zone).
//
// Exposes five features:
//   - power            (air-conditioning / binary)
//   - mode             (air-conditioning / mode, master zone only)
//   - temperature      (air-conditioning / target-temperature)
//   - room-temperature (temperature-sensor / decimal, read-only)
//   - humidity         (humidity-sensor / decimal, read-only)
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_TRANSPORTS,
} from '@gladysassistant/integration-sdk';

import { airzone } from '../airzone/client.js';
import { airzoneLocal } from '../airzone/localClient.js';
import { describeError } from '../errors.js';
import {
  AC_MODE,
  AIRZONE_MODE,
  AIRZONE_PARAM,
  AIRZONE_UNITS,
  DEFAULT_TEMPERATURE_BOUNDS,
  FEATURE_CODES,
  HUMIDITY_BOUNDS,
  MODE_TEMPERATURE_FIELDS,
  POLL_FREQUENCY,
  ROOM_TEMPERATURE_BOUNDS,
} from '../constants.js';
import {
  buildDeviceParams,
  externalIds,
  getLocalZoneAddress,
  withFeatureSelectors,
} from './common.js';
import { buildLocalPollStates, buildLocalSetChange } from './zoneLocal.js';

export const ZONE_SLUG = 'zone';

const logger = createLogger({ name: ZONE_SLUG });

// Airzone operation mode <-> Gladys AC_MODE (STOP is power off, not a mode).
const MODES_AIRZONE_TO_GLADYS = {
  [AIRZONE_MODE.COOLING]: AC_MODE.COOLING,
  [AIRZONE_MODE.HEATING]: AC_MODE.HEATING,
  [AIRZONE_MODE.FAN]: AC_MODE.FAN,
  [AIRZONE_MODE.DRY]: AC_MODE.DRYING,
  [AIRZONE_MODE.AUTO]: AC_MODE.AUTO,
};

const MODES_GLADYS_TO_AIRZONE = {
  [AC_MODE.COOLING]: AIRZONE_MODE.COOLING,
  [AC_MODE.HEATING]: AIRZONE_MODE.HEATING,
  [AC_MODE.FAN]: AIRZONE_MODE.FAN,
  [AC_MODE.DRYING]: AIRZONE_MODE.DRY,
  [AC_MODE.AUTO]: AIRZONE_MODE.AUTO,
};

/**
 * Read a scalar value from an Airzone zone status. Values may be delivered
 * either directly or wrapped in a `{ value }` object.
 * @param {object} status Airzone zone status
 * @param {string} name status field name (e.g. 'power', 'mode')
 * @returns {*} the value, or undefined if absent
 */
export function getParam(status, name) {
  const raw = (status || {})[name];
  if (raw !== null && typeof raw === 'object' && 'value' in raw) {
    return raw.value;
  }
  return raw;
}

/**
 * Read a temperature value from an Airzone zone status. Airzone delivers
 * temperatures as `{ celsius, fah }` objects (and, defensively, sometimes as a
 * `{ value }` object or a bare number).
 * @param {object} status Airzone zone status
 * @param {string} name status field name (e.g. 'local_temp', 'setpoint_air_cool')
 * @returns {number|undefined} the Celsius value, or undefined if absent
 */
export function getTemperature(status, name) {
  const raw = (status || {})[name];
  if (raw !== null && typeof raw === 'object') {
    if ('celsius' in raw) return raw.celsius;
    if ('value' in raw) return raw.value;
    return undefined;
  }
  return raw;
}

/**
 * The Airzone status/range fields for the zone's current operation mode.
 * Falls back to the cooling fields when the mode is unknown.
 * @param {object} status Airzone zone status
 * @returns {{ setpoint: string, rangeMin: string, rangeMax: string }}
 */
function modeTemperatureFields(status) {
  const modeCode = toNumber(getParam(status, 'mode'));
  return MODE_TEMPERATURE_FIELDS[modeCode] || MODE_TEMPERATURE_FIELDS[AIRZONE_MODE.COOLING];
}

/**
 * Whether the zone controls the system operation mode (only the master zone of
 * a system does — it is the one advertising the list of available modes).
 * @param {object} status Airzone zone status
 * @returns {boolean}
 */
function controlsMode(status) {
  return Array.isArray((status || {}).mode_available);
}

/**
 * Parse a value into a number.
 * @param {*} value the raw value
 * @returns {number|null} the parsed number, or null if not parseable
 */
function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Compute the target temperature bounds from the zone status.
 * @param {object} status Airzone zone status
 * @returns {{ min: number, max: number }} the temperature bounds
 */
function getTemperatureBounds(status) {
  const fields = modeTemperatureFields(status);
  const min = toNumber(getTemperature(status, fields.rangeMin));
  const max = toNumber(getTemperature(status, fields.rangeMax));
  return {
    min: min ?? DEFAULT_TEMPERATURE_BOUNDS.MIN,
    max: max ?? DEFAULT_TEMPERATURE_BOUNDS.MAX,
  };
}

/**
 * Build the Gladys features of an Airzone zone.
 * @param {object} ids external ids of the Gladys device (from gladys.externalIds()):
 *   `{ device, feature(featureKey) }`
 * @param {object} zone Airzone zone entry (annotated with a `status` object)
 * @returns {Array} Gladys device features
 */
export function buildZoneFeatures(ids, zone) {
  const { min, max } = getTemperatureBounds(zone.status);
  const features = [
    {
      name: 'Power',
      external_id: ids.feature(FEATURE_CODES.POWER),
      read_only: false,
      has_feedback: true,
      min: 0,
      max: 1,
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY,
    },
  ];

  // The operation mode is shared by every zone of a system and can only be
  // changed on the master zone (the one advertising `mode_available`). Only
  // that zone gets a controllable Mode feature.
  if (controlsMode(zone.status)) {
    features.push({
      name: 'Mode',
      external_id: ids.feature(FEATURE_CODES.MODE),
      read_only: false,
      has_feedback: true,
      min: 0,
      max: 1,
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE,
    });
  }

  features.push(
    {
      name: 'Temperature',
      external_id: ids.feature(FEATURE_CODES.TEMPERATURE),
      read_only: false,
      has_feedback: true,
      min,
      max,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE,
    },
    {
      name: 'Room temperature',
      external_id: ids.feature(FEATURE_CODES.ROOM_TEMPERATURE),
      read_only: true,
      keep_history: true,
      has_feedback: false,
      min: ROOM_TEMPERATURE_BOUNDS.MIN,
      max: ROOM_TEMPERATURE_BOUNDS.MAX,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    },
    {
      name: 'Humidity',
      external_id: ids.feature(FEATURE_CODES.HUMIDITY),
      read_only: true,
      keep_history: true,
      has_feedback: false,
      min: HUMIDITY_BOUNDS.MIN,
      max: HUMIDITY_BOUNDS.MAX,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    },
  );

  return features;
}

/**
 * Build the Gladys states of the features from a zone status. States without a
 * known value (e.g. an unknown Airzone mode) are skipped.
 * @param {object} ids external ids of the Gladys device (from gladys.externalIds()):
 *   `{ device, feature(featureKey) }`
 * @param {object} status Airzone zone status
 * @returns {Array} states for gladys.publishStates()
 */
export function buildPollStates(ids, status) {
  const fields = modeTemperatureFields(status);
  const states = [
    {
      device_feature_external_id: ids.feature(FEATURE_CODES.POWER),
      state: getParam(status, 'power') ? 1 : 0,
    },
    {
      device_feature_external_id: ids.feature(FEATURE_CODES.TEMPERATURE),
      state: toNumber(getTemperature(status, fields.setpoint)),
    },
    {
      device_feature_external_id: ids.feature(FEATURE_CODES.ROOM_TEMPERATURE),
      state: toNumber(getTemperature(status, 'local_temp')),
    },
    {
      device_feature_external_id: ids.feature(FEATURE_CODES.HUMIDITY),
      state: toNumber(getParam(status, 'humidity')),
    },
  ];

  // The Mode feature only exists on the master zone (see buildZoneFeatures), so
  // only report a mode state for that zone.
  if (controlsMode(status)) {
    const mode = MODES_AIRZONE_TO_GLADYS[toNumber(getParam(status, 'mode'))];
    states.push({
      device_feature_external_id: ids.feature(FEATURE_CODES.MODE),
      state: mode === undefined ? null : mode,
    });
  }

  return states.filter((state) => state.state !== null && state.state !== undefined);
}

// Zones already reported as publishing no temperature (a poll runs every
// minute: warn once, and again only if it starts working then stops).
const temperatureWarnings = new Set();

/**
 * Warn when a poll publishes no room temperature: either Airzone does not
 * deliver `local_temp` for this zone (no thermostat), or it names the field
 * differently — the status field names make it possible to tell.
 * @param {object} device the Gladys device being polled
 * @param {object} status the Airzone zone status
 * @param {Array} states the states about to be published
 */
function warnAboutMissingRoomTemperature(device, status, states) {
  const hasRoomTemperature = states.some(({ device_feature_external_id: id }) =>
    id.endsWith(`:${FEATURE_CODES.ROOM_TEMPERATURE}`),
  );
  if (hasRoomTemperature) {
    temperatureWarnings.delete(device.external_id);
    return;
  }
  if (temperatureWarnings.has(device.external_id)) {
    return;
  }
  temperatureWarnings.add(device.external_id);
  logger.warn(
    `The zone "${device.selector || device.external_id}" reports no room temperature ` +
      `(no usable "local_temp"). Status fields: ${Object.keys(status || {}).join(', ')}`,
  );
}

/**
 * Build the change to send to Airzone for a Gladys command. Returns null when
 * the feature is not controllable.
 * @param {string} featureCode last segment of the feature external id
 * @param {number} value value sent by Gladys
 * @returns {{ param: string, value: *, opts?: object }|null} the change
 */
export function buildSetZoneChange(featureCode, value) {
  switch (featureCode) {
    case FEATURE_CODES.POWER:
      return { param: AIRZONE_PARAM.POWER, value: value === 1 };
    case FEATURE_CODES.MODE: {
      const mode = MODES_GLADYS_TO_AIRZONE[value];
      return mode === undefined ? null : { param: AIRZONE_PARAM.MODE, value: mode };
    }
    case FEATURE_CODES.TEMPERATURE:
      // The API rejects a setpoint write without the temperature unit.
      return { param: AIRZONE_PARAM.SETPOINT, value, opts: { units: AIRZONE_UNITS.CELSIUS } };
    default:
      return null;
  }
}

// Last local status of each zone, kept for the temperature unit a setpoint write
// needs (the local API expects the value in the unit of the installation).
const lastLocalStatus = new Map();

/**
 * The local API address of a zone, when the local API can and should be used:
 * configured by the user, preferred, not in a post-failure cooldown, and the
 * device knows its system/zone numbers.
 * @param {object} device the Gladys device
 * @param {object} config the integration config
 * @returns {{ systemId: number, zoneId: number }|null} the address, or null to
 *   go through the cloud
 */
function localAddressOf(device, config) {
  if (!config.prefer_local || !airzoneLocal.isUsable()) {
    return null;
  }
  const address = getLocalZoneAddress(device);
  if (!address) {
    logger.debug(
      `${device.external_id} has no system/zone number: staying on the cloud API ` +
        '(republish the devices to get them)',
    );
    return null;
  }
  return address;
}

// --- Device type registry entry ----------------------------------------------

export const zoneDevice = {
  slug: ZONE_SLUG,

  /**
   * Build the Gladys discovery payload of one Airzone zone.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {object} entry Airzone zone entry (installationId + status)
   * @returns {object} Gladys discovered device
   */
  buildDevice(gladys, entry) {
    const ids = externalIds(gladys, ZONE_SLUG, entry.device_id);
    return {
      name: entry.name || String(entry.device_id),
      external_id: ids.device,
      // The Airzone Cloud API does not expose an AC model name; the connected
      // webserver firmware type is the closest hardware descriptor available.
      model: entry.ws_type || null,
      poll_frequency: POLL_FREQUENCY,
      should_poll: true,
      features: withFeatureSelectors(buildZoneFeatures(ids, entry)),
      params: buildDeviceParams(entry),
    };
  },

  /**
   * Refresh one zone: read its status — through the local API when it is
   * available, otherwise through the cloud — and publish its states.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {object} context `{ device, deviceId, installationId, config }`
   * @returns {Promise<object>} the channel actually used, for the transport badge
   */
  async onPoll(gladys, { device, deviceId, installationId, config }) {
    const ids = externalIds(gladys, ZONE_SLUG, deviceId);
    const local = localAddressOf(device, config);
    let fallbackReason = null;

    if (local) {
      try {
        const status = await airzoneLocal.getZoneStatus(local.systemId, local.zoneId);
        lastLocalStatus.set(device.external_id, status);
        const states = buildLocalPollStates(ids, status);
        warnAboutMissingRoomTemperature(device, status, states);
        logger.debug(`Polled ${device.external_id} locally -> ${states.length} states`);
        if (states.length > 0) {
          await gladys.publishStates(states);
        }
        return { transport: DEVICE_TRANSPORTS.LOCAL };
      } catch (err) {
        // The webserver is off, rebooting or its local API got disabled: fall
        // back to the cloud and stop trying locally for a while.
        fallbackReason = describeError(err);
        airzoneLocal.noteFailure();
        logger.warn(
          `Local API failed for ${device.external_id} (${fallbackReason}): falling back to the Airzone Cloud API`,
        );
      }
    }

    const status = await airzone.getZoneStatus(deviceId, installationId);
    const states = buildPollStates(ids, status);
    warnAboutMissingRoomTemperature(device, status, states);
    logger.debug(`Polled ${device.external_id} -> ${states.length} states`);
    if (states.length > 0) {
      await gladys.publishStates(states);
    }
    if (fallbackReason) {
      return {
        transport: DEVICE_TRANSPORTS.CLOUD,
        degraded: true,
        message: {
          en: `Local API unreachable, using the cloud: ${fallbackReason}`.slice(0, 200),
          fr: `API locale injoignable, passage par le cloud : ${fallbackReason}`.slice(0, 200),
        },
      };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  },

  /**
   * Run a user command on a zone feature, through the local API when available.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {object} context `{ device, deviceId, installationId, feature, value, config }`
   */
  async onSetValue(gladys, { device, deviceId, installationId, feature, value, config }) {
    const featureCode = feature.external_id.split(':').pop();
    const local = localAddressOf(device, config);

    if (local) {
      const localChange = buildLocalSetChange(
        featureCode,
        value,
        lastLocalStatus.get(device.external_id),
      );
      if (!localChange) {
        throw new Error(`Airzone feature "${feature.external_id}" is not controllable`);
      }
      try {
        await airzoneLocal.setZoneParam(local.systemId, local.zoneId, localChange);
        logger.debug(`Wrote ${feature.external_id} locally`);
        return;
      } catch (err) {
        // A refused command is worth retrying through the cloud: the user is
        // waiting for their action to happen.
        airzoneLocal.noteFailure();
        logger.warn(
          `Local API failed for ${feature.external_id} (${describeError(err)}): retrying through the Airzone Cloud API`,
        );
      }
    }

    const change = buildSetZoneChange(featureCode, value);
    if (!change) {
      throw new Error(`Airzone feature "${feature.external_id}" is not controllable`);
    }
    await airzone.setZoneParam(deviceId, installationId, change);
  },

  // Channel a zone is expected to use. The poll refines it with what it ACTUALLY
  // used (and flags a cloud fallback as degraded).
  transport(gladys, config) {
    return config.prefer_local && airzoneLocal.isConfigured()
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.CLOUD;
  },
};

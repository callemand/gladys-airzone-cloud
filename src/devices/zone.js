// -----------------------------------------------------------------------------
// Airzone zone (az_zone).
//
// Exposes four features:
//   - power            (air-conditioning / binary)
//   - mode             (air-conditioning / mode)
//   - temperature      (air-conditioning / target-temperature)
//   - room-temperature (temperature-sensor / decimal, read-only)
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  AC_MODE,
  AIRZONE_MODE,
  AIRZONE_PARAM,
  DEFAULT_TEMPERATURE_BOUNDS,
  FEATURE_CODES,
  ROOM_TEMPERATURE_BOUNDS,
} from '../constants.js';

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
 * Read a value from an Airzone zone status. Values may be delivered either
 * directly or wrapped in a `{ value }` object.
 * @param {object} status Airzone zone status
 * @param {string} name status field name (e.g. 'power', 'setpoint')
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
  const min =
    toNumber(getParam(status, 'range_sp_min')) ?? toNumber(getParam(status, 'range_air_min'));
  const max =
    toNumber(getParam(status, 'range_sp_max')) ?? toNumber(getParam(status, 'range_air_max'));
  return {
    min: min ?? DEFAULT_TEMPERATURE_BOUNDS.MIN,
    max: max ?? DEFAULT_TEMPERATURE_BOUNDS.MAX,
  };
}

/**
 * Build the Gladys features of an Airzone zone.
 * @param {string} externalId external id of the Gladys device
 * @param {object} zone Airzone zone entry (annotated with a `status` object)
 * @returns {Array} Gladys device features
 */
export function buildZoneFeatures(externalId, zone) {
  const { min, max } = getTemperatureBounds(zone.status);
  return [
    {
      name: 'Power',
      external_id: `${externalId}:${FEATURE_CODES.POWER}`,
      read_only: false,
      has_feedback: true,
      min: 0,
      max: 1,
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY,
    },
    {
      name: 'Mode',
      external_id: `${externalId}:${FEATURE_CODES.MODE}`,
      read_only: false,
      has_feedback: true,
      min: 0,
      max: 1,
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE,
    },
    {
      name: 'Temperature',
      external_id: `${externalId}:${FEATURE_CODES.TEMPERATURE}`,
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
      external_id: `${externalId}:${FEATURE_CODES.ROOM_TEMPERATURE}`,
      read_only: true,
      keep_history: true,
      has_feedback: false,
      min: ROOM_TEMPERATURE_BOUNDS.MIN,
      max: ROOM_TEMPERATURE_BOUNDS.MAX,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    },
  ];
}

/**
 * Build the Gladys states of the features from a zone status. States without a
 * known value (e.g. an unknown Airzone mode) are skipped.
 * @param {string} deviceExternalId external id of the Gladys device
 * @param {object} status Airzone zone status
 * @returns {Array} states for gladys.publishStates()
 */
export function buildPollStates(deviceExternalId, status) {
  const mode = MODES_AIRZONE_TO_GLADYS[toNumber(getParam(status, 'mode'))];
  return [
    {
      device_feature_external_id: `${deviceExternalId}:${FEATURE_CODES.POWER}`,
      state: getParam(status, 'power') ? 1 : 0,
    },
    {
      device_feature_external_id: `${deviceExternalId}:${FEATURE_CODES.MODE}`,
      state: mode === undefined ? null : mode,
    },
    {
      device_feature_external_id: `${deviceExternalId}:${FEATURE_CODES.TEMPERATURE}`,
      state: toNumber(getParam(status, 'setpoint')),
    },
    {
      device_feature_external_id: `${deviceExternalId}:${FEATURE_CODES.ROOM_TEMPERATURE}`,
      state: toNumber(getParam(status, 'local_temp')),
    },
  ].filter((state) => state.state !== null && state.state !== undefined);
}

/**
 * Build the change to send to Airzone for a Gladys command. Returns null when
 * the feature is not controllable.
 * @param {string} featureCode last segment of the feature external id
 * @param {number} value value sent by Gladys
 * @returns {{ param: string, value: * }|null} the change
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
      return { param: AIRZONE_PARAM.SETPOINT, value };
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Translation between the Airzone LOCAL API and the Gladys features of a zone.
//
// The local API describes the same zone as the cloud, with other names, other
// mode codes and plain numbers instead of `{ celsius, fah }` objects:
//
//   { systemID, zoneID, name, on, mode, modes, setpoint, roomTemp, humidity,
//     maxTemp, minTemp, units }
//
// The Gladys side is unchanged (same features, same external ids, same units):
// only the source of the values changes.
// -----------------------------------------------------------------------------

import {
  AC_MODE,
  AIRZONE_LOCAL_FIELD,
  AIRZONE_LOCAL_MODE,
  AIRZONE_LOCAL_UNITS,
  FEATURE_CODES,
} from '../constants.js';

// Local operation mode <-> Gladys AC_MODE. STOP is power off, not a mode, and
// AUX_HEATING is reported as plain heating (Gladys has no separate mode for it).
const MODES_LOCAL_TO_GLADYS = {
  [AIRZONE_LOCAL_MODE.COOLING]: AC_MODE.COOLING,
  [AIRZONE_LOCAL_MODE.HEATING]: AC_MODE.HEATING,
  [AIRZONE_LOCAL_MODE.AUX_HEATING]: AC_MODE.HEATING,
  [AIRZONE_LOCAL_MODE.FAN]: AC_MODE.FAN,
  [AIRZONE_LOCAL_MODE.DRY]: AC_MODE.DRYING,
  [AIRZONE_LOCAL_MODE.AUTO]: AC_MODE.AUTO,
};

const MODES_GLADYS_TO_LOCAL = {
  [AC_MODE.COOLING]: AIRZONE_LOCAL_MODE.COOLING,
  [AC_MODE.HEATING]: AIRZONE_LOCAL_MODE.HEATING,
  [AC_MODE.FAN]: AIRZONE_LOCAL_MODE.FAN,
  [AC_MODE.DRYING]: AIRZONE_LOCAL_MODE.DRY,
  [AC_MODE.AUTO]: AIRZONE_LOCAL_MODE.AUTO,
};

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
 * Whether the zone reports its temperatures in Fahrenheit.
 * @param {object} status local zone status
 * @returns {boolean}
 */
export function isFahrenheit(status) {
  return toNumber((status || {})[AIRZONE_LOCAL_FIELD.UNITS]) === AIRZONE_LOCAL_UNITS.FAHRENHEIT;
}

/**
 * Convert a Fahrenheit temperature to Celsius (Gladys stores Celsius).
 * @param {number} fahrenheit the temperature in °F
 * @returns {number} the temperature in °C, rounded to one decimal
 */
export function toCelsius(fahrenheit) {
  return Math.round((((fahrenheit - 32) * 5) / 9) * 10) / 10;
}

/**
 * Convert a Celsius temperature to Fahrenheit (for a setpoint write on an
 * installation configured in °F).
 * @param {number} celsius the temperature in °C
 * @returns {number} the temperature in °F, rounded to one decimal
 */
export function toFahrenheit(celsius) {
  return Math.round(((celsius * 9) / 5 + 32) * 10) / 10;
}

/**
 * Read a temperature from a local zone status, in Celsius.
 * @param {object} status local zone status
 * @param {string} field status field name
 * @returns {number|null} the Celsius value, or null if absent
 */
function readTemperature(status, field) {
  const value = toNumber((status || {})[field]);
  if (value === null) {
    return null;
  }
  return isFahrenheit(status) ? toCelsius(value) : value;
}

/**
 * Whether the zone controls the system operation mode (the master zone is the
 * one advertising the list of available modes — same rule as the cloud).
 * @param {object} status local zone status
 * @returns {boolean}
 */
function controlsMode(status) {
  return Array.isArray((status || {})[AIRZONE_LOCAL_FIELD.MODES]);
}

/**
 * Build the Gladys states of a zone from a LOCAL API status. States without a
 * known value are skipped.
 * @param {object} ids external ids of the Gladys device (from gladys.externalIds()):
 *   `{ device, feature(featureKey) }`
 * @param {object} status local zone status
 * @returns {Array} states for gladys.publishStates()
 */
export function buildLocalPollStates(ids, status) {
  const states = [
    {
      device_feature_external_id: ids.feature(FEATURE_CODES.POWER),
      state: toNumber((status || {})[AIRZONE_LOCAL_FIELD.ON]) ? 1 : 0,
    },
    {
      device_feature_external_id: ids.feature(FEATURE_CODES.TEMPERATURE),
      state: readTemperature(status, AIRZONE_LOCAL_FIELD.SET_POINT),
    },
    {
      device_feature_external_id: ids.feature(FEATURE_CODES.ROOM_TEMPERATURE),
      state: readTemperature(status, AIRZONE_LOCAL_FIELD.ROOM_TEMP),
    },
    {
      device_feature_external_id: ids.feature(FEATURE_CODES.HUMIDITY),
      state: toNumber((status || {})[AIRZONE_LOCAL_FIELD.HUMIDITY]),
    },
  ];

  // The Mode feature only exists on the master zone (see buildZoneFeatures).
  if (controlsMode(status)) {
    const mode = MODES_LOCAL_TO_GLADYS[toNumber((status || {})[AIRZONE_LOCAL_FIELD.MODE])];
    states.push({
      device_feature_external_id: ids.feature(FEATURE_CODES.MODE),
      state: mode === undefined ? null : mode,
    });
  }

  return states.filter((state) => state.state !== null && state.state !== undefined);
}

/**
 * Build the change to send to the LOCAL API for a Gladys command. Returns null
 * when the feature is not controllable.
 * @param {string} featureCode last segment of the feature external id
 * @param {number} value value sent by Gladys
 * @param {object} [status] last known local status (for the temperature unit)
 * @returns {object|null} the body fields to send
 */
export function buildLocalSetChange(featureCode, value, status) {
  switch (featureCode) {
    case FEATURE_CODES.POWER:
      return { [AIRZONE_LOCAL_FIELD.ON]: value === 1 ? 1 : 0 };
    case FEATURE_CODES.MODE: {
      const mode = MODES_GLADYS_TO_LOCAL[value];
      return mode === undefined ? null : { [AIRZONE_LOCAL_FIELD.MODE]: mode };
    }
    case FEATURE_CODES.TEMPERATURE:
      // The local API expects the setpoint in the unit the installation uses.
      return {
        [AIRZONE_LOCAL_FIELD.SET_POINT]: isFahrenheit(status) ? toFahrenheit(value) : value,
      };
    default:
      return null;
  }
}

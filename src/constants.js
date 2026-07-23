// -----------------------------------------------------------------------------
// Airzone Cloud protocol constants + the few Gladys values the SDK does not
// export.
//
// The standard Gladys feature categories / types / units come straight from
// the SDK (DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES,
// DEVICE_FEATURE_UNITS) — only integration-specific values live here.
// -----------------------------------------------------------------------------

// Gladys air-conditioning modes (server/utils/constants.js: AC_MODE).
export const AC_MODE = {
  AUTO: 0,
  COOLING: 1,
  HEATING: 2,
  DRYING: 3,
  FAN: 4,
};

// Gladys temperature sensor bounds for the (read-only) room temperature.
export const ROOM_TEMPERATURE_BOUNDS = {
  MIN: -10,
  MAX: 50,
};

// Fallback target temperature bounds when the zone does not report its range.
export const DEFAULT_TEMPERATURE_BOUNDS = {
  MIN: 10,
  MAX: 30,
};

// Devices are polled every 10 seconds, like the built-in cloud services
// (must be one of the Gladys DEVICE_POLL_FREQUENCIES values, in milliseconds).
export const POLL_FREQUENCY = 10 * 1000;

// Airzone Cloud API. The env var override is only used by the test suite.
export const AIRZONE_ENDPOINT = (
  process.env.AIRZONE_ENDPOINT || 'https://m.airzonecloud.com/api/v1'
).replace(/\/+$/, '');

// Airzone device types delivered by the API. Only zones are exposed here;
// systems are used to enumerate their child zones.
export const AIRZONE_DEVICE_TYPES = {
  SYSTEM: 'az_system',
  ZONE: 'az_zone',
};

// Airzone operation mode codes (as delivered/accepted over the REST API).
export const AIRZONE_MODE = {
  STOP: 1,
  COOLING: 2,
  HEATING: 3,
  FAN: 4,
  DRY: 5,
  AUTO: 7,
};

// Command parameter names accepted by PATCH /devices/{id}.
export const AIRZONE_PARAM = {
  POWER: 'power',
  MODE: 'mode',
  SETPOINT: 'setpoint',
};

// Feature suffixes used in the feature external ids
// (`ext:<selector>:zone:<deviceId>:<code>`).
export const FEATURE_CODES = {
  POWER: 'power',
  MODE: 'mode',
  TEMPERATURE: 'temperature',
  ROOM_TEMPERATURE: 'room-temperature',
};

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

// Relative humidity sensor bounds (percent).
export const HUMIDITY_BOUNDS = {
  MIN: 0,
  MAX: 100,
};

// Particulate-matter sensor bounds (µg/m³).
export const PM_BOUNDS = {
  MIN: 0,
  MAX: 1000,
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
// Values match aioairzone-cloud's OperationMode enum (verified against the live
// Airzone Cloud API).
export const AIRZONE_MODE = {
  STOP: 0,
  AUTO: 1,
  COOLING: 2,
  HEATING: 3,
  FAN: 4,
  DRY: 5,
};

// Command parameter names accepted by PATCH /devices/{id}. The generic
// "setpoint" writes the target temperature of the zone's current mode.
export const AIRZONE_PARAM = {
  POWER: 'power',
  MODE: 'mode',
  SETPOINT: 'setpoint',
};

// Temperature unit code sent in the PATCH `opts` object (required by the API
// for setpoint writes). 0 = Celsius, 1 = Fahrenheit.
export const AIRZONE_UNITS = {
  CELSIUS: 0,
  FAHRENHEIT: 1,
};

// The Airzone status exposes the target setpoint and its allowed range per
// operation mode, in dedicated fields. Note the asymmetric naming: the heating
// setpoint field is "heat" while its range field is "hot". All values are
// delivered as { celsius, fah } objects.
export const MODE_TEMPERATURE_FIELDS = {
  [AIRZONE_MODE.STOP]: {
    setpoint: 'setpoint_air_stop',
    rangeMin: 'range_sp_stop_air_min',
    rangeMax: 'range_sp_stop_air_max',
  },
  [AIRZONE_MODE.AUTO]: {
    setpoint: 'setpoint_air_auto',
    rangeMin: 'range_sp_auto_air_min',
    rangeMax: 'range_sp_auto_air_max',
  },
  [AIRZONE_MODE.COOLING]: {
    setpoint: 'setpoint_air_cool',
    rangeMin: 'range_sp_cool_air_min',
    rangeMax: 'range_sp_cool_air_max',
  },
  [AIRZONE_MODE.HEATING]: {
    setpoint: 'setpoint_air_heat',
    rangeMin: 'range_sp_hot_air_min',
    rangeMax: 'range_sp_hot_air_max',
  },
  [AIRZONE_MODE.FAN]: {
    setpoint: 'setpoint_air_vent',
    rangeMin: 'range_sp_vent_air_min',
    rangeMax: 'range_sp_vent_air_max',
  },
  [AIRZONE_MODE.DRY]: {
    setpoint: 'setpoint_air_dry',
    rangeMin: 'range_sp_dry_air_min',
    rangeMax: 'range_sp_dry_air_max',
  },
};

// Feature suffixes used in the feature external ids
// (`ext:<selector>:zone:<deviceId>:<code>`).
export const FEATURE_CODES = {
  POWER: 'power',
  MODE: 'mode',
  TEMPERATURE: 'temperature',
  ROOM_TEMPERATURE: 'room-temperature',
  HUMIDITY: 'humidity',
  PM25: 'pm25',
  PM10: 'pm10',
};

// Air-quality feature code -> Airzone status field. Particulate readings are
// only exposed when the zone actually reports a numeric value (many units
// advertise `aq_present` but ship no particulate sensor -> null forever).
export const AIR_QUALITY_FIELDS = {
  [FEATURE_CODES.PM25]: 'aqpm2_5',
  [FEATURE_CODES.PM10]: 'aqpm10',
};

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

// Air-quality sensor bounds.
export const PM_BOUNDS = { MIN: 0, MAX: 1000 }; // µg/m³
export const CO2_BOUNDS = { MIN: 0, MAX: 5000 }; // ppm
export const TVOC_BOUNDS = { MIN: 0, MAX: 60000 }; // ppb
export const PRESSURE_BOUNDS = { MIN: 800, MAX: 1200 }; // hPa
export const AIR_QUALITY_INDEX_BOUNDS = { MIN: 0, MAX: 100 }; // Airzone aq_score

// Devices are polled every minute: the Airzone Cloud API rate-limits (HTTP 429)
// and every device poll is a separate request, so a tighter interval quickly
// exhausts the quota. Must be one of the Gladys DEVICE_POLL_FREQUENCIES values
// (in milliseconds); 60 s is the coarsest available.
export const POLL_FREQUENCY = 60 * 1000;

// Airzone Cloud API. The env var override is only used by the test suite.
export const AIRZONE_ENDPOINT = (
  process.env.AIRZONE_ENDPOINT || 'https://m.airzonecloud.com/api/v1'
).replace(/\/+$/, '');

// Airzone device types delivered by the API. Zones and air-quality sensors are
// exposed as Gladys devices; systems are used to enumerate their child zones.
export const AIRZONE_DEVICE_TYPES = {
  SYSTEM: 'az_system',
  ZONE: 'az_zone',
  AIR_QUALITY: 'az_airqsensor',
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
  // Air-quality sensor (az_airqsensor) features.
  CO2: 'co2',
  PM25: 'pm25',
  PM10: 'pm10',
  TVOC: 'tvoc',
  PRESSURE: 'pressure',
  AIR_QUALITY_INDEX: 'air-quality-index',
};

// -----------------------------------------------------------------------------
// Airzone LOCAL API (the webserver's own API, port 3000 by default).
//
// Read:  POST http://<ip>:<port>/api/v1/hvac  { systemID, zoneID } -> { data: [zone] }
// Write: PUT  http://<ip>:<port>/api/v1/hvac  { systemID, zoneID, <param>: value }
// Probe: POST http://<ip>:<port>/api/v1/version
//
// It has to be enabled on the webserver, it answers on the LAN only, and it is
// neither rate-limited nor tied to an Airzone Cloud subscription — which is why
// it is preferred over the cloud whenever it is configured.
// -----------------------------------------------------------------------------

export const AIRZONE_LOCAL_DEFAULT_PORT = 3000;
export const AIRZONE_LOCAL_PATHS = {
  HVAC: 'api/v1/hvac',
  VERSION: 'api/v1/version',
  WEBSERVER: 'api/v1/webserver',
};

// Operation mode codes of the LOCAL API. They do NOT match the cloud ones
// (AIRZONE_MODE above): the local API starts at 1 and puts AUTO at 7.
export const AIRZONE_LOCAL_MODE = {
  STOP: 1,
  COOLING: 2,
  HEATING: 3,
  FAN: 4,
  DRY: 5,
  AUX_HEATING: 6,
  AUTO: 7,
};

// Status/command field names of the local API.
export const AIRZONE_LOCAL_FIELD = {
  SYSTEM_ID: 'systemID',
  ZONE_ID: 'zoneID',
  ON: 'on',
  MODE: 'mode',
  MODES: 'modes',
  SET_POINT: 'setpoint',
  ROOM_TEMP: 'roomTemp',
  HUMIDITY: 'humidity',
  MAX_TEMP: 'maxTemp',
  MIN_TEMP: 'minTemp',
  UNITS: 'units',
};

// Temperature unit reported by the local API (`units` field).
export const AIRZONE_LOCAL_UNITS = {
  CELSIUS: 0,
  FAHRENHEIT: 1,
};

// The local network is fast: a request that takes longer than this is a webserver
// that is off, unreachable or has its local API disabled.
export const AIRZONE_LOCAL_TIMEOUT_MS = 3000;

// After a local failure, stop trying the local API for a while and use the cloud
// instead: a webserver rebooting must not slow every poll down.
export const AIRZONE_LOCAL_COOLDOWN_MS = 60 * 1000;

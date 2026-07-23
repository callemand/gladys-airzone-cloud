// -----------------------------------------------------------------------------
// Airzone air-quality sensor (az_airqsensor).
//
// A standalone device (separate from the zones) that measures the indoor air
// quality: temperature, humidity, CO2, particulate matter (PM2.5 / PM10),
// TVOC, atmospheric pressure and a global air-quality index (Airzone
// `aq_score`, 0-100). All features are read-only sensors with history.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  AIR_QUALITY_INDEX_BOUNDS,
  CO2_BOUNDS,
  FEATURE_CODES,
  HUMIDITY_BOUNDS,
  PM_BOUNDS,
  PRESSURE_BOUNDS,
  ROOM_TEMPERATURE_BOUNDS,
  TVOC_BOUNDS,
} from '../constants.js';

const { SENSOR } = DEVICE_FEATURE_TYPES;

// The sensors exposed by an az_airqsensor device. `celsius: true` marks the
// fields delivered as a `{ celsius, fah }` object (only aq_temp here).
const SENSORS = [
  {
    code: FEATURE_CODES.TEMPERATURE,
    name: 'Temperature',
    field: 'aq_temp',
    celsius: true,
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    min: ROOM_TEMPERATURE_BOUNDS.MIN,
    max: ROOM_TEMPERATURE_BOUNDS.MAX,
  },
  {
    code: FEATURE_CODES.HUMIDITY,
    name: 'Humidity',
    field: 'humidity',
    category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
    type: SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: HUMIDITY_BOUNDS.MIN,
    max: HUMIDITY_BOUNDS.MAX,
  },
  {
    code: FEATURE_CODES.CO2,
    name: 'CO2',
    field: 'aq_co2',
    category: DEVICE_FEATURE_CATEGORIES.CO2_SENSOR,
    type: SENSOR.INTEGER,
    unit: DEVICE_FEATURE_UNITS.PPM,
    min: CO2_BOUNDS.MIN,
    max: CO2_BOUNDS.MAX,
  },
  {
    code: FEATURE_CODES.PM25,
    name: 'PM2.5',
    field: 'aqpm2_5',
    category: DEVICE_FEATURE_CATEGORIES.PM25_SENSOR,
    type: SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER,
    min: PM_BOUNDS.MIN,
    max: PM_BOUNDS.MAX,
  },
  {
    code: FEATURE_CODES.PM10,
    name: 'PM10',
    field: 'aqpm10',
    category: DEVICE_FEATURE_CATEGORIES.PM10_SENSOR,
    type: SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER,
    min: PM_BOUNDS.MIN,
    max: PM_BOUNDS.MAX,
  },
  {
    code: FEATURE_CODES.TVOC,
    name: 'TVOC',
    field: 'aq_tvoc',
    category: DEVICE_FEATURE_CATEGORIES.VOC_SENSOR,
    type: SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.PPB,
    min: TVOC_BOUNDS.MIN,
    max: TVOC_BOUNDS.MAX,
  },
  {
    code: FEATURE_CODES.PRESSURE,
    name: 'Pressure',
    field: 'aq_pressure',
    category: DEVICE_FEATURE_CATEGORIES.PRESSURE_SENSOR,
    type: SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.HECTO_PASCAL,
    min: PRESSURE_BOUNDS.MIN,
    max: PRESSURE_BOUNDS.MAX,
  },
  {
    code: FEATURE_CODES.AIR_QUALITY_INDEX,
    name: 'Air quality index',
    field: 'aq_score',
    category: DEVICE_FEATURE_CATEGORIES.AIRQUALITY_SENSOR,
    type: DEVICE_FEATURE_TYPES.AIRQUALITY_SENSOR.AQI,
    unit: DEVICE_FEATURE_UNITS.AQI,
    min: AIR_QUALITY_INDEX_BOUNDS.MIN,
    max: AIR_QUALITY_INDEX_BOUNDS.MAX,
  },
];

/**
 * Read a sensor value from the air-quality status. Temperatures come as
 * `{ celsius }` objects, everything else as a bare number.
 * @param {object} status air-quality sensor status
 * @param {object} sensor a SENSORS entry
 * @returns {number|null} the numeric value, or null if absent/unparseable
 */
function readSensor(status, sensor) {
  let raw = (status || {})[sensor.field];
  if (sensor.celsius && raw !== null && typeof raw === 'object') {
    raw = 'celsius' in raw ? raw.celsius : undefined;
  }
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Build the Gladys features of an air-quality sensor.
 * @param {object} ids external ids of the Gladys device (from gladys.externalIds()):
 *   `{ device, feature(featureKey) }`
 * @returns {Array} Gladys device features
 */
export function buildAirQualityFeatures(ids) {
  return SENSORS.map((sensor) => ({
    name: sensor.name,
    external_id: ids.feature(sensor.code),
    read_only: true,
    keep_history: true,
    has_feedback: false,
    min: sensor.min,
    max: sensor.max,
    unit: sensor.unit,
    category: sensor.category,
    type: sensor.type,
  }));
}

/**
 * Build the Gladys states of an air-quality sensor from its status. Sensors
 * without a value are skipped.
 * @param {object} ids external ids of the Gladys device
 * @param {object} status air-quality sensor status
 * @returns {Array} states for gladys.publishStates()
 */
export function buildAirQualityPollStates(ids, status) {
  return SENSORS.map((sensor) => ({
    device_feature_external_id: ids.feature(sensor.code),
    state: readSensor(status, sensor),
  })).filter((state) => state.state !== null);
}

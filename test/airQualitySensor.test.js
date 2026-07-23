import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAirQualityFeatures,
  buildAirQualityPollStates,
} from '../src/devices/airQualitySensor.js';
import { AIR_QUALITY_STATUS } from './fixtures.js';

const EXTERNAL_ID = 'ext:airzone-cloud:airq:airq-1';
const ids = {
  device: EXTERNAL_ID,
  feature: (featureKey) => `${EXTERNAL_ID}:${featureKey}`,
};

test('buildAirQualityFeatures exposes the full sensor set', () => {
  const features = buildAirQualityFeatures(ids);
  assert.deepEqual(
    features.map((f) => ({
      code: f.external_id.split(':').pop(),
      category: f.category,
      unit: f.unit,
    })),
    [
      { code: 'temperature', category: 'temperature-sensor', unit: 'celsius' },
      { code: 'humidity', category: 'humidity-sensor', unit: 'percent' },
      { code: 'co2', category: 'co2-sensor', unit: 'ppm' },
      { code: 'pm25', category: 'pm25-sensor', unit: 'microgram-per-cubic-meter' },
      { code: 'pm10', category: 'pm10-sensor', unit: 'microgram-per-cubic-meter' },
      { code: 'tvoc', category: 'voc-sensor', unit: 'ppb' },
      { code: 'pressure', category: 'pressure-sensor', unit: 'hPa' },
      { code: 'air-quality-index', category: 'airquality-sensor', unit: 'aqi' },
    ],
  );
  // Every feature is a read-only sensor with history.
  features.forEach((f) => {
    assert.equal(f.read_only, true);
    assert.equal(f.keep_history, true);
  });
});

test('buildAirQualityPollStates maps the sensor status to Gladys states', () => {
  const states = buildAirQualityPollStates(ids, AIR_QUALITY_STATUS);
  assert.deepEqual(states, [
    { device_feature_external_id: `${EXTERNAL_ID}:temperature`, state: 26.8 },
    { device_feature_external_id: `${EXTERNAL_ID}:humidity`, state: 38 },
    { device_feature_external_id: `${EXTERNAL_ID}:co2`, state: 798 },
    { device_feature_external_id: `${EXTERNAL_ID}:pm25`, state: 2 },
    { device_feature_external_id: `${EXTERNAL_ID}:pm10`, state: 8 },
    { device_feature_external_id: `${EXTERNAL_ID}:tvoc`, state: 1900 },
    { device_feature_external_id: `${EXTERNAL_ID}:pressure`, state: 1018 },
    { device_feature_external_id: `${EXTERNAL_ID}:air-quality-index`, state: 64 },
  ]);
});

test('buildAirQualityPollStates skips missing readings', () => {
  const states = buildAirQualityPollStates(ids, { aq_co2: 500 });
  assert.deepEqual(states, [{ device_feature_external_id: `${EXTERNAL_ID}:co2`, state: 500 }]);
});

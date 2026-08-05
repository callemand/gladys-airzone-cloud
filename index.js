// -----------------------------------------------------------------------------
// Entry point of the Gladys Airzone Cloud external integration.
//
//   - logs in to Airzone Cloud with the credentials from the integration config;
//   - publishes the account zones as discovered devices (each zone exposes
//     power / mode / target-temperature / room-temperature features);
//   - answers the polls of Gladys with the current zone state;
//   - forwards user commands to Airzone Cloud (PATCH devices/{id}).
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { AirzoneCloudClient } from './src/airzone/client.js';
import {
  AIR_QUALITY_SLUG,
  airQualityExternalIds,
  convertAirQualitySensor,
  convertDevice,
  getInstallationId,
  zoneExternalIds,
} from './src/devices/convertDevice.js';
import { buildPollStates, buildSetZoneChange } from './src/devices/zone.js';
import { buildAirQualityPollStates } from './src/devices/airQualitySensor.js';
import { FEATURE_CODES } from './src/constants.js';

const gladys = new GladysIntegration();
const airzone = new AirzoneCloudClient();

// Version of the integration, logged on startup: the logs of a user report must
// say which version produced them. Read from package.json (shipped in the image)
// rather than duplicated here, so it stays in sync with the released version.
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

/**
 * Split a device external id (`ext:<selector>:<slug>:<deviceId>`, built with
 * gladys.externalIds()) into its type slug and Airzone device id.
 * @returns {{ slug: string, deviceId: string }}
 */
function parseExternalId(externalId) {
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
 * Log in to Airzone Cloud with the current config. Returns false (without
 * throwing) when the credentials are not filled in yet.
 */
async function connectToAirzone() {
  if (!config.email || !config.password) {
    airzone.logout();
    logger.warn(
      'Airzone Cloud is not configured yet: fill in the email and password in the integration settings',
    );
    return false;
  }
  await airzone.login(config.email, config.password);
  return true;
}

/**
 * Load the zones and air-quality sensors from Airzone Cloud and publish them as
 * discovered devices. A device whose Airzone status could not be read is left
 * out: its features (available modes, temperature range) are built from that
 * status, so publishing it would expose an incomplete device.
 */
async function publishDevices() {
  const { zones, airQualitySensors } = await airzone.listDevices();
  const unavailable = [...zones, ...airQualitySensors].filter(({ status }) => !status);
  if (unavailable.length > 0) {
    logger.warn(
      `${unavailable.length} Airzone device(s) skipped, their status is unavailable: ` +
        unavailable.map(({ name, device_id: deviceId }) => name || deviceId).join(', '),
    );
  }
  logger.info(
    `${zones.length} Airzone Cloud zones and ${airQualitySensors.length} air-quality sensors found`,
  );

  const devices = [
    ...zones.filter(({ status }) => status).map((zone) => convertDevice(gladys, zone)),
    ...airQualitySensors
      .filter(({ status }) => status)
      .map((sensor) => convertAirQualitySensor(gladys, sensor)),
  ];
  await gladys.publishDiscoveredDevices(devices);
  await warnAboutDevicesNotAddedInGladys(devices);
}

/**
 * Point out the Airzone devices that exist in Airzone Cloud but have no Gladys
 * device yet: they are only listed in the "Discover" tab until the user adds
 * them, and Gladys silently drops the states published for a device it does not
 * know — which looks exactly like a device that reports nothing.
 * @param {Array} devices the discovered devices published to Gladys
 */
async function warnAboutDevicesNotAddedInGladys(devices) {
  try {
    const gladysDevices = await gladys.getDevices();
    const knownExternalIds = new Set(gladysDevices.map(({ external_id: id }) => id));
    const missing = devices.filter(({ external_id: id }) => !knownExternalIds.has(id));
    if (missing.length > 0) {
      logger.warn(
        `${missing.length}/${devices.length} Airzone device(s) are not added in Gladys yet ` +
          '(no state can be recorded for them, add them from the integration "Discover" tab): ' +
          missing.map(({ name }) => name).join(', '),
      );
    }
  } catch (err) {
    logger.warn(`Could not check which Airzone devices exist in Gladys: ${err.message}`);
  }
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> loading Airzone Cloud devices');
  if (!airzone.isLoggedIn() && !(await connectToAirzone())) {
    throw new Error('Airzone Cloud is not configured');
  }
  await publishDevices();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  try {
    const { deviceId } = parseExternalId(device.external_id);
    const installationId = getInstallationId(device);
    const featureCode = feature.external_id.split(':').pop();

    const change = buildSetZoneChange(featureCode, value);
    if (!change) {
      throw new Error(`Airzone feature "${feature.external_id}" is not controllable`);
    }

    await airzone.setZoneParam(deviceId, installationId, change);
  } catch (err) {
    // The SDK only acks the command as failed: without this, the reason of a
    // failed command never reaches the integration logs.
    logger.error(`onSetValue ${feature.external_id} failed: ${err.message}`);
    throw err;
  }
});

// --- Polling: Gladys asks to refresh a device --------------------------------

// Devices already reported as publishing no temperature (warn once per device,
// a poll runs every minute).
const temperatureWarnings = new Set();

/**
 * Warn when a zone poll publishes no room temperature: either Airzone does not
 * deliver `local_temp` for this zone (no thermostat), or it names the field
 * differently — the status field names make it possible to tell.
 * @param {object} device the Gladys device being polled
 * @param {object} status the Airzone zone status
 * @param {Array} states the states about to be published
 */
function warnAboutMissingRoomTemperature(device, status, states) {
  const { deviceId } = parseExternalId(device.external_id);
  const roomTemperatureId = zoneExternalIds(gladys, deviceId).feature(
    FEATURE_CODES.ROOM_TEMPERATURE,
  );
  const hasRoomTemperature = states.some(
    ({ device_feature_external_id: id }) => id === roomTemperatureId,
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
    `The Airzone zone "${device.selector || device.external_id}" reports no room temperature ` +
      `(no usable "local_temp"). Status fields: ${Object.keys(status || {}).join(', ')}`,
  );
}

gladys.onPoll(async (device) => {
  try {
    const { slug, deviceId } = parseExternalId(device.external_id);
    const installationId = getInstallationId(device);

    const status = await airzone.getZoneStatus(deviceId, installationId);
    const isAirQuality = slug === AIR_QUALITY_SLUG;
    const states = isAirQuality
      ? buildAirQualityPollStates(airQualityExternalIds(gladys, deviceId), status)
      : buildPollStates(zoneExternalIds(gladys, deviceId), status);
    if (!isAirQuality) {
      warnAboutMissingRoomTemperature(device, status, states);
    }
    logger.debug(`onPoll ${device.external_id} -> ${states.length} states`);
    if (states.length > 0) {
      await gladys.publishStates(states);
    }
  } catch (err) {
    // Same as onSetValue: a failed poll is otherwise invisible in the logs of
    // the integration, and only shows up as a device that stopped reporting.
    logger.error(`onPoll ${device.external_id} failed: ${err.message}`);
    throw err;
  }
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> reconnecting to Airzone Cloud');
  config = normalizeConfig(newConfig);
  try {
    if (await connectToAirzone()) {
      await publishDevices();
    }
  } catch (err) {
    logger.error('Reconnection to Airzone Cloud failed', err);
  }
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  logger.info('WebSocket connected to Gladys');
  try {
    // 1) Fetch the config filled in by the user.
    config = normalizeConfig(await gladys.getConfig());

    // 2) Log in to Airzone Cloud and publish the devices.
    if (await connectToAirzone()) {
      await publishDevices();
    }
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

gladys.on('disconnected', () => {
  logger.warn('WebSocket disconnected - the SDK will try to reconnect');
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info(`Starting the Airzone Cloud integration v${VERSION}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});

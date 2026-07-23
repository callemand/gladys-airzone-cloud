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

const gladys = new GladysIntegration();
const airzone = new AirzoneCloudClient();

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
 * discovered devices.
 */
async function publishDevices() {
  const [zones, airQualitySensors] = await Promise.all([
    airzone.listZones(),
    airzone.listAirQualitySensors(),
  ]);
  logger.info(
    `${zones.length} Airzone Cloud zones and ${airQualitySensors.length} air-quality sensors found`,
  );
  await gladys.publishDiscoveredDevices([
    ...zones.map((zone) => convertDevice(gladys, zone)),
    ...airQualitySensors.map((sensor) => convertAirQualitySensor(gladys, sensor)),
  ]);
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
  const { deviceId } = parseExternalId(device.external_id);
  const installationId = getInstallationId(device);
  const featureCode = feature.external_id.split(':').pop();

  const change = buildSetZoneChange(featureCode, value);
  if (!change) {
    throw new Error(`Airzone feature "${feature.external_id}" is not controllable`);
  }

  await airzone.setZoneParam(deviceId, installationId, change);
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  const { slug, deviceId } = parseExternalId(device.external_id);
  const installationId = getInstallationId(device);

  const status = await airzone.getZoneStatus(deviceId, installationId);
  const states =
    slug === AIR_QUALITY_SLUG
      ? buildAirQualityPollStates(airQualityExternalIds(gladys, deviceId), status)
      : buildPollStates(zoneExternalIds(gladys, deviceId), status);
  if (states.length > 0) {
    await gladys.publishStates(states);
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
logger.info('Starting the Airzone Cloud integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});

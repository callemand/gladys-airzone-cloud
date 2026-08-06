// -----------------------------------------------------------------------------
// Entry point of the Gladys Airzone Cloud external integration.
//
// Role of this file: wire the SDK to the device catalog (src/devices/). It holds
// NO Airzone logic: the API client lives in src/airzone/ and the device work in
// the device modules. This file only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. logs in to Airzone Cloud, publishes the discovered devices and reports
//      the application-level connection status.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { DEVICE_TRANSPORTS, GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { airzone } from './src/airzone/client.js';
import { airzoneLocal } from './src/airzone/localClient.js';
import { applyLogLevel, normalizeConfig } from './src/config.js';
import { describeError } from './src/errors.js';
import {
  buildDiscoveredDevices,
  buildTransportEntries,
  findTypeByDevice,
} from './src/devices/index.js';
import { getInstallationId } from './src/devices/common.js';

const gladys = new GladysIntegration();

// Version of the integration, logged on startup: the logs of a user report must
// say which version produced them. Read from package.json (shipped in the image)
// rather than duplicated here, so it stays in sync with the released version.
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();
applyLogLevel(config);

// Transport badge last published for each device, so only transitions are sent
// (a poll runs every minute on every device).
const lastTransportByDevice = new Map();

/**
 * Report the application-level connection status, shown in the Configuration
 * screen. Distinct from the container state machine: the integration can be
 * RUNNING and still unable to reach Airzone Cloud.
 * @param {boolean} connected whether Airzone Cloud is reachable
 * @param {object} [message] multi-language message (`en` mandatory)
 */
async function reportConnectionStatus(connected, message) {
  try {
    await gladys.setConnectionStatus(connected, message);
  } catch (err) {
    logger.warn(`Could not report the connection status to Gladys: ${err.message}`);
  }
}

/**
 * Log in to Airzone Cloud with the current config. Returns false (without
 * throwing) when the credentials are not filled in yet.
 * @returns {Promise<boolean>} whether the integration is logged in
 */
/**
 * Point the local API client at the webserver from the config, and probe it so
 * the logs say up front whether the local channel will be used.
 */
async function configureLocalApi() {
  if (!airzoneLocal.configure(config.local_host, config.local_port)) {
    return;
  }
  if (!config.prefer_local) {
    logger.info('Local API configured but the local connection is not preferred: using the cloud');
    return;
  }
  try {
    const { version } = await airzoneLocal.getVersion();
    logger.info(`Local API reachable${version ? ` (version ${version})` : ''}: it will be used`);
  } catch (err) {
    airzoneLocal.noteFailure();
    logger.warn(
      `Local API unreachable (${describeError(err)}): using the Airzone Cloud API, and retrying later`,
    );
  }
}

async function connectToAirzone() {
  if (!config.email || !config.password) {
    airzone.logout();
    logger.warn(
      'Airzone Cloud is not configured yet: fill in the email and password in the integration settings',
    );
    await reportConnectionStatus(false, {
      en: 'Not configured yet: fill in your Airzone Cloud email and password.',
      fr: 'Pas encore configurée : renseignez vos e-mail et mot de passe Airzone Cloud.',
    });
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
  const inventory = await airzone.listDevices();
  const { zones, airQualitySensors } = inventory;
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

  const devices = buildDiscoveredDevices(gladys, {
    zones: zones.filter(({ status }) => status),
    airQualitySensors: airQualitySensors.filter(({ status }) => status),
  });
  await gladys.publishDiscoveredDevices(devices);
  await publishDeviceTransports(devices);
  await warnAboutDevicesNotAddedInGladys(devices);
  await reportConnectionStatus(true);
}

/**
 * Publish the expected channel of every device (local or cloud), rendered as a
 * badge in the Gladys UI. Each poll then refines it with the channel it actually
 * used.
 * @param {Array} devices the discovered devices published to Gladys
 */
async function publishDeviceTransports(devices) {
  const entries = buildTransportEntries(gladys, devices, config);
  if (entries.length === 0) {
    return;
  }
  entries.forEach((entry) => lastTransportByDevice.set(entry.external_id, describeEntry(entry)));
  await gladys.publishTransports(entries);
}

/**
 * Comparable description of a transport entry (to publish transitions only).
 * @param {object} entry a transport entry
 * @returns {string}
 */
function describeEntry(entry) {
  return `${entry.transport}|${entry.degraded ? entry.message?.en : ''}`;
}

/**
 * Publish the channel a device was actually reached through: local, cloud, or
 * cloud flagged degraded (the local API refused, or Airzone refused the refresh
 * altogether). Only transitions reach Gladys.
 * @param {object} device the Gladys device
 * @param {Error} [error] the error that made the refresh fail
 * @param {object} [report] `{ transport, degraded, message }` reported by the device type
 */
async function reportDeviceTransport(device, error, report) {
  const externalId = device.external_id;
  let entry;
  if (error) {
    entry = {
      external_id: externalId,
      transport: report?.transport || DEVICE_TRANSPORTS.CLOUD,
      degraded: true,
      message: {
        en: `Airzone refused the last refresh: ${describeError(error)}`.slice(0, 200),
        fr: `Airzone a refusé le dernier rafraîchissement : ${describeError(error)}`.slice(0, 200),
      },
    };
  } else if (report && report.transport) {
    entry = { external_id: externalId, ...report };
  } else {
    return;
  }

  const description = describeEntry(entry);
  if (lastTransportByDevice.get(externalId) === description) {
    return;
  }
  lastTransportByDevice.set(externalId, description);
  try {
    await gladys.publishTransports([entry]);
  } catch (err) {
    logger.warn(`Could not publish the transport of ${externalId}: ${err.message}`);
  }
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
    const { type, deviceId } = findTypeByDevice(gladys, device);
    if (!type || typeof type.onSetValue !== 'function') {
      // Throw: the SDK sends a success:false acknowledgement to Gladys.
      throw new Error(`No command handler for ${device.external_id}`);
    }
    await type.onSetValue(gladys, {
      device,
      deviceId,
      installationId: getInstallationId(device),
      feature,
      value,
      config,
    });
  } catch (err) {
    // The SDK only acks the command as failed: without this, the reason of a
    // failed command never reaches the integration logs.
    logger.error(`onSetValue ${feature.external_id} failed: ${describeError(err)}`);
    throw err;
  }
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  const { type, deviceId } = findTypeByDevice(gladys, device);
  if (!type || typeof type.onPoll !== 'function') {
    logger.debug(`onPoll ignored (no polling) for ${device.external_id}`);
    return;
  }
  try {
    const report = await type.onPoll(gladys, {
      device,
      deviceId,
      installationId: getInstallationId(device),
      config,
    });
    await reportDeviceTransport(device, null, report);
  } catch (err) {
    // Same as onSetValue: a failed poll is otherwise invisible in the logs of
    // the integration, and only shows up as a device that stopped reporting.
    logger.error(`onPoll ${device.external_id} failed: ${describeError(err)}`);
    await reportDeviceTransport(device, err);
    throw err;
  }
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> reconnecting to Airzone Cloud');
  config = normalizeConfig(newConfig);
  applyLogLevel(config);
  try {
    await configureLocalApi();
    if (await connectToAirzone()) {
      await publishDevices();
    }
  } catch (err) {
    logger.error(`Reconnection to Airzone Cloud failed: ${describeError(err)}`);
    await reportConnectionStatus(false, {
      en: 'Connection to Airzone Cloud failed, check your credentials and the integration logs.',
      fr: "La connexion à Airzone Cloud a échoué, vérifiez vos identifiants et les logs de l'intégration.",
    });
  }
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle (connections, disconnections,
// reconnection attempts) under the `gladys-sdk` name: no need to log it again
// here, this handler only runs the integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    // 1) Fetch the config filled in by the user.
    config = normalizeConfig(await gladys.getConfig());
    applyLogLevel(config);

    // 2) Point the local API client at the webserver, when the user gave one.
    await configureLocalApi();

    // 3) Log in to Airzone Cloud and publish the devices (this also reports the
    // application-level connection status).
    if (await connectToAirzone()) {
      await publishDevices();
    }
  } catch (err) {
    logger.error(`Post-connection initialization failed: ${describeError(err)}`);
    await reportConnectionStatus(false, {
      en: 'Connection to Airzone Cloud failed, check your credentials and the integration logs.',
      fr: "La connexion à Airzone Cloud a échoué, vérifiez vos identifiants et les logs de l'intégration.",
    });
  }
});

// --- Graceful shutdown -------------------------------------------------------
// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info(`Starting the Airzone Cloud integration v${VERSION}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});

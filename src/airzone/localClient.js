// -----------------------------------------------------------------------------
// Airzone LOCAL API client (the webserver's own API, on the LAN).
//
//   - POST api/v1/version              -> { version } (reachability probe)
//   - POST api/v1/hvac {systemID,zoneID} -> { data: [ zone status ] }
//   - PUT  api/v1/hvac {systemID,zoneID,<param>:value} -> write one parameter
//
// No authentication, no rate limit, no Airzone Cloud subscription involved. The
// client is configured with the webserver address; when it is not, it simply
// reports itself as not configured and the integration stays on the cloud.
//
// A failure puts the local API in a cooldown (a rebooting webserver must not
// slow every poll down): during that window the integration uses the cloud.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

import {
  AIRZONE_LOCAL_COOLDOWN_MS,
  AIRZONE_LOCAL_DEFAULT_PORT,
  AIRZONE_LOCAL_FIELD,
  AIRZONE_LOCAL_PATHS,
  AIRZONE_LOCAL_TIMEOUT_MS,
} from '../constants.js';

const logger = createLogger({ name: 'airzone-local' });

export class AirzoneLocalClient {
  constructor() {
    this.baseUrl = null;
    this.unavailableUntil = 0;
  }

  /**
   * Point the client at a webserver (or clear it when the address is empty).
   * @param {string|null} host IP address or hostname of the Airzone webserver
   * @param {number|null} port local API port (3000 by default)
   * @returns {boolean} whether the client is configured
   */
  configure(host, port) {
    const address = (host || '').trim();
    if (!address) {
      if (this.baseUrl !== null) {
        logger.info('Local API disabled, back to the Airzone Cloud API');
      }
      this.baseUrl = null;
      return false;
    }
    // The user may type "192.168.1.10", "192.168.1.10:3000" or a full URL; the
    // port field wins, and the local API default applies when neither is given.
    const url = new URL(/^https?:\/\//.test(address) ? address : `http://${address}`);
    if (port) {
      url.port = String(port);
    } else if (!url.port) {
      url.port = String(AIRZONE_LOCAL_DEFAULT_PORT);
    }
    const baseUrl = url.origin;
    if (baseUrl !== this.baseUrl) {
      logger.info(`Local API configured on ${baseUrl}`);
      this.baseUrl = baseUrl;
      this.unavailableUntil = 0;
    }
    return true;
  }

  isConfigured() {
    return this.baseUrl !== null;
  }

  /**
   * Whether the local API should be used right now: configured, and not in the
   * cooldown that follows a failure.
   * @returns {boolean}
   */
  isUsable() {
    return this.isConfigured() && Date.now() >= this.unavailableUntil;
  }

  /**
   * Hold the local API back for a while after a failure.
   */
  noteFailure() {
    this.unavailableUntil = Date.now() + AIRZONE_LOCAL_COOLDOWN_MS;
  }

  /**
   * Check that the webserver answers its local API.
   * @returns {Promise<object>} the version payload
   */
  async getVersion() {
    return this.#request('POST', AIRZONE_LOCAL_PATHS.VERSION, {});
  }

  /**
   * Read the status of one zone.
   * @param {number} systemId Airzone system number
   * @param {number} zoneId Airzone zone number
   * @returns {Promise<object>} the zone status
   */
  async getZoneStatus(systemId, zoneId) {
    const response = await this.#request('POST', AIRZONE_LOCAL_PATHS.HVAC, {
      [AIRZONE_LOCAL_FIELD.SYSTEM_ID]: Number(systemId),
      [AIRZONE_LOCAL_FIELD.ZONE_ID]: Number(zoneId),
    });
    const zone = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!zone) {
      throw new Error(`Local API returned no zone for system ${systemId} / zone ${zoneId}`);
    }
    return zone;
  }

  /**
   * Write one parameter of a zone.
   * @param {number} systemId Airzone system number
   * @param {number} zoneId Airzone zone number
   * @param {object} change the change (`{ [field]: value }`)
   * @returns {Promise<object>} the API answer
   */
  async setZoneParam(systemId, zoneId, change) {
    return this.#request('PUT', AIRZONE_LOCAL_PATHS.HVAC, {
      [AIRZONE_LOCAL_FIELD.SYSTEM_ID]: Number(systemId),
      [AIRZONE_LOCAL_FIELD.ZONE_ID]: Number(zoneId),
      ...change,
    });
  }

  async #request(method, path, body) {
    if (!this.isConfigured()) {
      throw new Error('The Airzone local API is not configured');
    }
    const response = await fetch(`${this.baseUrl}/${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AIRZONE_LOCAL_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(
        `Airzone local API request failed: ${method} ${path} -> HTTP ${response.status}${
          text ? ` ${text.slice(0, 200)}` : ''
        }`,
      );
      error.status = response.status;
      throw error;
    }
    const payload = text ? JSON.parse(text) : {};
    // The local API answers 200 with an `errors` array on a refused command.
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error(
        `Airzone local API refused ${method} ${path}: ${JSON.stringify(payload.errors)}`,
      );
    }
    return payload;
  }
}

// The local client used by the integration (configured from the user config).
export const airzoneLocal = new AirzoneLocalClient();

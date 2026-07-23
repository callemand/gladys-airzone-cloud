// -----------------------------------------------------------------------------
// Minimal Airzone Cloud API client (uses the Node.js built-in fetch).
//
// The Airzone Cloud API is the same one used by the official mobile app:
//   - POST auth/login                 -> returns { token, refreshToken }
//   - GET  auth/refreshToken/{token}  -> returns a fresh { token, refreshToken }
//   - GET  installations              -> list of installations
//   - GET  installations/{id}         -> groups -> devices (systems / zones)
//   - GET  devices/{id}/status        -> live status of one device
//   - PATCH devices/{id}              -> write one parameter of a device
//
// Every authenticated request carries the access token as a Bearer token. When
// Airzone invalidates the session (HTTP 401), the client refreshes the token
// once (falling back to a full login) and retries the request.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

import { AIRZONE_ENDPOINT, AIRZONE_DEVICE_TYPES } from '../constants.js';

const logger = createLogger({ name: 'airzone' });

const REQUEST_TIMEOUT_MS = 15000;

export class AirzoneCloudClient {
  constructor(baseUrl = AIRZONE_ENDPOINT) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.accessToken = null;
    this.refreshToken = null;
    this.credentials = null;
  }

  isLoggedIn() {
    return this.accessToken !== null;
  }

  /**
   * Log in to Airzone Cloud and store the access + refresh tokens.
   * @param {string} email Airzone Cloud account email
   * @param {string} password Airzone Cloud account password
   */
  async login(email, password) {
    this.accessToken = null;
    this.refreshToken = null;
    this.credentials = { email, password };
    logger.debug('Logging in...');
    const response = await this.#fetchJson('auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      contentType: 'application/json',
    });
    this.#storeTokens(response);
    logger.info('Logged in');
  }

  logout() {
    this.accessToken = null;
    this.refreshToken = null;
    this.credentials = null;
  }

  /**
   * List all Airzone Cloud zones of the account, flattened from the
   * installations -> groups -> devices tree. Each zone is annotated with its
   * installationId and its live status.
   * @returns {Promise<Array>} zone entries
   */
  async listZones() {
    const { installations = [] } = await this.#authenticatedRequest('installations');

    const zones = [];
    await Promise.all(
      installations.map(async (installation) => {
        const installationId = installation.installation_id;
        const detail = await this.#authenticatedRequest(`installations/${installationId}`);
        (detail.groups || []).forEach((group) => {
          (group.devices || []).forEach((device) => {
            if (device.type === AIRZONE_DEVICE_TYPES.ZONE) {
              zones.push({ ...device, installationId });
            }
          });
        });
      }),
    );

    await Promise.all(
      zones.map(async (zone) => {
        zone.status = await this.getZoneStatus(zone.device_id, zone.installationId);
      }),
    );

    logger.debug(`${zones.length} zones loaded`);
    return zones;
  }

  /**
   * Fetch the live status of one zone.
   * @param {string} deviceId Airzone device id
   * @param {string} installationId Airzone installation id
   * @returns {Promise<object>} the zone status
   */
  async getZoneStatus(deviceId, installationId) {
    const query = new URLSearchParams({ installation_id: String(installationId) });
    const response = await this.#authenticatedRequest(`devices/${deviceId}/status?${query}`);
    return response.status || response;
  }

  /**
   * Write one parameter of a zone.
   * @param {string} deviceId Airzone device id
   * @param {string} installationId Airzone installation id
   * @param {object} change the change ({ param, value })
   */
  async setZoneParam(deviceId, installationId, change) {
    const body = {
      param: change.param,
      value: change.value,
      installation_id: installationId,
    };
    // Some parameters (e.g. setpoint) require an `opts` object (temperature
    // unit); it is omitted for the ones that reject it (e.g. power, mode).
    if (change.opts) {
      body.opts = change.opts;
    }
    return this.#authenticatedRequest(`devices/${deviceId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
  }

  /**
   * Perform an authenticated request; on a 401, refresh the token once
   * (falling back to a full login) and retry.
   */
  async #authenticatedRequest(path, options = {}) {
    if (!this.isLoggedIn()) {
      throw new Error('Airzone Cloud is not connected');
    }
    const doRequest = () =>
      this.#fetchJson(path, {
        ...options,
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    try {
      return await doRequest();
    } catch (e) {
      if (e.status === 401 && this.credentials) {
        logger.warn('Session expired, refreshing the token...');
        await this.#reauthenticate();
        return doRequest();
      }
      throw e;
    }
  }

  /**
   * Refresh the access token; on failure, fall back to a full login.
   */
  async #reauthenticate() {
    try {
      const response = await this.#fetchJson(`auth/refreshToken/${this.refreshToken}`, {});
      this.#storeTokens(response);
    } catch {
      logger.warn('Token refresh failed, logging in again...');
      await this.login(this.credentials.email, this.credentials.password);
    }
  }

  #storeTokens(response) {
    if (!response || !response.token) {
      throw new Error('Airzone Cloud login failed: no token returned (check your credentials)');
    }
    this.accessToken = response.token;
    if (response.refreshToken) {
      this.refreshToken = response.refreshToken;
    }
  }

  async #fetchJson(path, { method = 'GET', headers = {}, body, contentType }) {
    const response = await fetch(`${this.baseUrl}/${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const error = new Error(
        `Airzone Cloud request failed: ${method} ${path} -> HTTP ${response.status}`,
      );
      error.status = response.status;
      throw error;
    }
    // Some write endpoints answer with an empty body.
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}

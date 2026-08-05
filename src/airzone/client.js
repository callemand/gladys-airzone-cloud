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
//
// The API rate-limits an account globally: requests go through a scheduler that
// caps the parallelism, and a rejected request (HTTP 429 or a temporary server
// error) is retried a couple of times while the whole account backs off.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

import { AIRZONE_ENDPOINT, AIRZONE_DEVICE_TYPES } from '../constants.js';
import { RequestScheduler, sleep } from './scheduler.js';

const logger = createLogger({ name: 'airzone' });

// Kept below the Gladys host command timeout (5 s): a slow Airzone request must
// fail on our side with a clear error rather than let the whole poll/set-value
// command time out on the Gladys side.
const REQUEST_TIMEOUT_MS = 4000;

// The login is the slowest call of the API (the account password is verified
// server-side) and it does NOT answer a Gladys command: it gets a much larger
// budget, and a timeout is retried — losing it means losing the session, and
// every later request fails with "Airzone Cloud is not connected".
const LOGIN_TIMEOUT_MS = 20000;
const LOGIN_MAX_ATTEMPTS = 2;

// Maximum number of Airzone requests in flight. The reference Airzone Cloud
// client (aioairzone-cloud) caps itself at 4; we stay below it, because nothing
// here is time-critical: only the discovery walks several devices at once (a
// poll cycle is sequential on the Gladys side).
const MAX_CONCURRENT_REQUESTS = 2;

// A rejected request (429 / temporary server error) is retried, with a short
// backoff during which the whole account stops sending requests. The delays are
// kept small on purpose: a poll that answers too late is useless to Gladys.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [400, 1200];
const MAX_RETRY_DELAY_MS = 2000;

// Only the beginning of an error body is useful in the logs.
const MAX_ERROR_BODY_LENGTH = 200;

// The Airzone device types exposed to Gladys (systems are only containers of
// zones in the installation tree).
const EXPOSED_DEVICE_TYPES = new Set([AIRZONE_DEVICE_TYPES.ZONE, AIRZONE_DEVICE_TYPES.AIR_QUALITY]);

/**
 * Whether an error is the abort of a request that took too long.
 * @param {Error} error the error thrown by fetch
 * @returns {boolean}
 */
function isTimeout(error) {
  return error.name === 'TimeoutError' || error.name === 'AbortError';
}

/**
 * Read the `Retry-After` header (delay in seconds or HTTP date).
 * @param {Headers} headers response headers
 * @returns {number|null} the delay in milliseconds, or null if absent/invalid
 */
function parseRetryAfter(headers) {
  const raw = headers.get('retry-after');
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export class AirzoneCloudClient {
  /**
   * @param {string} [baseUrl] Airzone Cloud API base URL
   * @param {object} [options] options
   * @param {number} [options.loginTimeoutMs] login timeout (lowered by the tests)
   */
  constructor(baseUrl = AIRZONE_ENDPOINT, { loginTimeoutMs = LOGIN_TIMEOUT_MS } = {}) {
    this.loginTimeoutMs = loginTimeoutMs;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.accessToken = null;
    this.refreshToken = null;
    this.credentials = null;
    this.scheduler = new RequestScheduler({ maxConcurrent: MAX_CONCURRENT_REQUESTS });
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
    const response = await this.#request('auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      contentType: 'application/json',
      timeoutMs: this.loginTimeoutMs,
      maxAttempts: LOGIN_MAX_ATTEMPTS,
      retryOnTimeout: true,
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
   * List the Airzone Cloud devices exposed to Gladys (zones and air-quality
   * sensors), flattened from the installations -> groups -> devices tree. Each
   * device is annotated with its installationId and its live status (`status` is
   * null when Airzone refused to answer for that device).
   * @returns {Promise<{ zones: Array, airQualitySensors: Array }>} device entries
   */
  async listDevices() {
    const { installations = [] } = await this.#authenticatedRequest('installations');

    const devices = [];
    await Promise.all(
      installations.map(async (installation) => {
        const installationId = installation.installation_id;
        const detail = await this.#authenticatedRequest(`installations/${installationId}`);
        (detail.groups || []).forEach((group) => {
          (group.devices || []).forEach((device) => {
            if (EXPOSED_DEVICE_TYPES.has(device.type)) {
              devices.push({ ...device, installationId });
            }
          });
        });
      }),
    );

    // One status request per device: a device whose status is unavailable is
    // reported with `status: null` instead of failing the whole listing (the
    // other devices must still reach Gladys).
    await Promise.all(
      devices.map(async (device) => {
        try {
          device.status = await this.getZoneStatus(device.device_id, device.installationId);
        } catch (e) {
          logger.error(
            `Status of the Airzone device "${device.name || device.device_id}" is unavailable: ${e.message}`,
          );
          device.status = null;
        }
      }),
    );

    const zones = devices.filter((device) => device.type === AIRZONE_DEVICE_TYPES.ZONE);
    const airQualitySensors = devices.filter(
      (device) => device.type === AIRZONE_DEVICE_TYPES.AIR_QUALITY,
    );
    logger.debug(
      `${zones.length} zones and ${airQualitySensors.length} air-quality sensors loaded`,
    );
    return { zones, airQualitySensors };
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
      this.#request(path, {
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
      const response = await this.#request(`auth/refreshToken/${this.refreshToken}`, {});
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

  /**
   * Send one request through the scheduler, retrying the rejections the API is
   * expected to recover from (rate limit, temporary server error).
   */
  async #request(path, options) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.scheduler.run(() => this.#fetchJson(path, options));
      } catch (e) {
        const delay = this.#retryDelay(e, attempt, options);
        if (delay === null) {
          throw e;
        }
        // Back the whole account off, not only this request: the other requests
        // of the same poll cycle would be rejected too.
        this.scheduler.pauseFor(delay);
        logger.warn(`${e.message} — retrying in ${delay} ms`);
        await sleep(delay);
      }
    }
  }

  /**
   * How long to wait before retrying a failed request.
   * @param {Error} error the error thrown by the request
   * @param {number} attempt zero-based index of the attempt that just failed
   * @returns {number|null} the delay in milliseconds, or null to not retry
   */
  #retryDelay(error, attempt, { maxAttempts = DEFAULT_MAX_ATTEMPTS, retryOnTimeout = false } = {}) {
    const retryable =
      RETRYABLE_STATUS_CODES.has(error.status) || (retryOnTimeout && isTimeout(error));
    if (attempt >= maxAttempts - 1 || !retryable) {
      return null;
    }
    const backoff = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1);
    return Math.min(error.retryAfterMs ?? backoff, MAX_RETRY_DELAY_MS);
  }

  async #fetchJson(
    path,
    { method = 'GET', headers = {}, body, contentType, timeoutMs = REQUEST_TIMEOUT_MS },
  ) {
    const response = await fetch(`${this.baseUrl}/${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Some write endpoints answer with an empty body.
    const text = await response.text();
    if (!response.ok) {
      const detail = text ? ` ${text.slice(0, MAX_ERROR_BODY_LENGTH)}` : '';
      const error = new Error(
        `Airzone Cloud request failed: ${method} ${path} -> HTTP ${response.status}${detail}`,
      );
      error.status = response.status;
      const retryAfterMs = parseRetryAfter(response.headers);
      if (retryAfterMs !== null) {
        error.retryAfterMs = retryAfterMs;
      }
      throw error;
    }
    return text ? JSON.parse(text) : {};
  }
}

// The client used by the integration: a single Airzone Cloud session shared by
// the entry point (login, discovery) and the device modules (poll, commands).
// The class stays exported for the tests, which point it at a fake API.
export const airzone = new AirzoneCloudClient();

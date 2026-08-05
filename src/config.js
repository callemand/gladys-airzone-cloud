// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the
// `config_schema` declared in `gladys-assistant-integration.json`. The SDK
// fetches it (`gladys.getConfig()`) and notifies every change through
// `gladys.onConfigUpdated()`.
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';

export const DEFAULT_CONFIG = {
  email: null,
  password: null,
  verbose_logs: false,
};

// Log level of the container, before the user config is applied. Gladys does not
// inject LOG_LEVEL, so this is normally undefined (the SDK then logs at `info`);
// it is set when the integration runs locally or in the test suite, and that
// choice must survive a config update.
const INITIAL_LOG_LEVEL = process.env.LOG_LEVEL;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 * @returns {object} the normalized config
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    email: raw.email || null,
    password: raw.password || null,
    verbose_logs: raw.verbose_logs === true,
  };
}

/**
 * Apply the "Verbose logs" option: the SDK logger re-reads LOG_LEVEL on every
 * line, so switching it here takes effect immediately — including when the user
 * ticks the box while the integration is running.
 * @param {object} config the normalized config
 */
export function applyLogLevel(config) {
  const level = config.verbose_logs ? 'debug' : INITIAL_LOG_LEVEL;
  if (level === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = level;
  }
  if (config.verbose_logs) {
    logger.info('Verbose logs enabled: every refresh is logged in detail');
  }
}

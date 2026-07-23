// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the
// `config_schema` declared in `gladys-assistant-integration.json`. The SDK
// fetches it (`gladys.getConfig()`) and notifies every change through
// `gladys.onConfigUpdated()`.
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  email: null,
  password: null,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    email: raw.email || null,
    password: raw.password || null,
  };
}

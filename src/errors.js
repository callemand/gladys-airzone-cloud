// -----------------------------------------------------------------------------
// Error descriptions for the logs.
//
// The Node.js fetch reports every network failure as a bare `TypeError: fetch
// failed` and hides the real reason in `error.cause` (ECONNREFUSED, EHOSTUNREACH,
// ENOTFOUND, a TLS failure...). A log line saying only "fetch failed" costs a
// diagnosis round-trip, so every message we log goes through here.
// -----------------------------------------------------------------------------

/**
 * Human-readable description of an error, including the cause chain that the
 * Node.js fetch hides.
 * @param {*} error the error to describe
 * @returns {string} the description
 */
export function describeError(error) {
  if (!error) {
    return 'unknown error';
  }
  // A thrown string (or anything not an Error) has no message nor cause.
  if (typeof error !== 'object') {
    return String(error);
  }
  const parts = [];
  let current = error;
  const seen = new Set();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = current.code ? ` (${current.code})` : '';
    const message = current.message || String(current);
    const part = `${message}${code}`;
    // Skip a cause that only repeats what the parent already says.
    if (!parts.includes(part)) {
      parts.push(part);
    }
    current = current.cause;
  }
  return parts.join(': ');
}

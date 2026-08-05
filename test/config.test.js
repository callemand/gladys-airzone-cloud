import test from 'node:test';
import assert from 'node:assert/strict';

// The module captures LOG_LEVEL at import time (the level of the container
// before the user config is applied): pin it here, before the import.
process.env.LOG_LEVEL = 'info';
const { applyLogLevel, normalizeConfig } = await import('../src/config.js');

test('normalizeConfig fills in the defaults', () => {
  assert.deepEqual(normalizeConfig(), { email: null, password: null, verbose_logs: false });
  assert.deepEqual(normalizeConfig({ email: 'a@b.c', password: 'x', verbose_logs: true }), {
    email: 'a@b.c',
    password: 'x',
    verbose_logs: true,
  });
  // Only a real `true` enables the verbose logs (Gladys can send a string).
  assert.equal(normalizeConfig({ verbose_logs: 'false' }).verbose_logs, false);
});

test('applyLogLevel switches the level and restores the initial one', (t) => {
  t.after(() => {
    process.env.LOG_LEVEL = 'info';
  });

  applyLogLevel(normalizeConfig({ verbose_logs: true }));
  assert.equal(process.env.LOG_LEVEL, 'debug');

  // Unticking the box gives the container level back, it does not keep debug.
  applyLogLevel(normalizeConfig({ verbose_logs: false }));
  assert.equal(process.env.LOG_LEVEL, 'info');
});

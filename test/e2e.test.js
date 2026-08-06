// End-to-end test: boots the REAL integration process (index.js) against a
// fake Gladys host (WebSocket + REST, same contract as the SDK) and a fake
// Airzone Cloud API, then exercises the full flows: initial discovery, scan
// request, poll and set-value commands.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { AC_MODE } from '../src/constants.js';
import {
  INSTALLATIONS_RESPONSE,
  INSTALLATION_DETAIL_RESPONSE,
  ZONE_STATUS,
  AIR_QUALITY_STATUS,
} from './fixtures.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELECTOR = 'airzone-test';
const TOKEN = 'test-token';

async function waitUntil(predicate, what, timeoutMs = 10000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// --- Fake Airzone Cloud API --------------------------------------------------
function startFakeAirzone() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      requests.push({
        method: req.method,
        path: url.pathname,
        body: body ? JSON.parse(body) : null,
      });
      const respond = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (url.pathname === '/auth/login') {
        respond(200, { token: 'access', refreshToken: 'refresh' });
      } else if (url.pathname === '/installations') {
        respond(200, INSTALLATIONS_RESPONSE);
      } else if (url.pathname === '/installations/install-1') {
        respond(200, INSTALLATION_DETAIL_RESPONSE);
      } else if (url.pathname === '/devices/zone-1/status') {
        respond(200, { status: ZONE_STATUS });
      } else if (url.pathname === '/devices/airq-1/status') {
        respond(200, { status: AIR_QUALITY_STATUS });
      } else if (url.pathname.endsWith('/status')) {
        // Unknown device: same answer as the real API.
        respond(404, { message: 'Device not found' });
      } else {
        respond(200, {});
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port }));
  });
}

// --- Fake Gladys host (REST + WebSocket) -------------------------------------
function startFakeGladys() {
  const state = {
    discoveredDevicePosts: [],
    statePosts: [],
    transportPosts: [],
    connectionStatusPosts: [],
    commandResults: [],
    ws: null,
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const respond = (json) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'GET' && req.url === '/api/integration/v1/device') {
        respond([]);
      } else if (req.method === 'GET' && req.url === '/api/integration/v1/config') {
        respond({ config: { email: 'user@example.com', password: 'secret' } });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/discovered_device') {
        const parsed = JSON.parse(body);
        state.discoveredDevicePosts.push(parsed.devices);
        respond({ success: true, count: parsed.devices.length });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/state') {
        state.statePosts.push(JSON.parse(body).states);
        respond({ success: true });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/device/transport') {
        state.transportPosts.push(JSON.parse(body).transports);
        respond({ success: true });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/connection_status') {
        state.connectionStatusPosts.push(JSON.parse(body));
        respond({ success: true });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    state.ws = ws;
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'authenticate.integration-request' && message.payload.token === TOKEN) {
        ws.send(JSON.stringify({ type: 'authentication.connected', payload: {} }));
      }
      if (message.type === 'external-integration.command-result') {
        state.commandResults.push(message.payload);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port }));
  });
}

test('the integration discovers, polls and controls Airzone zones', async (t) => {
  const airzone = await startFakeAirzone();
  const gladys = await startFakeGladys();
  t.after(() => {
    airzone.server.close();
    gladys.server.close();
  });

  let output = '';
  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: `http://127.0.0.1:${gladys.port}`,
      GLADYS_INTEGRATION_TOKEN: TOKEN,
      GLADYS_INTEGRATION_SELECTOR: SELECTOR,
      AIRZONE_ENDPOINT: `http://127.0.0.1:${airzone.port}`,
      // No LOG_LEVEL: same as the container started by Gladys, which only
      // injects the GLADYS_* variables (the SDK then logs at `info`).
    },
  });
  child.stdout.on('data', (d) => {
    output += d;
  });
  child.stderr.on('data', (d) => {
    output += d;
  });
  t.after(() => child.kill('SIGKILL'));
  t.afterEach((ctx) => {
    if (ctx.name && output && process.env.E2E_VERBOSE) {
      console.log(output);
    }
  });

  const send = (type, payload) => gladys.state.ws.send(JSON.stringify({ type, payload }));

  await t.test('on connection: logs in to Airzone and publishes the discovered zones', async () => {
    await waitUntil(
      () => gladys.state.discoveredDevicePosts.length >= 1,
      `initial discovery\n${output}`,
    );

    // The startup line names the running version (asked for in every bug report).
    assert.match(output, /Starting the Airzone Cloud integration v\d+\.\d+\.\d+\.\.\./);

    const login = airzone.requests.find((r) => r.path === '/auth/login');
    assert.ok(login, 'the integration logged in to Airzone');
    assert.equal(login.body.email, 'user@example.com');
    assert.equal(login.body.password, 'secret');

    const devices = gladys.state.discoveredDevicePosts.at(-1);
    // One zone + one air-quality sensor.
    assert.equal(devices.length, 2);

    const zone = devices.find((d) => d.external_id === `ext:${SELECTOR}:zone:zone-1`);
    assert.ok(zone, 'the zone was published');
    assert.equal(zone.name, 'Living room');
    assert.equal(zone.poll_frequency, 60000);
    assert.equal(zone.should_poll, true);
    assert.deepEqual(zone.params, [{ name: 'installationId', value: 'install-1' }]);
    assert.deepEqual(
      zone.features.map((f) => f.external_id),
      [
        `ext:${SELECTOR}:zone:zone-1:power`,
        `ext:${SELECTOR}:zone:zone-1:mode`,
        `ext:${SELECTOR}:zone:zone-1:temperature`,
        `ext:${SELECTOR}:zone:zone-1:room-temperature`,
        `ext:${SELECTOR}:zone:zone-1:humidity`,
      ],
    );

    // The fake Gladys host has no device created yet: the integration must say
    // so, a device absent from Gladys silently drops the states we publish.
    await waitUntil(
      () => /are not added in Gladys yet/.test(output),
      `missing devices warning\n${output}`,
    );
    assert.match(output, /2\/2 Airzone device\(s\) are not added in Gladys yet/);
    assert.match(output, /Living room, Air quality/);

    const airq = devices.find((d) => d.external_id === `ext:${SELECTOR}:airq:airq-1`);
    assert.ok(airq, 'the air-quality sensor was published');
    assert.equal(airq.name, 'Air quality');
    assert.deepEqual(
      airq.features.map((f) => f.external_id.split(':').pop()),
      ['temperature', 'humidity', 'co2', 'pm25', 'pm10', 'tvoc', 'pressure', 'air-quality-index'],
    );
  });

  await t.test('on connection: reports the transports and the connection status', async () => {
    await waitUntil(
      () => gladys.state.connectionStatusPosts.length >= 1,
      `connection status\n${output}`,
    );
    // Airzone is a cloud-only integration: every device reports the cloud
    // channel, nominal (no degraded flag).
    assert.deepEqual(gladys.state.transportPosts.at(-1), [
      { device_external_id: `ext:${SELECTOR}:zone:zone-1`, transport: 'cloud' },
      { device_external_id: `ext:${SELECTOR}:airq:airq-1`, transport: 'cloud' },
    ]);
    assert.deepEqual(gladys.state.connectionStatusPosts.at(-1), { connected: true });
  });

  await t.test('a scan request republishes the devices', async () => {
    const before = gladys.state.discoveredDevicePosts.length;
    send('external-integration.scan-request', {});
    await waitUntil(
      () => gladys.state.discoveredDevicePosts.length > before,
      `scan republish\n${output}`,
    );
    assert.equal(gladys.state.discoveredDevicePosts.at(-1).length, 2);
  });

  const pollDevice = {
    external_id: `ext:${SELECTOR}:zone:zone-1`,
    selector: `ext-${SELECTOR}-zone-zone-1`,
    params: [{ name: 'installationId', value: 'install-1' }],
  };

  await t.test('a poll command publishes the zone states', async () => {
    send('external-integration.device.poll', { message_id: 'poll-1', device: pollDevice });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'poll-1'),
      `poll ack\n${output}`,
    );

    const ack = gladys.state.commandResults.find((r) => r.message_id === 'poll-1');
    assert.equal(ack.success, true, ack.error);

    const states = gladys.state.statePosts.at(-1);
    assert.deepEqual(states, [
      { device_feature_external_id: `ext:${SELECTOR}:zone:zone-1:power`, state: 1 },
      { device_feature_external_id: `ext:${SELECTOR}:zone:zone-1:temperature`, state: 21 },
      { device_feature_external_id: `ext:${SELECTOR}:zone:zone-1:room-temperature`, state: 19.5 },
      { device_feature_external_id: `ext:${SELECTOR}:zone:zone-1:humidity`, state: 42 },
      { device_feature_external_id: `ext:${SELECTOR}:zone:zone-1:mode`, state: AC_MODE.HEATING },
    ]);

    const status = airzone.requests.at(-1);
    assert.equal(status.path, '/devices/zone-1/status');
  });

  await t.test('a set-value command writes the parameter back to Airzone', async () => {
    send('external-integration.device.set-value', {
      message_id: 'set-1',
      device: pollDevice,
      device_feature: {
        external_id: `ext:${SELECTOR}:zone:zone-1:mode`,
        category: 'air-conditioning',
        type: 'mode',
      },
      value: AC_MODE.COOLING,
    });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'set-1'),
      `set ack\n${output}`,
    );

    const ack = gladys.state.commandResults.find((r) => r.message_id === 'set-1');
    assert.equal(ack.success, true, ack.error);

    const patch = airzone.requests.findLast(
      (r) => r.method === 'PATCH' && r.path === '/devices/zone-1',
    );
    assert.ok(patch, 'the integration called PATCH /devices/zone-1');
    assert.deepEqual(patch.body, { param: 'mode', value: 2, installation_id: 'install-1' });
  });

  await t.test('a set-value command on an unknown feature is acked as failed', async () => {
    send('external-integration.device.set-value', {
      message_id: 'set-2',
      device: pollDevice,
      device_feature: {
        external_id: `ext:${SELECTOR}:zone:zone-1:unknown`,
        category: 'air-conditioning',
        type: 'mode',
      },
      value: 1,
    });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'set-2'),
      `fail ack\n${output}`,
    );
    const ack = gladys.state.commandResults.find((r) => r.message_id === 'set-2');
    assert.equal(ack.success, false);
    assert.match(ack.error, /not controllable/);
  });

  await t.test('the verbose logs option switches the log level at runtime', async () => {
    // Gladys does not inject LOG_LEVEL: without the option, debug lines stay out
    // of the Logs tab.
    assert.doesNotMatch(output, /\[DEBUG\]/);

    send('external-integration.config-updated', {
      config: { email: 'user@example.com', password: 'secret', verbose_logs: true },
    });
    await waitUntil(() => /\[DEBUG\]/.test(output), `debug logs\n${output}`);
    assert.match(output, /Verbose logs enabled/);
  });

  await t.test('a failing poll flags the device transport as degraded', async () => {
    const unknownDevice = {
      external_id: `ext:${SELECTOR}:zone:unknown-zone`,
      selector: `ext-${SELECTOR}-zone-unknown-zone`,
      params: [{ name: 'installationId', value: 'install-1' }],
    };
    // The fake Airzone API answers 404 for an unknown device.
    send('external-integration.device.poll', { message_id: 'poll-2', device: unknownDevice });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'poll-2'),
      `failing poll ack\n${output}`,
    );
    const ack = gladys.state.commandResults.find((r) => r.message_id === 'poll-2');
    assert.equal(ack.success, false);

    await waitUntil(
      () => (gladys.state.transportPosts.at(-1) || []).some((entry) => entry.degraded),
      `degraded transport\n${output}`,
    );
    const [entry] = gladys.state.transportPosts.at(-1);
    assert.equal(entry.device_external_id, unknownDevice.external_id);
    assert.equal(entry.transport, 'cloud');
    assert.equal(entry.degraded, true);
    assert.match(entry.message.en, /Airzone Cloud refused the last refresh/);
    assert.match(output, /onPoll .*unknown-zone failed/);
  });
});

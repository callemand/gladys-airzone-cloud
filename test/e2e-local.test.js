// End-to-end test of the LOCAL API path: the integration still discovers through
// the cloud (that is where the device identity comes from), but every poll and
// every command goes to the webserver on the LAN — and falls back to the cloud
// when the webserver stops answering.

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
  LOCAL_ZONE_STATUS,
  ZONE_STATUS,
  AIR_QUALITY_STATUS,
} from './fixtures.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELECTOR = 'airzone-local';
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

function startFakeCloud() {
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
      } else {
        respond(200, {});
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port }));
  });
}

function startFakeLocalApi(behaviour) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const path = new URL(req.url, 'http://localhost').pathname;
      requests.push({ method: req.method, path, body: body ? JSON.parse(body) : null });
      const respond = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (behaviour.down) {
        respond(503, { message: 'webserver rebooting' });
        return;
      }
      if (path === '/api/v1/version') {
        respond(200, { version: '1.62' });
      } else if (path === '/api/v1/hvac' && req.method === 'POST') {
        respond(200, { data: [LOCAL_ZONE_STATUS] });
      } else if (path === '/api/v1/hvac' && req.method === 'PUT') {
        respond(200, { data: [] });
      } else {
        respond(404, {});
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port }));
  });
}

function startFakeGladys(config) {
  const state = { statePosts: [], transportPosts: [], commandResults: [], ws: null };
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
        respond({ config });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/state') {
        state.statePosts.push(JSON.parse(body).states);
        respond({ success: true });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/device/transport') {
        state.transportPosts.push(JSON.parse(body).transports);
        respond({ success: true });
      } else {
        respond({ success: true });
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

test('the integration uses the local API when it is configured', async (t) => {
  const cloud = await startFakeCloud();
  const behaviour = { down: false };
  const local = await startFakeLocalApi(behaviour);
  const gladys = await startFakeGladys({
    email: 'user@example.com',
    password: 'secret',
    local_host: '127.0.0.1',
    local_port: local.port,
  });
  t.after(() => {
    cloud.server.close();
    local.server.close();
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
      AIRZONE_ENDPOINT: `http://127.0.0.1:${cloud.port}`,
    },
  });
  child.stdout.on('data', (d) => {
    output += d;
  });
  child.stderr.on('data', (d) => {
    output += d;
  });
  t.after(() => child.kill('SIGKILL'));

  const send = (type, payload) => gladys.state.ws.send(JSON.stringify({ type, payload }));

  const device = {
    external_id: `ext:${SELECTOR}:zone:zone-1`,
    selector: `ext-${SELECTOR}-zone-zone-1`,
    params: [
      { name: 'installationId', value: 'install-1' },
      { name: 'systemId', value: '1' },
      { name: 'zoneId', value: '2' },
    ],
  };

  await t.test('it probes the webserver and announces the local channel', async () => {
    await waitUntil(() => /Local API reachable/.test(output), `local probe\n${output}`);
    assert.match(output, /Local API configured on http:\/\/127\.0\.0\.1:\d+/);
    assert.match(output, /version 1\.62/);

    await waitUntil(() => gladys.state.transportPosts.length >= 1, `transports\n${output}`);
    const zoneEntry = gladys.state.transportPosts
      .at(-1)
      .find((entry) => entry.device_external_id === device.external_id);
    assert.equal(zoneEntry.transport, 'local');
  });

  await t.test('a poll reads the zone from the webserver, not from the cloud', async () => {
    const cloudStatusesBefore = cloud.requests.filter((r) => r.path.endsWith('/status')).length;
    send('external-integration.device.poll', { message_id: 'poll-1', device });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'poll-1'),
      `poll ack\n${output}`,
    );
    const ack = gladys.state.commandResults.find((r) => r.message_id === 'poll-1');
    assert.equal(ack.success, true, ack.error);

    assert.deepEqual(local.requests.at(-1), {
      method: 'POST',
      path: '/api/v1/hvac',
      body: { systemID: 1, zoneID: 2 },
    });
    // Not a single extra cloud request for this poll.
    assert.equal(
      cloud.requests.filter((r) => r.path.endsWith('/status')).length,
      cloudStatusesBefore,
    );

    assert.deepEqual(gladys.state.statePosts.at(-1), [
      { device_feature_external_id: `${device.external_id}:power`, state: 1 },
      { device_feature_external_id: `${device.external_id}:temperature`, state: 21 },
      { device_feature_external_id: `${device.external_id}:room-temperature`, state: 19.5 },
      { device_feature_external_id: `${device.external_id}:humidity`, state: 42 },
      { device_feature_external_id: `${device.external_id}:mode`, state: AC_MODE.HEATING },
    ]);
  });

  await t.test('a command is written to the webserver', async () => {
    send('external-integration.device.set-value', {
      message_id: 'set-1',
      device,
      device_feature: {
        external_id: `${device.external_id}:temperature`,
        category: 'air-conditioning',
        type: 'target-temperature',
      },
      value: 22,
    });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'set-1'),
      `set ack\n${output}`,
    );
    const ack = gladys.state.commandResults.find((r) => r.message_id === 'set-1');
    assert.equal(ack.success, true, ack.error);

    assert.deepEqual(local.requests.at(-1), {
      method: 'PUT',
      path: '/api/v1/hvac',
      body: { systemID: 1, zoneID: 2, setpoint: 22 },
    });
    // The cloud was not asked to write anything.
    assert.equal(cloud.requests.filter((r) => r.method === 'PATCH').length, 0);
  });

  await t.test('a webserver that stops answering falls back to the cloud', async () => {
    behaviour.down = true;
    send('external-integration.device.poll', { message_id: 'poll-2', device });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'poll-2'),
      `fallback ack\n${output}`,
    );
    const ack = gladys.state.commandResults.find((r) => r.message_id === 'poll-2');
    assert.equal(ack.success, true, ack.error);

    // The states came from the cloud this time (cloud setpoint of the heating
    // mode is 21 too, so identify the source by the request itself).
    assert.equal(cloud.requests.at(-1).path, '/devices/zone-1/status');
    assert.match(output, /Local API failed .*falling back to the Airzone Cloud API/);

    // The badge says cloud, flagged degraded with the reason.
    await waitUntil(
      () => (gladys.state.transportPosts.at(-1) || []).some((entry) => entry.degraded),
      `degraded transport\n${output}`,
    );
    const [entry] = gladys.state.transportPosts.at(-1);
    assert.equal(entry.device_external_id, device.external_id);
    assert.equal(entry.transport, 'cloud');
    assert.equal(entry.degraded, true);
    assert.match(entry.message.en, /Local API unreachable, using the cloud/);
  });

  await t.test('the next polls stay on the cloud during the cooldown', async () => {
    behaviour.down = false;
    const localRequestsBefore = local.requests.length;
    send('external-integration.device.poll', { message_id: 'poll-3', device });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'poll-3'),
      `cooldown ack\n${output}`,
    );
    // A rebooting webserver must not slow every poll down for a minute.
    assert.equal(local.requests.length, localRequestsBefore);
    assert.equal(cloud.requests.at(-1).path, '/devices/zone-1/status');
  });
});

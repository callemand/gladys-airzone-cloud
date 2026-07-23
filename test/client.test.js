import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { AirzoneCloudClient } from '../src/airzone/client.js';
import {
  INSTALLATIONS_RESPONSE,
  INSTALLATION_DETAIL_RESPONSE,
  ZONE_STATUS,
  AIR_QUALITY_STATUS,
} from './fixtures.js';

// Tiny fake Airzone Cloud API. `behaviour` is mutated by the tests.
function startFakeAirzone(behaviour) {
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
        query: Object.fromEntries(url.searchParams),
        authorization: req.headers.authorization,
        body: body ? JSON.parse(body) : null,
      });
      const respond = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (url.pathname === '/auth/login') {
        respond(200, behaviour.loginResponse);
        return;
      }
      if (url.pathname.startsWith('/auth/refreshToken/')) {
        respond(200, behaviour.refreshResponse);
        return;
      }
      if (behaviour.failNextWith401) {
        behaviour.failNextWith401 = false;
        respond(401, {});
        return;
      }
      if (url.pathname === '/installations') {
        respond(200, INSTALLATIONS_RESPONSE);
        return;
      }
      if (url.pathname === '/installations/install-1') {
        respond(200, INSTALLATION_DETAIL_RESPONSE);
        return;
      }
      if (url.pathname === '/devices/zone-1/status') {
        respond(200, { status: ZONE_STATUS });
        return;
      }
      if (url.pathname === '/devices/airq-1/status') {
        respond(200, { status: AIR_QUALITY_STATUS });
        return;
      }
      if (url.pathname === '/devices/zone-1' && req.method === 'PATCH') {
        respond(200, {});
        return;
      }
      respond(404, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, requests, port: server.address().port });
    });
  });
}

test('AirzoneCloudClient', async (t) => {
  const behaviour = {
    loginResponse: { token: 'access-1', refreshToken: 'refresh-1' },
    refreshResponse: { token: 'access-2', refreshToken: 'refresh-2' },
    failNextWith401: false,
  };
  const { server, requests, port } = await startFakeAirzone(behaviour);
  t.after(() => server.close());

  const client = new AirzoneCloudClient(`http://127.0.0.1:${port}`);

  await t.test('login stores the token and sends the expected payload', async () => {
    await client.login('user@example.com', 'secret');
    assert.equal(client.isLoggedIn(), true);
    const login = requests.at(-1);
    assert.equal(login.path, '/auth/login');
    assert.deepEqual(login.body, { email: 'user@example.com', password: 'secret' });
  });

  await t.test('listZones flattens installations and keeps only zones', async () => {
    const zones = await client.listZones();
    assert.deepEqual(
      zones.map((z) => z.device_id),
      ['zone-1'],
    );
    assert.equal(zones[0].installationId, 'install-1');
    assert.deepEqual(zones[0].status, ZONE_STATUS);
    // Every authenticated request carried the access token.
    assert.equal(requests.at(-1).authorization, 'Bearer access-1');
  });

  await t.test('listAirQualitySensors keeps only az_airqsensor devices', async () => {
    const sensors = await client.listAirQualitySensors();
    assert.deepEqual(
      sensors.map((s) => s.device_id),
      ['airq-1'],
    );
    assert.equal(sensors[0].installationId, 'install-1');
    assert.deepEqual(sensors[0].status, AIR_QUALITY_STATUS);
  });

  await t.test('getZoneStatus passes the installation id and unwraps the status', async () => {
    const status = await client.getZoneStatus('zone-1', 'install-1');
    assert.deepEqual(status, ZONE_STATUS);
    assert.deepEqual(requests.at(-1).query, { installation_id: 'install-1' });
  });

  await t.test('setZoneParam sends a PATCH with param, value and installation id', async () => {
    await client.setZoneParam('zone-1', 'install-1', { param: 'power', value: true });
    const patch = requests.at(-1);
    assert.equal(patch.method, 'PATCH');
    assert.equal(patch.path, '/devices/zone-1');
    assert.deepEqual(patch.body, { param: 'power', value: true, installation_id: 'install-1' });
  });

  await t.test('setZoneParam forwards the opts object when present', async () => {
    await client.setZoneParam('zone-1', 'install-1', {
      param: 'setpoint',
      value: 22,
      opts: { units: 0 },
    });
    assert.deepEqual(requests.at(-1).body, {
      param: 'setpoint',
      value: 22,
      installation_id: 'install-1',
      opts: { units: 0 },
    });
  });

  await t.test('a 401 triggers a single token refresh and a retry', async () => {
    behaviour.failNextWith401 = true;
    const status = await client.getZoneStatus('zone-1', 'install-1');
    assert.deepEqual(status, ZONE_STATUS);
    // 401 -> refreshToken -> retried with the new access token.
    assert.equal(requests.at(-2).path.startsWith('/auth/refreshToken/'), true);
    assert.equal(requests.at(-1).authorization, 'Bearer access-2');
  });

  await t.test('a login without a token throws', async () => {
    behaviour.loginResponse = { error: 'bad credentials' };
    await assert.rejects(() => client.login('user@example.com', 'wrong'), /no token returned/);
    assert.equal(client.isLoggedIn(), false);
  });
});

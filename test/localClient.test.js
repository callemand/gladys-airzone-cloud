import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { AirzoneLocalClient } from '../src/airzone/localClient.js';
import { LOCAL_ZONE_STATUS } from './fixtures.js';

// Fake Airzone webserver local API. `behaviour` is mutated by the tests.
function startFakeLocalApi(behaviour) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        path: new URL(req.url, 'http://localhost').pathname,
        body: body ? JSON.parse(body) : null,
      });
      const respond = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (behaviour.down) {
        respond(500, { message: 'boom' });
        return;
      }
      if (req.url === '/api/v1/version') {
        respond(200, { version: '1.62' });
        return;
      }
      if (req.url === '/api/v1/hvac' && req.method === 'POST') {
        respond(200, behaviour.hvacResponse);
        return;
      }
      if (req.url === '/api/v1/hvac' && req.method === 'PUT') {
        respond(200, behaviour.putResponse);
        return;
      }
      respond(404, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port }));
  });
}

test('AirzoneLocalClient', async (t) => {
  const behaviour = {
    hvacResponse: { data: [LOCAL_ZONE_STATUS] },
    putResponse: { data: [{ systemID: 1, zoneID: 2, setpoint: 22 }] },
    down: false,
  };
  const { server, requests, port } = await startFakeLocalApi(behaviour);
  t.after(() => server.close());

  const client = new AirzoneLocalClient();

  await t.test('it is not configured until an address is given', async () => {
    assert.equal(client.isConfigured(), false);
    assert.equal(client.isUsable(), false);
    await assert.rejects(() => client.getVersion(), /not configured/);
  });

  await t.test('an empty address keeps it disabled', () => {
    assert.equal(client.configure('   ', null), false);
    assert.equal(client.isConfigured(), false);
  });

  await t.test('it accepts a bare host, a host:port and a full URL', () => {
    client.configure('192.168.1.10', null);
    assert.equal(client.baseUrl, 'http://192.168.1.10:3000');
    client.configure('192.168.1.10:8080', null);
    assert.equal(client.baseUrl, 'http://192.168.1.10:8080');
    // The port field wins over the one in the address.
    client.configure('http://192.168.1.10:8080', 3000);
    assert.equal(client.baseUrl, 'http://192.168.1.10:3000');
  });

  await t.test('getVersion probes the webserver', async () => {
    client.configure(`127.0.0.1`, port);
    assert.equal(client.isUsable(), true);
    const { version } = await client.getVersion();
    assert.equal(version, '1.62');
    assert.deepEqual(requests.at(-1), { method: 'POST', path: '/api/v1/version', body: {} });
  });

  await t.test('getZoneStatus posts the system/zone numbers and unwraps data[0]', async () => {
    const status = await client.getZoneStatus(1, 2);
    assert.deepEqual(status, LOCAL_ZONE_STATUS);
    assert.deepEqual(requests.at(-1), {
      method: 'POST',
      path: '/api/v1/hvac',
      body: { systemID: 1, zoneID: 2 },
    });
  });

  await t.test('getZoneStatus throws when the zone is unknown', async () => {
    behaviour.hvacResponse = { data: [] };
    await assert.rejects(() => client.getZoneStatus(9, 9), /no zone for system 9 \/ zone 9/);
    behaviour.hvacResponse = { data: [LOCAL_ZONE_STATUS] };
  });

  await t.test('setZoneParam PUTs the change next to the zone address', async () => {
    await client.setZoneParam(1, 2, { setpoint: 22 });
    assert.deepEqual(requests.at(-1), {
      method: 'PUT',
      path: '/api/v1/hvac',
      body: { systemID: 1, zoneID: 2, setpoint: 22 },
    });
  });

  await t.test('an `errors` array in a 200 answer is a failure', async () => {
    behaviour.putResponse = { errors: [{ zoneID: 2, error: 'Mode not allowed' }] };
    await assert.rejects(
      () => client.setZoneParam(1, 2, { mode: 3 }),
      /refused PUT.*Mode not allowed/,
    );
    behaviour.putResponse = { data: [] };
  });

  await t.test('a failure puts the local API in a cooldown', async () => {
    behaviour.down = true;
    await assert.rejects(() => client.getZoneStatus(1, 2), /HTTP 500/);
    behaviour.down = false;

    // The client only enters the cooldown when told to: the caller decides,
    // right after falling back to the cloud.
    assert.equal(client.isUsable(), true);
    client.noteFailure();
    assert.equal(client.isConfigured(), true);
    assert.equal(client.isUsable(), false);

    // Reconfiguring on another address clears it (the user fixed the address).
    client.configure('127.0.0.1', 9999);
    assert.equal(client.isUsable(), true);
  });
});

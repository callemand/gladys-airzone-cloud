// End-to-end test of an Airzone Cloud outage AT STARTUP: the login fails, so the
// integration has no session. It must report the failure, arm a retry and stop
// answering every poll with an error line — before this, a failed initialization
// was terminal (every poll failed until the container was restarted) and flooded
// the Logs tab.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELECTOR = 'airzone-outage';
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

// Airzone Cloud is down: every request is rejected.
function startBrokenAirzone() {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Service Unavailable' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port }));
  });
}

function startFakeGladys() {
  const state = { connectionStatusPosts: [], commandResults: [], ws: null };
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
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/connection_status') {
        state.connectionStatusPosts.push(JSON.parse(body));
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

test('the integration survives an Airzone Cloud outage at startup', async (t) => {
  const airzone = await startBrokenAirzone();
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

  await t.test('it reports the failure and arms a retry', async () => {
    await waitUntil(
      () => /Retrying the connection to Airzone Cloud/.test(output),
      `retry scheduled\n${output}`,
    );
    assert.match(output, /Connection to Airzone Cloud failed/);
    assert.match(output, /Retrying the connection to Airzone Cloud in 30 s/);
    assert.deepEqual(gladys.state.connectionStatusPosts.at(-1).connected, false);
  });

  await t.test('a poll without a session is a quiet no-op', async () => {
    const device = {
      external_id: `ext:${SELECTOR}:zone:zone-1`,
      selector: `ext-${SELECTOR}-zone-zone-1`,
      params: [{ name: 'installationId', value: 'install-1' }],
    };
    for (const messageId of ['poll-1', 'poll-2', 'poll-3']) {
      send('external-integration.device.poll', { message_id: messageId, device });
    }
    await waitUntil(
      () =>
        gladys.state.commandResults.filter((r) => r.message_id.startsWith('poll-')).length === 3,
      `poll acks\n${output}`,
    );

    // The session loss is reported ONCE, not once per device and per poll.
    const sessionLossLines = output.match(/Airzone Cloud session is down/g) || [];
    assert.equal(sessionLossLines.length, 1);
    assert.doesNotMatch(output, /onPoll .* failed: Airzone Cloud is not connected/);
  });
});

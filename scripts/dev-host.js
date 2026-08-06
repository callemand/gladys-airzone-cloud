// -----------------------------------------------------------------------------
// Local development host: plays the role of Gladys so the integration can be run
// against a REAL Airzone installation, without building an image nor touching a
// Gladys instance.
//
//   AIRZONE_EMAIL=you@example.com AIRZONE_PASSWORD=secret \
//   AIRZONE_LOCAL_HOST=192.168.1.42 npm run dev
//
// It starts the same REST + WebSocket contract as the Gladys host API, spawns
// index.js against it, then:
//   - serves the config from the environment variables above;
//   - prints every discovered device, state, transport badge and connection
//     status the integration publishes;
//   - polls every discovered device on a loop (every DEV_POLL_SECONDS, 15 by
//     default), like the Gladys scheduler does;
//   - can run one command at startup: DEV_SET=<feature-code>=<value>
//     (e.g. DEV_SET=temperature=21, DEV_SET=power=1).
//
// Not shipped in the Docker image (the Dockerfile only copies index.js, src/ and
// the manifest).
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.DEV_PORT) || 1444;
const POLL_SECONDS = Number(process.env.DEV_POLL_SECONDS) || 15;
const TOKEN = 'dev-token';
const SELECTOR = process.env.DEV_SELECTOR || 'airzone-dev';

const CONFIG = {
  email: process.env.AIRZONE_EMAIL || null,
  password: process.env.AIRZONE_PASSWORD || null,
  local_host: process.env.AIRZONE_LOCAL_HOST || null,
  local_port: process.env.AIRZONE_LOCAL_PORT ? Number(process.env.AIRZONE_LOCAL_PORT) : null,
  verbose_logs: process.env.AIRZONE_VERBOSE !== 'false',
};

// Devices the integration discovered: the poll loop walks this list, exactly
// like Gladys polls the devices the user created.
let devices = [];
let messageId = 0;

const log = (...args) => console.log('\x1b[36m[dev-host]\x1b[0m', ...args);

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
    const payload = body ? JSON.parse(body) : {};

    if (req.method === 'GET' && req.url === '/api/integration/v1/config') {
      respond({ config: CONFIG });
      return;
    }
    // Every discovered device is treated as created, so the integration does not
    // warn about devices missing from Gladys and the poll loop has work to do.
    if (req.method === 'GET' && req.url === '/api/integration/v1/device') {
      respond(devices);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/integration/v1/discovered_device') {
      devices = payload.devices.map(({ external_id: externalId, name, params }) => ({
        external_id: externalId,
        selector: externalId.replace(/[:.]/g, '-'),
        name,
        params,
      }));
      log(`discovered ${devices.length} device(s):`);
      payload.devices.forEach((device) => {
        // `model` is the webserver type reported by Airzone (ws_type): it tells
        // which hardware answers, and therefore whether the local API can exist.
        log(`  - ${device.name} (${device.external_id}) model/ws_type: ${device.model}`);
        log(
          `    features: ${device.features.map((f) => f.external_id.split(':').pop()).join(', ')}`,
        );
        log(`    params: ${JSON.stringify(device.params)}`);
      });
      respond({ success: true, count: devices.length });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/integration/v1/state') {
      payload.states.forEach(({ device_feature_external_id: id, state }) =>
        log(`state ${id.split(`${SELECTOR}:`).pop()} = ${state}`),
      );
      respond({ success: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/integration/v1/device/transport') {
      payload.transports.forEach((entry) =>
        log(
          `transport ${entry.device_external_id.split(`${SELECTOR}:`).pop()} -> ${entry.transport}` +
            `${entry.degraded ? ` (degraded: ${entry.message?.en})` : ''}`,
        ),
      );
      respond({ success: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/integration/v1/connection_status') {
      log(
        `connection status: ${payload.connected}${payload.message ? ` — ${payload.message.en}` : ''}`,
      );
      respond({ success: true });
      return;
    }
    respond({ success: true });
  });
});

const wss = new WebSocketServer({ server });
let socket = null;

wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'authenticate.integration-request') {
      ws.send(JSON.stringify({ type: 'authentication.connected', payload: {} }));
      return;
    }
    if (message.type === 'external-integration.command-result') {
      const { message_id: id, success, error } = message.payload;
      if (!success) {
        log(`\x1b[31mcommand ${id} failed: ${error}\x1b[0m`);
      }
    }
  });
});

const send = (type, payload) => {
  if (socket) {
    socket.send(JSON.stringify({ type, payload }));
  }
};

server.listen(PORT, '127.0.0.1', () => {
  log(`Gladys stand-in listening on http://127.0.0.1:${PORT}`);
  log(
    `config: email=${CONFIG.email ? 'set' : 'MISSING'} local_host=${CONFIG.local_host || 'none (cloud only)'}`,
  );

  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: `http://127.0.0.1:${PORT}`,
      GLADYS_INTEGRATION_TOKEN: TOKEN,
      GLADYS_INTEGRATION_SELECTOR: SELECTOR,
      LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
    },
  });

  const stop = () => {
    child.kill('SIGTERM');
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => {
    log(`the integration exited with code ${code}`);
    server.close();
    process.exit(code ?? 0);
  });

  // Poll loop: what the Gladys scheduler does, sequentially (concurrency 1).
  setInterval(async () => {
    for (const device of devices) {
      messageId += 1;
      send('external-integration.device.poll', { message_id: `poll-${messageId}`, device });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }, POLL_SECONDS * 1000).unref();

  // Optional one-shot command, 5 s after startup: DEV_SET=temperature=21
  if (process.env.DEV_SET) {
    const [featureCode, rawValue] = process.env.DEV_SET.split('=');
    setTimeout(() => {
      const device = devices.find(({ external_id: id }) => id.includes(':zone:'));
      if (!device) {
        log('DEV_SET: no zone discovered yet');
        return;
      }
      log(`DEV_SET -> ${featureCode} = ${rawValue} on ${device.name}`);
      send('external-integration.device.set-value', {
        message_id: 'dev-set',
        device,
        device_feature: { external_id: `${device.external_id}:${featureCode}` },
        value: Number(rawValue),
      });
    }, 5000).unref();
  }
});

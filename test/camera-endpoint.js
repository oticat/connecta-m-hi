'use strict';
// Integration test for the camera endpoint refresh (1.15.0).
// Runs the real server.js against a fake control plane and two fake cam
// WebSockets, and proves the hub follows the relay the control plane reports
// instead of the snapshot baked in at link time — including bootstrapping from
// a pre-1.15 config that only has the HA token.
// Run: npm install --no-save ws && node test/camera-endpoint.js
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'data/opt/dom.oti.cat/server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(fn, timeout = 8000, step = 100) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(step);
  }
  return false;
}

function camServer(port, hits) {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  wss.on('connection', (ws) => {
    hits.push(port);
    ws.send(JSON.stringify({ type: 'welcome', name: 'test' }));
  });
  return wss;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cam-'));
  const cfgPath = path.join(dir, 'config.json');
  const readCfg = () => JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  // Pre-1.15 config: HA token only, no device token, cam snapshot pointing at a
  // relay that is already gone.
  fs.writeFileSync(cfgPath, JSON.stringify({
    token: 'HA_TOKEN', wsUrl: 'ws://127.0.0.1:1/ws', name: 'Personal',
    deviceId: 'aa:bb:cc:dd:ee:ff',
    cam: { token: 'STALE', wsUrl: 'ws://127.0.0.1:1/ws' },
  }));

  const port1 = await freePort();
  const port2 = await freePort();
  const hits1 = [];
  const hits2 = [];
  const s1 = camServer(port1, hits1);
  const s2 = camServer(port2, hits2);

  // Control plane: first says relay 1, then relay 2, then "no relay".
  let phase = 1;
  let endpointCalls = 0;
  const authSeen = [];
  const apiPort = await freePort();
  const api = http.createServer((req, res) => {
    if (req.url.startsWith('/api/cameras/endpoint')) {
      endpointCalls++;
      authSeen.push(req.headers['x-device-token']);
      const body = phase === 1
        ? { cam: { ws: 'ws://127.0.0.1:' + port1 + '/ws', token: 'T1' }, deviceToken: 'NEW_DEVICE' }
        : phase === 2
          ? { cam: { ws: 'ws://127.0.0.1:' + port2 + '/ws', token: 'T2' }, deviceToken: 'NEW_DEVICE' }
          : { cam: null, deviceToken: 'NEW_DEVICE' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(401);
    res.end('{}');
  });
  await new Promise(r => api.listen(apiPort, '127.0.0.1', r));

  const hubPort = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      DOMOTICAT_PORT: String(hubPort),
      DOMOTICAT_CONFIG_DIR: dir,
      DOMOTICAT_API: 'http://127.0.0.1:' + apiPort,
      DOMOTICAT_CAM_POLL_CONNECTED_MS: '800',
      DOMOTICAT_CAM_POLL_BROKEN_MS: '800',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });

  const results = {};
  try {
    results.boot_follows_control_plane =
      await waitFor(() => hits1.length > 0) && !hits2.length;

    results.bootstrapped_with_ha_token = authSeen[0] === 'HA_TOKEN';
    results.adopted_device_token = await waitFor(() => readCfg().deviceToken === 'NEW_DEVICE');
    results.persisted_relay1 = readCfg().cam && readCfg().cam.wsUrl === 'ws://127.0.0.1:' + port1 + '/ws';

    phase = 2;
    results.relay_switch = await waitFor(() => hits2.length > 0);
    results.persisted_relay2 = readCfg().cam && readCfg().cam.wsUrl === 'ws://127.0.0.1:' + port2 + '/ws';

    phase = 3;
    results.relay_removed = await waitFor(() => !readCfg().cam);
    results.device_token_kept = readCfg().deviceToken === 'NEW_DEVICE';
    results.endpoint_was_polled = endpointCalls >= 3;
  } finally {
    child.kill('SIGTERM');
    try { s1.close(); } catch {}
    try { s2.close(); } catch {}
    try { api.close(); } catch {}
  }

  console.log(results);
  const pass = Object.values(results).every(Boolean);
  if (!pass) console.log(out.split('\n').filter(l => /cam |endpoint/i.test(l)).join('\n'));
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();

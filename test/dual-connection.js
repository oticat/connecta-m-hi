'use strict';
// Local integration test for the dual-connection refactor.
// Runs the real server.js against two fake WebSocket servers (ha + cam) and
// proves both tunnels work at the same time over separate sockets.
// Run: npm install --no-save ws && node test/dual-connection.js
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
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

function echoServer() {
  return new Promise((resolve, reject) => {
    const s = net.createServer((c) => {
      c.on('data', (b) => c.write(b));
      c.on('error', () => {});
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
}

function tunnel(label, wsPort, targetPort) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: wsPort, host: '127.0.0.1' });
    const connId = 'conn-' + label;
    let sent = false;
    let sock = null;

    const timer = setTimeout(() => {
      done(new Error(label + ': timeout'));
    }, 10000);

    function cleanup() {
      clearTimeout(timer);
      try { sock && sock.close(); } catch {}
      try { wss.close(); } catch {}
    }

    function done(err, value) {
      clearTimeout(timer);
      if (err) {
        cleanup();
        reject(err);
      } else {
        // Keep the socket open: the caller checks /status.json next.
        resolve(value);
      }
    }

    wss.on('connection', (s) => {
      sock = s;
      s.on('error', (e) => done(e));
      s.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'hello') {
          if (msg.token !== label + '-token') {
            return done(new Error(label + ': unexpected token ' + msg.token));
          }
          s.send(JSON.stringify({ type: 'welcome', name: label }));
          s.send(JSON.stringify({
            type: 'socks5', conn_id: connId, event: 'connect',
            host: '127.0.0.1', port: targetPort,
          }));
        } else if (msg.type === 'socks5') {
          if (msg.event === 'connected' && !sent) {
            sent = true;
            s.send(JSON.stringify({
              type: 'socks5', conn_id: connId, event: 'data',
              data: Buffer.from('ping-' + label).toString('base64'),
            }));
          } else if (msg.event === 'data') {
            const got = Buffer.from(msg.data, 'base64').toString();
            if (got === 'ping-' + label) {
              done(null, { label, got, close: cleanup });
            }
          } else if (msg.event === 'error') {
            done(new Error(label + ': tunnel error ' + msg.message));
          }
        }
      });
    });
    wss.on('error', (e) => done(e));
  });
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const haWs = await freePort();
  const camWs = await freePort();
  const echoHa = await echoServer();
  const echoCam = await echoServer();
  const hubPort = await freePort();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oticat-dual-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    token: 'ha-token',
    name: 'test-home',
    wsUrl: 'ws://127.0.0.1:' + haWs,
    deviceId: 'aa:bb:cc:dd:ee:ff',
    cam: { token: 'cam-token', wsUrl: 'ws://127.0.0.1:' + camWs },
  }));

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DOMOTICAT_CONFIG_DIR: dir, DOMOTICAT_PORT: String(hubPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('[hub] ' + d));
  child.stderr.on('data', (d) => process.stdout.write('[hub!] ' + d));

  try {
    const [ha, cam] = await Promise.all([
      tunnel('ha', haWs, echoHa.address().port),
      tunnel('cam', camWs, echoCam.address().port),
    ]);
    console.log('tunnels:', ha.got, '/', cam.got);

    const status = await getJSON('http://127.0.0.1:' + hubPort + '/status.json');
    console.log('status:', JSON.stringify(status));

    if (!status.connected) throw new Error('ha connection not reported');
    if (!status.camConnected) throw new Error('cam connection not reported');

    ha.close();
    cam.close();
    console.log('PASS: both connections live, both tunnels relayed');
  } finally {
    child.kill('SIGTERM');
    echoHa.close();
    echoCam.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});

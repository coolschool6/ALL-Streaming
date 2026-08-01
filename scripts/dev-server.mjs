// Local dev/test server for ALLStreaming.
// Usage:
//   node scripts/dev-server.mjs            # real handlers; needs env keys
//   MOCK=1 node scripts/dev-server.mjs     # mock /api/torbox-source (playback testing)
//   PORT=8080 node scripts/dev-server.mjs
//
// Loads .env.local if present. Serves the SPA from the project root and mounts
// the Vercel-style handlers in /api by dynamic import.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = parseInt(process.env.PORT || '8080', 10);
const MOCK = process.env.MOCK === '1';

// --- load .env.local ---
const envPath = join(ROOT, '.env.local');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !m[1].startsWith('#') && m[2]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers) {
  res.writeHead(status, headers || { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

// Build a Vercel-style req object for the handlers.
async function makeReq(req, bodyText) {
  const url = new URL(req.url, 'http://localhost');
  const query = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  let body = null;
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch (e) { body = null; }
  }
  return { query, body, method: req.method, headers: req.headers, url: req.url };
}

// Mock stream response for playback testing without a TorBox key.
// Uses Mux's public test HLS stream so the player pipeline is fully exercised.
const MOCK_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

function mockTorboxSource(req) {
  if (req.query.action === 'progress') {
    return { status: 200, payload: { hlsUrl: MOCK_HLS, source: 'TorBox (MOCK)', debug: { mock: true } } };
  }
  return {
    status: 200,
    payload: {
      hlsUrl: MOCK_HLS,
      source: 'TorBox (MOCK)',
      debug: { mock: true },
      mock: true
    }
  };
}

async function mountApi(routePath, req, res, bodyText) {
  const abs = join(ROOT, 'api', routePath + '.js');
  if (!existsSync(abs)) return false;
  const mod = await import('file:///' + abs.split('\\').join('/'));
  const handler = mod.default;
  if (typeof handler !== 'function') return false;
  const vreq = await makeReq(req, bodyText);
  let sent = false;
  const vres = {
    setHeader() {},
    status(c) { this._status = c; return this; },
    end(b) { sent = true; send(res, this._status || 200, b || '', { 'Content-Type': 'text/plain; charset=utf-8' }); },
    json(o) { sent = true; sendJson(res, this._status || 200, o); },
    send(b) {
      sent = true;
      const headers = { 'Content-Type': 'application/octet-stream' };
      if (Buffer.isBuffer(b)) { headers['Content-Length'] = b.length; }
      send(res, this._status || 200, b, headers);
    }
  };
  try {
    await handler(vreq, vres);
  } catch (e) {
    if (!sent) sendJson(res, 500, { error: 'Handler error: ' + String(e && e.message || e) });
    return true;
  }
  if (!sent) sendJson(res, vres._status || 200, { error: 'no response' });
  return true;
}

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);

  // API routes
  const apiMatch = /^\/api\/([a-z0-9-]+)$/i.exec(pathname);
  if (apiMatch) {
    const route = apiMatch[1];
    if (route === 'torbox-source' && MOCK) {
      const vreq = await makeReq(req, '');
      sendJson(res, 200, mockTorboxSource(vreq));
      return;
    }
    const bodyText = req.method === 'POST' ? await readBody(req) : '';
    const handled = await mountApi(route, req, res, bodyText);
    if (handled) return;
    sendJson(res, 404, { error: 'No such api route: ' + route });
    return;
  }

  // Static files (with SPA fallback to index.html)
  let filePath = pathname === '/' ? '/index.html' : pathname;
  let abs = normalize(join(ROOT, filePath));
  if (!abs.startsWith(ROOT)) abs = join(ROOT, 'index.html');
  if (!existsSync(abs) || statSync(abs).isDirectory()) {
    abs = join(ROOT, 'index.html');
  }
  try {
    const content = readFileSync(abs);
    const type = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
    send(res, 200, content, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log('[dev-server] ALLStreaming local server');
  console.log('[dev-server]   http://localhost:' + PORT);
  console.log('[dev-server]   MOCK mode: ' + (MOCK ? 'ON (mock TorBox stream)' : 'OFF (real API handlers)'));
  console.log('[dev-server]   TORBOX_API_KEY ' + (process.env.TORBOX_API_KEY ? 'present' : 'MISSING'));
});

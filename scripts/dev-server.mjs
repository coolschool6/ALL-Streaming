import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './load-env.mjs';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const apiModules = {};

loadEnv();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mjs': 'application/javascript; charset=utf-8'
};

function parseBody(text, contentType) {
  if (!text) return null;
  if ((contentType || '').includes('application/json')) {
    try { return JSON.parse(text); } catch (err) { return null; }
  }
  if ((contentType || '').includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return text;
}

function collectBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function createResponseAdapter(res) {
  let statusCode = 200;
  return {
    setHeader(name, value) {
      res.setHeader(name, value);
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      res.statusCode = statusCode;
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(payload));
      return this;
    },
    send(payload) {
      res.statusCode = statusCode;
      res.end(payload);
      return this;
    },
    end(payload) {
      res.statusCode = statusCode;
      res.end(payload);
      return this;
    }
  };
}

async function loadApiHandler(route) {
  if (!apiModules[route]) {
    const moduleUrl = new URL(`../api/${route}.js`, import.meta.url);
    apiModules[route] = import(moduleUrl.href).catch((err) => {
      delete apiModules[route];
      throw err;
    });
  }
  const mod = await apiModules[route];
  return mod.default;
}

async function handleApiRoute(req, res, route) {
  const handler = await loadApiHandler(route);
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rawBody = await collectBody(req);
  const request = {
    method: req.method,
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    headers: req.headers,
    body: parseBody(rawBody, req.headers['content-type'] || '')
  };
  const response = createResponseAdapter(res);
  try {
    await handler(request, response);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: err && err.message ? err.message : 'API handler failure' }));
  }
}

export function startDevServer(customPort) {
  const listenPort = Number(customPort || port);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/api/torbox-source') {
        return handleApiRoute(req, res, 'torbox-source');
      }
      if (url.pathname === '/api/proxy') {
        return handleApiRoute(req, res, 'proxy');
      }
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      const filePath = join(root, pathname.replace(/^\//, ''));
      const data = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });

  server.listen(listenPort, () => {
    console.log(`Local dev server listening on http://127.0.0.1:${listenPort}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startDevServer(port);
}

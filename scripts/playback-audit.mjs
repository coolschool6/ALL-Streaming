import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const port = 3001;
const baseUrl = `http://127.0.0.1:${port}`;
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, baseUrl);
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

const audit = async () => {
  await new Promise((resolve) => server.listen(port, resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => console.log(`[console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) => console.log(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText || 'failed'}`));

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const headings = await page.locator('h2, h1').allTextContents();
  console.log(`Loaded UI. Headings: ${headings.slice(0, 8).join(' | ')}`);
  await browser.close();
  server.close();
};

audit().catch((err) => {
  console.error(err);
  process.exit(1);
});

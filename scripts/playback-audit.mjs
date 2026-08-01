import { chromium } from 'playwright';
const port = 3001;
const baseUrl = `http://127.0.0.1:${port}`;
const { startDevServer } = await import('./dev-server.mjs');

const audit = async () => {
  const server = startDevServer(port);
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

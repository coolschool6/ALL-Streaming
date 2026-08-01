// Automated playback audit for ALLStreaming.
// Launches the cached Playwright Chromium, bypasses the paywall, clicks real
// UI cards, triggers playback, and verifies actual video frame rendering.
//
// Usage: node scripts/playback-audit.mjs
// Env:   AUDIT_TITLES=3  (how many titles to click through)
//        AUDIT_URL=http://localhost:8080

import { chromium } from 'playwright-core';

const BASE = process.env.AUDIT_URL || 'http://localhost:8080';
const TITLES_LIMIT = parseInt(process.env.AUDIT_TITLES || '4', 10);
const EXE = process.env.CHROME_EXE ||
  'C:/Users/israe/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const WATCH_TIMEOUT = 100000;

const results = { movie: [], tv: [], consoleErrors: [], netFailures: [], unreleased: [] };

async function evalVideo(page) {
  return page.evaluate(() => {
    const v = document.getElementById('hls-video');
    if (!v) return null;
    return {
      paused: v.paused,
      currentTime: v.currentTime,
      duration: v.duration,
      readyState: v.readyState,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      src: (v.currentSrc || '').slice(0, 120),
      error: v.error ? (v.error.code + ':' + v.error.message) : null
    };
  });
}

async function settingsChips(page) {
  return page.evaluate(() => {
    const g = document.getElementById('player-settings');
    if (!g) return '';
    return Array.from(g.querySelectorAll('.setting-group')).map((x) =>
      (x.dataset.group || '?') + '=[' + Array.from(x.querySelectorAll('.setting-chip')).map((c) => c.textContent).join(',') + ']'
    ).join(' ');
  });
}

async function waitForPlayback(page, title) {
  const start = Date.now();
  let state = null;
  while (Date.now() - start < WATCH_TIMEOUT) {
    state = await evalVideo(page).catch(() => null);
    if (state && !state.paused && state.currentTime > 0 && state.videoWidth > 0) {
      return { ok: true, ms: Date.now() - start, state };
    }
    const loader = await page.evaluate(() => {
      const el = document.getElementById('player-loader');
      const label = document.getElementById('source-label');
      const overlay = document.getElementById('paywall-overlay');
      const video = document.getElementById('hls-video');
      return {
        loading: el ? !el.classList.contains('hidden') : false,
        label: label ? label.textContent : '',
        // showPlayerError() paints the label red; a normal source label is transparent
        isErrorBanner: label ? (label.style.background || '').includes('255,0,0') : false,
        paywallVisible: overlay ? overlay.style.display !== 'none' : false
      };
    }).catch(() => ({}));
    // Hard failure: red error banner (set by every failure path) or paywall
    // NOTE: do NOT treat a hidden <video> as failure — it stays display:none
    // during the (potentially 8-90s) cold stream resolution phase.
    if (loader.isErrorBanner) {
      return { ok: false, ms: Date.now() - start, state, loader, label: loader.label };
    }
    if (loader.paywallVisible) {
      return { ok: false, ms: Date.now() - start, state, loader, label: loader.label };
    }
    // Hard failure: video element error
    if (state && state.error) return { ok: false, ms: Date.now() - start, state, loader };
    await page.waitForTimeout(2500);
  }
  return { ok: false, ms: Date.now() - start, state };
}

async function collectCards(page) {
  // Ensure nav shows Movies (default 'all' shows everything)
  const cards = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.card[data-type]').forEach((c) => {
      const id = c.getAttribute('data-id');
      const type = c.getAttribute('data-type');
      if (!id || !type) return;
      const name = (c.querySelector('.card-name') || {}).textContent || '';
      const badge = !!c.querySelector('.card-unreleased-badge');
      out.push({ id, type, name, unreleased: badge });
    });
    return out;
  });
  const seen = new Set();
  return cards.filter((c) => {
    const k = c.type + ':' + c.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function testMovie(page, card) {
  const r = { name: card.name, id: card.id, status: 'FAIL', detail: '', ms: 0, chips: '' };
  try {
    await page.locator(`.card[data-type="movie"][data-id="${card.id}"]`).first().click({ timeout: 5000 });
    // Detail modal for movies
    await page.locator('#detail-modal.active').waitFor({ timeout: 8000 }).catch(() => {});
    const watchBtn = page.locator('#detail-watch');
    await watchBtn.waitFor({ timeout: 5000 }).catch(() => {});
    const disabled = await watchBtn.isDisabled().catch(() => true);
    if (disabled) {
      r.status = 'SKIP';
      r.detail = 'watch button disabled (blocked/unreleased)';
      await page.locator('#detail-close').click({ timeout: 3000 }).catch(() => {});
      return r;
    }
    await watchBtn.click({ timeout: 5000 }).catch(() => {});
  } catch (e) {
    // No detail modal — maybe direct to player; try hero watch
    r.detail = 'detail modal error: ' + e.message;
    try { await page.locator('#player-close').click({ timeout: 2000 }).catch(() => {}); } catch (e2) {}
  }

  const res = await waitForPlayback(page, card.name);
  r.ms = res.ms;
  if (res.ok) {
    r.status = 'PASS';
    r.detail = `paused=${res.state.paused} t=${res.state.currentTime.toFixed(1)}s dur=${res.state.duration ? res.state.duration.toFixed(0) : '?'} ${res.state.videoWidth}x${res.state.videoHeight} readyState=${res.state.readyState}`;
  } else {
    r.detail = (res.state && res.state.error) ? 'video error ' + res.state.error :
      ((res.loader && res.loader.label) || 'timeout without frames after ' + Math.round(res.ms / 1000) + 's');
  }
  r.chips = await settingsChips(page).catch(() => '');
  await page.locator('#player-close').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return r;
}

async function testTv(page, card) {
  const r = { name: card.name, id: card.id, status: 'FAIL', detail: '', ms: 0, chips: '' };
  // Defensive: close any modal/show page left open by a previous test
  await page.evaluate(() => {
    document.querySelector('#show-page')?.classList.remove('active');
    document.querySelector('#player-modal')?.classList.remove('active');
    document.querySelector('#detail-modal')?.classList.remove('active');
    document.body.style.overflow = '';
  }).catch(() => {});
  await page.waitForTimeout(600);
  try {
    await page.locator(`.card[data-type="tv"][data-id="${card.id}"]`).first().click({ timeout: 5000 });
    await page.locator('#show-page.active').waitFor({ timeout: 8000 });
    const ep = page.locator('.episode-card:not(.episode-card--unreleased)').first();
    await ep.waitFor({ timeout: 8000 }).catch(() => {});
    const count = await page.locator('.episode-card').count();
    if (count === 0) { r.status = 'SKIP'; r.detail = 'no episodes'; await page.locator('#show-back-btn').click().catch(() => {}); return r; }
    const isUnreleased = await page.locator('.episode-card').first().evaluate((el) => el.classList.contains('episode-card--unreleased'));
    if (isUnreleased && count === await page.locator('.episode-card--unreleased').count()) {
      r.status = 'SKIP'; r.detail = 'all episodes unreleased'; await page.locator('#show-back-btn').click().catch(() => {}); return r;
    }
    await ep.click({ timeout: 5000 });
  } catch (e) {
    r.detail = 'tv page error: ' + e.message;
    await page.locator('#show-back-btn').click({ timeout: 3000 }).catch(() => {});
    await page.locator('#player-close').click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800);
    return r;
  }

  const res = await waitForPlayback(page, card.name);
  r.ms = res.ms;
  if (res.ok) {
    r.status = 'PASS';
    r.detail = `paused=${res.state.paused} t=${res.state.currentTime.toFixed(1)}s dur=${res.state.duration ? res.state.duration.toFixed(0) : '?'} ${res.state.videoWidth}x${res.state.videoHeight} readyState=${res.state.readyState}`;
  } else {
    r.detail = (res.state && res.state.error) ? 'video error ' + res.state.error :
      ((res.loader && res.loader.label) || 'timeout without frames after ' + Math.round(res.ms / 1000) + 's');
  }
  r.chips = await settingsChips(page).catch(() => '');
  await page.locator('#player-close').click({ timeout: 3000 }).catch(() => {});
  // Close the show page so it never intercepts the next card click
  if (await page.locator('#show-page.active').count().catch(() => 0)) {
    await page.locator('#show-back-btn').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1500);
  return r;
}

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--mute-audio=false']
});

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }
});
const page = await ctx.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') results.consoleErrors.push(msg.text().slice(0, 300));
});
page.on('requestfailed', (req) => {
  const u = req.url();
  if (!u.includes('image.tmdb.org')) results.netFailures.push((req.failure() || {}).errorText + ' -> ' + u.slice(0, 140));
});
page.on('response', (resp) => {
  if (resp.status() >= 400 && !resp.url().includes('image.tmdb.org')) {
    results.netFailures.push(resp.status() + ' -> ' + resp.url().slice(0, 140));
  }
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });

// Bypass paywall
await page.evaluate(() => {
  localStorage.setItem('asfr_expiry_time', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
});
await page.reload({ waitUntil: 'domcontentloaded' });

// Wait for cards
await page.waitForSelector('.card[data-type]', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);

let cards = await collectCards(page);
console.log(`[audit] collected ${cards.length} cards from homepage`);

const unreleased = cards.filter((c) => c.unreleased);
results.unreleased = unreleased.map((c) => c.name + ' [' + c.type + ':' + c.id + ']');
const playable = cards.filter((c) => !c.unreleased);

// Movies
const movies = playable.filter((c) => c.type === 'movie').slice(0, TITLES_LIMIT);
console.log(`[audit] testing ${movies.length} movies via UI...`);
for (const m of movies) {
  const r = await testMovie(page, m);
  results.movie.push(r);
  console.log(`[audit] movie ${r.status} "${r.name}" (${Math.round(r.ms / 1000)}s) ${r.detail}`);
}

// TV
const tvs = playable.filter((c) => c.type === 'tv').slice(0, Math.max(1, Math.floor(TITLES_LIMIT / 2)));
console.log(`[audit] testing ${tvs.length} TV shows via UI...`);
for (const t of tvs) {
  const r = await testTv(page, t);
  results.tv.push(r);
  console.log(`[audit] tv ${r.status} "${r.name}" (${Math.round(r.ms / 1000)}s) ${r.detail}`);
}

await browser.close();

const passed = results.movie.filter((r) => r.status === 'PASS').length + results.tv.filter((r) => r.status === 'PASS').length;
const failed = results.movie.filter((r) => r.status === 'FAIL').length + results.tv.filter((r) => r.status === 'FAIL').length;
const skipped = results.movie.filter((r) => r.status === 'SKIP').length + results.tv.filter((r) => r.status === 'SKIP').length;

console.log('\n========== PLAYBACK AUDIT SUMMARY ==========');
console.log(`UI titles tested: ${results.movie.length + results.tv.length} (PASS=${passed} FAIL=${failed} SKIP=${skipped})`);
console.log(`Console errors: ${results.consoleErrors.length}`);
results.consoleErrors.slice(0, 10).forEach((e) => console.log('  [console] ' + e));
console.log(`Network failures: ${results.netFailures.length}`);
results.netFailures.slice(0, 10).forEach((e) => console.log('  [net] ' + e));
console.log(`Unreleased titles flagged on homepage: ${results.unreleased.length}`);
results.unreleased.slice(0, 10).forEach((e) => console.log('  [unreleased] ' + e));
console.log('--- movie results ---');
results.movie.forEach((r) => console.log(`  ${r.status} ${r.name} [${r.id}] ${r.detail} | chips: ${r.chips}`));
console.log('--- tv results ---');
results.tv.forEach((r) => console.log(`  ${r.status} ${r.name} [${r.id}] ${r.detail} | chips: ${r.chips}`));
console.log('============================================');

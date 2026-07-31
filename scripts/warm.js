var TARGET = process.env.TARGET_URL || 'https://all-streaming-asfr.vercel.app';
var TMDB_KEY = process.env.TMDB_API_KEY || 'cd27a14dfc1752e04b474124a5af6d2b';
var POOL_SIZE = parseInt(process.env.POOL_SIZE || '150', 10);
var CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
var REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '115000', 10);
var TMDB = 'https://api.themoviedb.org/3';

var LISTS = [];
['movie', 'tv'].forEach(function (t) {
  LISTS.push('/trending/' + t + '/week');
  LISTS.push('/' + t + '/popular');
});

function log(msg) {
  console.log(new Date().toISOString() + ' ' + msg);
}

function fetchWithTimeout(url, ms) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, ms);
  return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(t); });
}

async function tmdbList(path) {
  var mediaType = path.indexOf('tv/') !== -1 ? 'tv' : 'movie';
  var out = [];
  for (var page = 1; page <= 2; page++) {
    var url = TMDB + path + '?page=' + page + '&api_key=' + TMDB_KEY + '&language=en-US';
    try {
      var r = await fetchWithTimeout(url, 20000);
      if (!r.ok) continue;
      var j = await r.json();
      (j.results || []).forEach(function (it) {
        if (it && it.id) out.push({ id: it.id, media_type: mediaType });
      });
    } catch (e) { /* skip list */ }
  }
  return out;
}

async function buildPool() {
  var seen = {};
  var pool = [];
  for (var i = 0; i < LISTS.length; i++) {
    var items = await tmdbList(LISTS[i]);
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var key = it.media_type + ':' + it.id;
      if (seen[key]) continue;
      seen[key] = true;
      pool.push(it);
      if (pool.length >= POOL_SIZE) break;
    }
    if (pool.length >= POOL_SIZE) break;
  }
  return pool;
}

function warmItem(item) {
  var label = (item.media_type === 'tv' ? 'tv' : 'movie') + ':' + item.id;
  var url = TARGET + '/api/torbox-source?tmdbId=' + item.id + '&type=' + (item.media_type === 'tv' ? 'tv' : 'movie') + '&refresh=1';
  if (item.media_type === 'tv') url += '&season=1&episode=1';

  return fetchWithTimeout(url, REQUEST_TIMEOUT).then(async function (r) {
    var ms = '?ms';
    var j = null;
    try { j = await r.json(); } catch (e) {}
    var status = 'ERR';
    if (r.ok && j && j.hlsUrl) status = 'OK:' + (j.cached || 'build');
    else status = 'FAIL:' + r.status;
    log('[' + status + '] ' + label);
    return r.ok && j && j.hlsUrl;
  }).catch(function (e) {
    log('[FAIL:timeout] ' + label);
    return false;
  });
}

async function main() {
  log('Building pool (up to ' + POOL_SIZE + ') from TMDB...');
  var pool = await buildPool();
  log('Pool size: ' + pool.length);
  if (pool.length === 0) {
    log('Empty pool — cannot warm.');
    process.exit(1);
  }

  var movies = pool.filter(function (i) { return i.media_type === 'movie'; });
  var tvs = pool.filter(function (i) { return i.media_type === 'tv'; });
  log('Movies: ' + movies.length + ' | TV (S1E1): ' + tvs.length);

  var ok = 0;
  var fail = 0;
  var idx = 0;
  var start = Date.now();

  async function worker() {
    while (idx < pool.length) {
      var item = pool[idx++];
      var success = await warmItem(item);
      if (success) ok++; else fail++;
    }
  }

  var workers = [];
  for (var w = 0; w < Math.min(CONCURRENCY, pool.length); w++) workers.push(worker());
  await Promise.all(workers);

  var mins = ((Date.now() - start) / 60000).toFixed(1);
  log('Done in ' + mins + 'm — ok=' + ok + ' fail=' + fail);
  if (fail > 0) process.exitCode = 2;
}

main().catch(function (e) {
  log('Fatal: ' + (e && e.message));
  process.exit(1);
});

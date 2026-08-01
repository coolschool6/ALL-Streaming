// Environment Variables
var TMDB_KEY = process.env.TMDB_API_KEY || 'cd27a14dfc1752e04b474124a5af6d2b';
var TORBOX_KEY = process.env.TORBOX_API_KEY;
var TORBOX_API = 'https://api.torbox.app/v1/api';

var UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
var UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
var UPSTASH_RESULT_TTL = 3 * 60 * 60;
var UPSTASH_TR_TTL = 24 * 60 * 60;

// ---- In-memory caches (per-instance, best-effort) ----
var RESULT_CACHE = {};
var RESULT_CACHE_TTL = 3 * 60 * 60 * 1000;
var RESULT_CACHE_MAX = 400;

var IMDB_CACHE = {};
var IMDB_CACHE_TTL = 24 * 60 * 60 * 1000;

var TR_CACHE = {};
var TR_CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheGet(key) {
  var entry = RESULT_CACHE[key];
  if (!entry) return null;
  if (Date.now() - entry.t > RESULT_CACHE_TTL) {
    delete RESULT_CACHE[key];
    return null;
  }
  return entry.payload;
}

function cacheSet(key, payload) {
  var keys = Object.keys(RESULT_CACHE);
  if (keys.length >= RESULT_CACHE_MAX) delete RESULT_CACHE[keys[0]];
  RESULT_CACHE[key] = { t: Date.now(), payload: payload };
}

function imdbCacheGet(tmdbId) {
  var entry = IMDB_CACHE[tmdbId];
  if (!entry) return null;
  if (Date.now() - entry.t > IMDB_CACHE_TTL) {
    delete IMDB_CACHE[tmdbId];
    return null;
  }
  return entry.imdbId;
}

function imdbCacheSet(tmdbId, imdbId) {
  if (!imdbId) return;
  IMDB_CACHE[tmdbId] = { t: Date.now(), imdbId: imdbId };
}

function trCacheGet(key) {
  var entry = TR_CACHE[key];
  if (!entry) return null;
  if (Date.now() - entry.t > TR_CACHE_TTL) {
    delete TR_CACHE[key];
    return null;
  }
  return entry.payload;
}

function trCacheSet(key, payload) {
  TR_CACHE[key] = { t: Date.now(), payload: payload };
}

// ---- Upstash shared cache (keeps results warm between users) ----
function upstashEnabled() {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

async function upstashGet(key) {
  if (!upstashEnabled()) return null;
  try {
    var r = await fetchTimeout(UPSTASH_URL + '/get/' + key, {
      headers: { 'Authorization': 'Bearer ' + UPSTASH_TOKEN }
    }, 2000);
    if (!r || !r.ok) return null;
    var data = await r.json();
    var v = data && data.result;
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { return null; }
}

async function upstashSet(key, value, ttlSeconds) {
  if (!upstashEnabled()) return;
  try {
    await fetchTimeout(UPSTASH_URL + '/set/' + key + '?EX=' + (ttlSeconds || UPSTASH_RESULT_TTL), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + UPSTASH_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(value)
    }, 2000);
  } catch (e) {}
}

async function upstashTrGet(key) {
  if (!upstashEnabled()) return null;
  try {
    var r = await fetchTimeout(UPSTASH_URL + '/get/' + key, {
      headers: { 'Authorization': 'Bearer ' + UPSTASH_TOKEN }
    }, 2000);
    if (!r || !r.ok) return null;
    var data = await r.json();
    var v = data && data.result;
    if (!v) return null;
    var arr = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch (e) { return null; }
}

async function upstashTrSet(key, hashes) {
  if (!upstashEnabled() || !hashes || !hashes.length) return;
  try {
    await fetchTimeout(UPSTASH_URL + '/set/' + key + '?EX=' + UPSTASH_TR_TTL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + UPSTASH_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(hashes)
    }, 2000);
  } catch (e) {}
}

// Client-supplied torrent candidates (from a browser-side scrape) or ?hashes= list.
function extractCandidates(req) {
  var out = [];
  if (req.query && typeof req.query.hashes === 'string' && req.query.hashes) {
    req.query.hashes.split(',').forEach(function (h) {
      var clean = String(h).trim().toLowerCase();
      if (/^[0-9a-f]{40}$/.test(clean)) out.push({ cleanHash: clean, title: '' });
    });
  }
  if (req.body && Array.isArray(req.body.streams)) {
    req.body.streams.forEach(function (s) {
      if (!s) return;
      var clean = String(s.hash || s.infoHash || '').trim().toLowerCase();
      if (/^[0-9a-f]{40}$/.test(clean)) out.push({ cleanHash: clean, title: s.title || '' });
    });
  }
  return out.length ? out : null;
}

// ---- Generic fetch helpers ----
async function fetchTimeout(url, options, ms) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, ms || 5000);
  try {
    var r = await fetch(url, options || {});
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function tmdbFetch(path) {
  if (!TMDB_KEY) return null;
  try {
    var r = await fetchTimeout('https://api.themoviedb.org/3' + path + '?api_key=' + TMDB_KEY + '&language=en', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, 2500);
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function torboxFetch(path, ms) {
  if (!TORBOX_KEY) return null;
  try {
    var r = await fetchTimeout(TORBOX_API + path, {
      headers: { 'Authorization': 'Bearer ' + TORBOX_KEY }
    }, ms || 5000);
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function torboxPost(path, body, ms) {
  if (!TORBOX_KEY) return null;
  try {
    var r = await fetchTimeout(TORBOX_API + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TORBOX_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body
    }, ms || 5000);
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

// ---- Scraping ----
function parseQuality(title) {
  var u = (title || '').toUpperCase();
  if (u.indexOf('4K') !== -1 || u.indexOf('2160') !== -1) return 4;
  if (u.indexOf('1080') !== -1) return 3;
  if (u.indexOf('720') !== -1) return 2;
  if (u.indexOf('480') !== -1) return 1;
  return 0;
}

function parseCodec(title) {
  var u = (title || '').toUpperCase();
  if (/H\.?26[45]|HEVC|AVC|X26[45]/.test(u)) {
    if (/H\.?265|HEVC|X265/.test(u)) return 'hevc';
    if (/H\.?264|AVC|X264/.test(u)) return 'avc';
  }
  return '';
}

// ---- TorBox checkcached (batched, ~100 hashes per request) ----
function parseCheckcachedMap(json) {
  var out = {};
  if (!json || !json.success || !json.data) return out;
  var d = json.data;
  if (Array.isArray(d)) {
    for (var i = 0; i < d.length; i++) {
      var it = d[i];
      if (it && it.hash) out[String(it.hash).toLowerCase()] = it;
    }
  } else if (typeof d === 'object') {
    for (var k in d) {
      if (Object.prototype.hasOwnProperty.call(d, k)) out[String(k).toLowerCase()] = d[k];
    }
  }
  return out;
}

// Prefer broadly-playable AVC, then higher quality.
function sortCandidates(candidates) {
  var scored = candidates.map(function (c) {
    return {
      cand: c,
      codec: parseCodec(c.title),
      quality: parseQuality(c.title)
    };
  });
  scored.sort(function (a, b) {
    var pa = a.codec === 'avc' ? 2 : (a.codec === 'hevc' ? 1 : 0);
    var pb = b.codec === 'avc' ? 2 : (b.codec === 'hevc' ? 1 : 0);
    if (pb !== pa) return pb - pa;
    return b.quality - a.quality;
  });
  return scored.map(function (s) { return s.cand; });
}

// Find the first cached candidate. Checks up to maxChecked hashes in batched requests.
async function findCachedCandidate(candidates, maxChecked) {
  var limit = Math.min(maxChecked || 100, candidates.length);
  var BATCH = 50;
  for (var start = 0; start < limit; start += BATCH) {
    var chunk = candidates.slice(start, start + BATCH);
    var hashList = chunk.map(function (c) { return c.cleanHash; }).join(',');
    var j = await torboxFetch('/torrents/checkcached?hash=' + hashList + '&format=object&list_files=true', 8000);
    var map = parseCheckcachedMap(j);
    for (var i = 0; i < chunk.length; i++) {
      var entry = map[chunk[i].cleanHash];
      if (entry && entry.cached) {
        return { cand: chunk[i], files: entry.files || [] };
      }
    }
  }
  return null;
}

// ---- Build a TorBox stream from a list of torrent candidates ----
async function buildTorBoxStream(candidates, type, season, episode) {
  var best = await findCachedCandidate(candidates, 100);
  if (!best) return null;

  var hash = best.cand.cleanHash;
  var cachedFiles = best.files;

  // Reuse existing torrent in the account when possible
  var torrentId = null;
  var mylist = await torboxFetch('/torrents/mylist', 3000);
  if (mylist && mylist.success && Array.isArray(mylist.data)) {
    var existing = mylist.data.find(function (item) {
      return item.hash && String(item.hash).toLowerCase() === hash.toLowerCase();
    });
    if (existing) torrentId = existing.id;
  }

  if (!torrentId) {
    var magnet = 'magnet:?xt=urn:btih:' + hash;
    var createBody = new URLSearchParams();
    createBody.append('magnet', magnet);
    createBody.append('add_only_if_cached', 'true');
    if (type === 'tv') createBody.append('name', hash.slice(0, 8) + '_S' + season + 'E' + episode);

    var created = await torboxPost('/torrents/createtorrent', createBody.toString(), 5000);
    if (created && created.success && created.data) {
      torrentId = created.data.torrent_id || created.data.id;
    }
  }

  if (!torrentId) return null;

  // Pick the video file
  var fileId = null;
  var videoFiles = cachedFiles.filter(function (f) {
    var name = (f.name || f.short_name || '').toLowerCase();
    var isVidMime = f.mimetype && f.mimetype.indexOf('video/') === 0;
    var isVidExt = /\.(mp4|mkv|avi|mov|webm|ts|m3u8)$/i.test(name);
    return isVidMime || isVidExt;
  });
  if (videoFiles.length === 0) videoFiles = cachedFiles;

  if (type === 'tv' && videoFiles.length > 0) {
    var sPadded = String(season).padStart(2, '0');
    var ePadded = String(episode).padStart(2, '0');
    var pats = [
      new RegExp('S' + sPadded + 'E' + ePadded, 'i'),
      new RegExp(season + 'x' + ePadded, 'i'),
      new RegExp('E' + ePadded + '\\b', 'i')
    ];
    var matched = null;
    for (var p = 0; p < pats.length; p++) {
      matched = videoFiles.find(function (f) { return pats[p].test(f.name || f.short_name || ''); });
      if (matched) break;
    }
    fileId = matched ? matched.id : videoFiles[0].id;
  } else if (videoFiles.length > 0) {
    fileId = videoFiles[0].id;
  }

  // Last resort: use torrentio's fileIdx as the file id
  if (fileId === null || fileId === undefined) {
    fileId = best.cand.fileIdx;
  }
  if (fileId === null || fileId === undefined) fileId = 0;

  var streamUrl = '/stream/createstream?id=' + torrentId + '&file_id=' + fileId + '&type=torrent';
  var stream = await torboxFetch(streamUrl, 6000);

  if (!stream || !stream.success || !stream.data) return null;

  var hlsUrl = stream.data.hls_url;
  if (!hlsUrl) return null;

  var bestQ = parseQuality(best.cand.title);
  var qualityName = 'HD';
  if (bestQ === 4) qualityName = '4K';
  else if (bestQ === 3) qualityName = '1080p';
  else if (bestQ === 2) qualityName = '720p';

  var sourceName = 'TorBox - ' + qualityName;
  var titleMatch = best.cand.title ? best.cand.title.match(/\|\s*(.+)$/) : null;
  if (titleMatch) sourceName += ' - ' + titleMatch[1].trim();

  return {
    hlsUrl: hlsUrl,
    source: sourceName,
    debug: { hash: hash, torrentId: torrentId, fileId: fileId, codec: parseCodec(best.cand.title) }
  };
}

// ---- Main pipeline (hybrid: client scrapes in-browser, server talks to TorBox) ----
async function processStreamRequest(req) {
  var tmdbId = req.query.tmdbId || (req.body && req.body.tmdbId);
  var type = req.query.type || (req.body && req.body.type);
  var season = req.query.season || (req.body && req.body.season) || '1';
  var episode = req.query.episode || (req.body && req.body.episode) || '1';
  var givenImdb = req.query.imdbId || (req.body && req.body.imdbId);

  // 1. Resolve IMDb ID from TMDB (cached) or from the client
  var imdbId = givenImdb || imdbCacheGet(tmdbId);
  if (!imdbId) {
    if (type === 'tv') {
      var ext = await tmdbFetch('/tv/' + tmdbId + '/external_ids');
      imdbId = ext ? ext.imdb_id : null;
      if (!imdbId) {
        var tvData = await tmdbFetch('/tv/' + tmdbId);
        imdbId = tvData && tvData.external_ids ? tvData.external_ids.imdb_id : null;
      }
    } else {
      var movie = await tmdbFetch('/movie/' + tmdbId);
      imdbId = movie ? movie.imdb_id : null;
    }
    imdbCacheSet(tmdbId, imdbId);
  }

  if (!imdbId) {
    return { status: 404, payload: { error: 'Could not resolve IMDb ID from TMDB', imdbId: null } };
  }

  var trKey = 'tr:' + imdbId + ':' + season + ':' + episode;
  var provided = extractCandidates(req);

  // 2. Use hashes the client scraped in its own browser, or a shared cache
  var candidates = null;
  if (provided && provided.length) {
    candidates = sortCandidates(provided);
  } else {
    var sharedHashes = trCacheGet(trKey);
    if (!sharedHashes) sharedHashes = await upstashTrGet(trKey);
    if (sharedHashes && sharedHashes.length) {
      candidates = sharedHashes.map(function (h) { return { cleanHash: String(h).toLowerCase(), title: '' }; });
    }
  }

  // 3. Nothing shared yet -> tell the client to scrape torrentio in its own browser
  if (!candidates || candidates.length === 0) {
    return { status: 404, payload: { error: 'No shared torrent sources for this title yet.', imdbId: imdbId, needsScrape: true } };
  }

  // 4. TorBox path
  var torBoxResult = await buildTorBoxStream(candidates, type, season, episode);
  if (torBoxResult) {
    torBoxResult.imdbId = imdbId;
  }
  if (provided && provided.length) {
    var shareHashes = provided.map(function (c) { return c.cleanHash; });
    trCacheSet(trKey, shareHashes);
    upstashTrSet(trKey, shareHashes);
  }
  if (torBoxResult) {
    return { status: 200, payload: torBoxResult };
  }

  // 5. Clear error (never 502)
  return { status: 404, payload: { error: 'Torrent streams found but none are cached on TorBox.', imdbId: imdbId, noCached: true } };
}

// ---- Exported handler ----
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!TORBOX_KEY) {
    return res.status(500).json({ error: 'TORBOX_API_KEY environment variable missing.' });
  }

  var tmdbId = req.query.tmdbId || (req.body && req.body.tmdbId);
  var type = req.query.type || (req.body && req.body.type);
  var season = req.query.season || (req.body && req.body.season) || '1';
  var episode = req.query.episode || (req.body && req.body.episode) || '1';

  if (!tmdbId || !type) {
    return res.status(400).json({ error: 'Missing parameters tmdbId or type' });
  }

  var cacheKey = type + ':' + tmdbId + ':' + season + ':' + episode;
  var refresh = req.query.refresh === '1' || req.query.refresh === 'true';

  if (!refresh) {
    var cached = cacheGet(cacheKey);
    if (cached) {
      cached.cached = true;
      return res.status(200).json(cached);
    }
    var shared = await upstashGet(cacheKey);
    if (shared && shared.hlsUrl) {
      cacheSet(cacheKey, shared);
      shared.cached = 'shared';
      return res.status(200).json(shared);
    }
  }

  var timeoutPromise = new Promise(function (resolve) {
    setTimeout(function () {
      resolve({ status: 404, payload: { error: 'Stream lookup timed out. Try again or use the server selector.' } });
    }, 9500);
  });

  try {
    var result = await Promise.race([
      processStreamRequest(req),
      timeoutPromise
    ]);

    if (result.status === 200 && result.payload && result.payload.hlsUrl) {
      var toStore = {
        hlsUrl: result.payload.hlsUrl,
        source: result.payload.source || 'TorBox',
        debug: result.payload.debug || null
      };
      cacheSet(cacheKey, toStore);
      upstashSet(cacheKey, toStore, UPSTASH_RESULT_TTL);
    }

    return res.status(result.status).json(result.payload);
  } catch (err) {
    return res.status(404).json({ error: 'Stream lookup failed. Try again or use the server selector.' });
  }
}

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
      if (entry && entry.cached !== false) {
        return { cand: chunk[i], files: entry.files || [] };
      }
    }
  }
  return null;
}

// ---- TorBox error mapping ----
function extractTorBoxError(json) {
  if (!json) return '';
  if (json.error) {
    if (typeof json.error === 'string') return json.error;
    if (json.error.message) return json.error.message;
    if (json.error.code) return json.error.code;
  }
  if (Array.isArray(json.errors)) {
    return json.errors.map(function (e) { return (e && e.message) || ''; }).join(' ');
  }
  if (json.detail) return typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail);
  if (json.message) return json.message;
  return '';
}

function torboxErrorCode(json) {
  if (!json) return '';
  if (json.error) {
    if (typeof json.error === 'object' && json.error.code) return json.error.code;
    if (typeof json.error === 'string' && /^[A-Z_]+$/.test(json.error)) return json.error;
  }
  return '';
}

function friendlyTorBoxError(json) {
  var msg = extractTorBoxError(json);
  var lower = msg.toLowerCase();
  if (lower.indexOf('not allowed to use web streaming') !== -1 || lower === 'plan_restricted_feature') {
    return 'Your TorBox plan does not include web streaming. Upgrade your plan to stream.';
  }
  if (lower.indexOf('cooldown') !== -1) {
    return 'TorBox is cooling down from too many downloads. Try again in a bit.';
  }
  if (lower.indexOf('cap') !== -1 || lower.indexOf('storage limit') !== -1) {
    return 'TorBox storage cap reached: ' + msg;
  }
  if (lower.indexOf('rate') !== -1) {
    return 'TorBox rate limit hit: ' + msg;
  }
  if (lower.indexOf('plan') !== -1 || lower.indexOf('premium') !== -1) {
    return 'TorBox plan restriction: ' + msg;
  }
  return msg || 'TorBox request failed. Try again.';
}

// Raw request that keeps status + error body for mapping.
async function torboxRequest(path, method, body, ms) {
  if (!TORBOX_KEY) return null;
  var opts = { headers: { 'Authorization': 'Bearer ' + TORBOX_KEY } };
  if (method === 'POST') {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = body;
  }
  try {
    var r = await fetchTimeout(TORBOX_API + path, opts, ms || 5000);
    var json = null;
    try { json = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, json: json };
  } catch (e) {
    return null;
  }
}

// ---- Download-wait (uncached titles) ----
function parseSizeGB(title) {
  var m = /(\d+(?:\.\d+)?)\s*(?:GB|GiB)/i.exec(title || '');
  return m ? parseFloat(m[1]) : 0;
}

// Best candidate to actually download: AVC first, good quality, but not a giant remux.
function pickDownloadCandidate(candidates) {
  var best = null;
  var bestScore = -Infinity;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var codec = parseCodec(c.title);
    var quality = parseQuality(c.title);
    var size = parseSizeGB(c.title);
    var score = (codec === 'avc' ? 100 : codec === 'hevc' ? 60 : 30) + quality * 10;
    if (size > 0 && size > 40) score -= 60;
    if (size > 0 && size <= 3) score += 8;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best || (candidates[0] || null);
}

function findExistingTorrentId(hash) {
  return torboxFetch('/torrents/mylist', 4000).then(function (mylist) {
    if (mylist && mylist.success && Array.isArray(mylist.data)) {
      var found = mylist.data.find(function (item) {
        return item.hash && String(item.hash).toLowerCase() === hash.toLowerCase();
      });
      return found ? found.id : null;
    }
    return null;
  });
}

function pickVideoFile(files, type, season, episode, cand) {
  var videoFiles = files.filter(function (f) {
    var name = (f.name || f.short_name || '').toLowerCase();
    var isVidMime = f.mimetype && f.mimetype.indexOf('video/') === 0;
    var isVidExt = /\.(mp4|mkv|avi|mov|webm|ts|m3u8)$/i.test(name);
    return isVidMime || isVidExt;
  });
  if (videoFiles.length === 0) videoFiles = files;

  var fileId = null;
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
  if (fileId === null || fileId === undefined) fileId = cand && cand.fileIdx;
  if (fileId === null || fileId === undefined) fileId = 0;
  return fileId;
}

function buildSourceMeta(cand) {
  var bestQ = parseQuality(cand && cand.title);
  var qualityName = 'HD';
  if (bestQ === 4) qualityName = '4K';
  else if (bestQ === 3) qualityName = '1080p';
  else if (bestQ === 2) qualityName = '720p';
  var sourceName = 'TorBox - ' + qualityName;
  var titleMatch = cand && cand.title ? cand.title.match(/\|\s*(.+)$/) : null;
  if (titleMatch) sourceName += ' - ' + titleMatch[1].trim();
  return sourceName;
}

async function createStreamForTorrent(torrentId, files, type, season, episode, cand) {
  var fileId = pickVideoFile(files || [], type, season, episode, cand);
  var path = '/stream/createstream?id=' + torrentId + '&file_id=' + fileId + '&type=torrent';
  var res = await torboxRequest(path, 'GET', null, 8000);
  if (!res) return { error: 'TorBox is unreachable. Try again.', torboxError: 'request_failed' };
  var json = res.json;
  if (!res.ok || !json || !json.success || !json.data) {
    return { error: friendlyTorBoxError(json), torboxError: torboxErrorCode(json) };
  }
  var hlsUrl = json.data.hls_url;
  if (!hlsUrl) return { error: 'TorBox returned no stream URL.', torboxError: 'no_hls' };
  return {
    hlsUrl: hlsUrl,
    source: buildSourceMeta(cand),
    debug: {
      hash: cand ? cand.cleanHash : null,
      torrentId: torrentId,
      fileId: fileId,
      codec: parseCodec(cand && cand.title)
    }
  };
}

async function startTorrentDownload(cand, type, season, episode) {
  var hash = cand.cleanHash;
  var magnet = 'magnet:?xt=urn:btih:' + hash;
  var trackers = [
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://open.demonii.com:1337/announce'
  ];
  trackers.forEach(function (t) { magnet += '&tr=' + encodeURIComponent(t); });

  var body = new URLSearchParams();
  body.append('magnet', magnet);
  body.append('seed', '1');
  var name = hash.slice(0, 8);
  if (type === 'tv') name += '_S' + season + 'E' + episode;
  body.append('name', name);

  var res = await torboxRequest('/torrents/createtorrent', 'POST', body.toString(), 8000);
  if (!res) return { error: 'TorBox is unreachable. Try again.', torboxError: 'request_failed' };
  var json = res.json;
  if (!res.ok || !json || !json.success) {
    return { error: friendlyTorBoxError(json), torboxError: torboxErrorCode(json) };
  }
  var torrentId = json.data ? (json.data.torrent_id || json.data.id) : null;
  if (!torrentId) return { error: 'TorBox did not return a torrent id.', torboxError: 'no_torrent_id' };
  return { torrentId: torrentId, hash: hash, title: cand.title || '' };
}

async function getTorrentProgress(torrentId) {
  var res = await torboxRequest('/torrents/mylist?id=' + torrentId, 'GET', null, 5000);
  if (!res || !res.ok) return null;
  var json = res.json;
  if (!json || !json.success) return null;
  var d = json.data;
  var item = Array.isArray(d) ? d[0] : d;
  if (!item) return null;
  var progress = typeof item.progress === 'number' ? item.progress : 0;
  var state = item.download_state || '';
  var ready = progress >= 100 || state === 'completed' || state === 'cached' || item.download_finished === true;
  return {
    id: item.id,
    progress: Math.max(0, Math.min(progress, 100)),
    state: state,
    files: Array.isArray(item.files) ? item.files : [],
    ready: ready
  };
}

async function processProgressPoll(req) {
  var torrentId = req.query.torrentId;
  var type = req.query.type || (req.body && req.body.type);
  var season = req.query.season || '1';
  var episode = req.query.episode || '1';
  var hash = req.query.hash || '';
  var title = req.query.title || '';

  if (!torrentId) {
    return { status: 400, payload: { error: 'Missing torrentId' } };
  }

  var prog = await getTorrentProgress(torrentId);
  if (!prog) {
    return { status: 404, payload: { error: 'Could not check TorBox download progress.', torboxError: 'poll_failed' } };
  }
  if (!prog.ready) {
    return { status: 202, payload: { downloading: true, progress: Math.round(prog.progress) } };
  }

  var cand = hash ? { cleanHash: String(hash).toLowerCase(), title: title || '' } : null;
  var stream = await createStreamForTorrent(torrentId, prog.files, type, season, episode, cand);
  if (!stream || !stream.hlsUrl) {
    return {
      status: 404,
      payload: { error: (stream && stream.error) || 'Could not start streaming this torrent.', torboxError: (stream && stream.torboxError) || 'stream_failed' }
    };
  }
  return { status: 200, payload: stream };
}

// ---- Build a TorBox stream from a list of torrent candidates ----
async function buildTorBoxStream(candidates, type, season, episode) {
  var best = await findCachedCandidate(candidates, 100);
  if (!best) return null;

  var hash = best.cand.cleanHash;
  var cachedFiles = best.files;

  // Reuse existing torrent in the account when possible
  var torrentId = await findExistingTorrentId(hash);
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

  if (!torrentId) {
    return { error: 'Torrent is cached but could not be added to your TorBox account.', torboxError: 'no_torrent_id' };
  }

  return await createStreamForTorrent(torrentId, cachedFiles, type, season, episode, best.cand);
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
  var download = req.query.download === '1' || req.query.download === 'true' || !!(req.body && req.body.download);
  var torBoxResult = await buildTorBoxStream(candidates, type, season, episode);
  if (torBoxResult) {
    torBoxResult.imdbId = imdbId;
  }
  if (provided && provided.length) {
    var shareHashes = provided.map(function (c) { return c.cleanHash; });
    trCacheSet(trKey, shareHashes);
    upstashTrSet(trKey, shareHashes);
  }
  if (torBoxResult && torBoxResult.hlsUrl) {
    return { status: 200, payload: torBoxResult };
  }
  if (torBoxResult && torBoxResult.error) {
    return { status: 404, payload: { error: torBoxResult.error, torboxError: torBoxResult.torboxError, imdbId: imdbId } };
  }

  // 5. Nothing cached -> start a download that the client polls to completion
  if (download) {
    var cand = pickDownloadCandidate(candidates);
    if (!cand) {
      return { status: 404, payload: { error: 'No usable torrent candidate found.', imdbId: imdbId, noCached: true } };
    }
    var dl = await startTorrentDownload(cand, type, season, episode);
    if (dl && dl.torrentId) {
      return {
        status: 202,
        payload: { downloading: true, torrentId: dl.torrentId, torrentHash: dl.hash, torrentTitle: dl.title || '', imdbId: imdbId }
      };
    }
    return { status: 404, payload: { error: (dl && dl.error) || 'Could not start download on TorBox.', torboxError: dl && dl.torboxError, imdbId: imdbId } };
  }

  // 6. Clear error (never 502)
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

  if (req.query.action === 'progress') {
    var pollResult = await processProgressPoll(req);
    if (pollResult.status === 200 && pollResult.payload && pollResult.payload.hlsUrl) {
      var pollKey = type + ':' + tmdbId + ':' + season + ':' + episode;
      var pollStore = {
        hlsUrl: pollResult.payload.hlsUrl,
        source: pollResult.payload.source || 'TorBox',
        debug: pollResult.payload.debug || null
      };
      cacheSet(pollKey, pollStore);
      upstashSet(pollKey, pollStore, UPSTASH_RESULT_TTL);
    }
    return res.status(pollResult.status).json(pollResult.payload);
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

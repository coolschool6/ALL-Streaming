// Environment Variables
var TMDB_KEY = process.env.TMDB_API_KEY || 'cd27a14dfc1752e04b474124a5af6d2b';
var TORBOX_KEY = process.env.TORBOX_API_KEY;
var TORBOX_API = 'https://api.torbox.app/v1/api';

var UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
var UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
var UPSTASH_RESULT_TTL = 3 * 60 * 60;
var UPSTASH_TR_TTL = 24 * 60 * 60;
var CACHE_VERSION = 'v8';

// ---- In-memory caches (per-instance, best-effort) ----
var RESULT_CACHE = {};
var RESULT_CACHE_TTL = 3 * 60 * 60 * 1000;
var RESULT_CACHE_MAX = 400;

var DOWNLOAD_QUEUE = {};

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

// Cached entries are stored as { url, direct, source, debug, sourceTitle, sourceWarning } (legacy: { hlsUrl, source, debug }).
function normalizeCachedPayload(entry) {
  if (!entry) return null;
  var out = { source: entry.source || 'TorBox', debug: entry.debug || null };
  if (entry.sourceTitle) out.sourceTitle = entry.sourceTitle;
  if (entry.sourceWarning) out.sourceWarning = entry.sourceWarning;
  if (entry.direct) {
    out.directUrl = entry.url;
    out.direct = true;
  } else if (entry.url) {
    out.hlsUrl = entry.url;
  } else if (entry.hlsUrl) {
    out.hlsUrl = entry.hlsUrl;
  } else {
    return null;
  }
  return out;
}

function toCacheStore(payload) {
  return {
    url: payload.hlsUrl || payload.directUrl,
    direct: !!payload.directUrl,
    source: payload.source || 'TorBox',
    debug: payload.debug || null,
    sourceTitle: payload.sourceTitle || '',
    sourceWarning: payload.sourceWarning || ''
  };
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

function buildCacheKey(type, tmdbId, season, episode) {
  return CACHE_VERSION + ':' + type + ':' + tmdbId + ':' + (season || '1') + ':' + (episode || '1');
}

function buildTrKey(imdbId, season, episode) {
  return CACHE_VERSION + ':tr:' + imdbId + ':' + (season || '1') + ':' + (episode || '1');
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

// Penalize obvious foreign-dub tags so English/untagged releases win whenever available.
var EN_FLAG = /\u{1F1FA}\u{1F1F8}|\u{1F1EC}\u{1F1E7}|\u{1F1E8}\u{1F1E7}|\u{1F1E6}\u{1F1F5}|\u{1F1EE}\u{1F1E8}|\u{1F1F3}\u{1F1FA}/u;
function languagePenalty(title) {
  var u = String(title || '').toUpperCase();
  var score = 0;
  if (/\bDUBBED\b|\bDUBBING\b|\bDUBLADO\b|\bPLDUB\b|\bUKR\b|\bVOSTFR\b|\bFRENCH\b|\bGERMAN\b|\bITALIAN\b|\bSPANISH\b|\bESPANOL\b|\bHINDI\b|\bTAMIL\b|\bTELUGU\b|\bARABIC\b|\bTURKISH\b|\bRUSSIAN\b|\bPOLISH\b|\bPOLSKI\b|\bRUS\b|\bLAT\b|\bDUB\b/i.test(u)) score -= 25;
  if (/[\u{1F1E6}-\u{1F1FF}]/u.test(u) && !EN_FLAG.test(u)) score -= 12;
  return score;
}

function buildSourceWarning(cand) {
  var t = cand && cand.title ? String(cand.title) : '';
  if (!t) return '';
  var u = t.toUpperCase();
  var lowQuality = /\b(CAM|HDCAM|TELESYNC|TS|TC|HDTS|SCR|DVDSCR|R5|R6)\b/.test(u) || !parseQuality(t);
  var dubbed = languagePenalty(t) <= -20;
  if (!lowQuality && !dubbed) return '';
  var parts = [];
  if (dubbed) parts.push('dubbed');
  if (lowQuality) {
    var q = parseQuality(t);
    var tier = q === 4 ? '4K' : q === 3 ? '1080p' : q === 2 ? '720p' : q === 1 ? 'SD' : '';
    parts.push('low-quality' + (tier ? ' ' + tier : ''));
  }
  return 'Only ' + parts.join(' / ') + ' sources are available for this title yet.';
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function is3DFile(title) {
  return /\b3d\b|3d-|hsbs|full ?sbs|\bsbs\b|stereoscopic|anaglyph/i.test(String(title || ''));
}

function buildTitleTokens(title) {
  return normalizeText(title)
    .split(' ')
    .filter(function (token) {
      return token && token.length > 2 && !/^\d{4}$/.test(token);
    });
}

function extractYearFromTitle(title) {
  var m = /(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/.exec(String(title || ''));
  return m ? parseInt(m[1], 10) : null;
}

// "moana 2" -> "moana"; "moana" -> "moana" (strips a trailing number off the base title)
function baseTitleOf(normalizedTitle) {
  return String(normalizedTitle || '').trim().replace(/\s+\d{1,3}$/, '');
}

// Trailing installment number of an expected title: "moana 2" -> 2, "moana" -> null
function installmentOf(normalizedTitle) {
  var m = /\b(\d{1,2})\s*$/.exec(String(normalizedTitle || '').trim());
  return m ? parseInt(m[1], 10) : null;
}

// Number directly following the base title in a candidate, e.g. "moana 2 ..." -> 2.
// A 4-digit year (2026) does NOT count as an installment.
function candidateInstallment(baseTitle, title) {
  if (!baseTitle) return null;
  var escaped = baseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('\\b' + escaped + '(?:\\s+|\\.|-|_)*\\s*(\\d{1,2})(?![0-9])');
  var m = re.exec(normalizeText(title));
  return m ? parseInt(m[1], 10) : null;
}

// Drop torrents that clearly belong to a DIFFERENT movie: wrong year or wrong
// installment ("Moana 2" served for "Moana" 2026). Movies only; TV relies on its
// own S/E matching. Candidates with no title info are kept.
function filterCandidatesForTitle(candidates, meta, type) {
  if (type !== 'movie' || !candidates || !candidates.length || !meta || !meta.title) return candidates;
  var expectedTitle = normalizeText(meta.title);
  var baseTitle = baseTitleOf(expectedTitle);
  var expectedInst = installmentOf(expectedTitle);
  var expectedYear = meta.year || null;
  if (!baseTitle || baseTitle.length < 2) return candidates;

  var out = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var rawTitle = c.title || '';
    if (!rawTitle) { out.push(c); continue; }
    var name = normalizeText(rawTitle);
    if (name.indexOf(baseTitle) === -1) { out.push(c); continue; }

    var inst = candidateInstallment(baseTitle, name);
    if (inst !== null && inst !== expectedInst) continue;

    if (expectedYear) {
      var y = extractYearFromTitle(name);
      if (y !== null && y !== expectedYear) continue;
    }
    out.push(c);
  }
  return out;
}

function scoreVideoFileName(fileName, candTitle, type, season, episode, expectedTitle, expectedYear) {
  var name = normalizeText(fileName);
  var score = 0;
  var tokens = buildTitleTokens(candTitle);

  for (var i = 0; i < tokens.length; i++) {
    if (name.indexOf(tokens[i]) !== -1) score += 4;
  }

  if (type === 'tv') {
    var sPadded = String(season).padStart(2, '0');
    var ePadded = String(episode).padStart(2, '0');
    if (new RegExp('s' + sPadded + 'e' + ePadded).test(name)) score += 12;
    if (new RegExp('' + season + 'x' + ePadded).test(name)) score += 10;
    if (new RegExp('episode\s*' + String(episode).padStart(1, '0')).test(name)) score += 6;
  }

  if (/sample|trailer|teaser|promo|preview|behind the scenes|featurette|clip|music video|song|soundtrack|ost|opening|ending|extras?|bonus|deleted scenes?|subtitle|sample/.test(name)) {
    score -= 20;
  }

  if (is3DFile(fileName)) score -= 30;

  score += languagePenalty(candTitle || fileName);

  if (/full movie|complete movie|main movie|feature|movie/.test(name)) score += 3;
  if (/\b(1080|2160|720|480)p\b/.test(name)) score += 2;
  if (/\b(x264|x265|hevc|avc)\b/.test(name)) score += 2;
  if (/\b(bluray|web-dl|webrip|hdrip|remux)\b/.test(name)) score += 1;
  if (/\b(cam|ts|tc|scr|dvdscr)\b/.test(name)) score -= 8;

  if (expectedTitle) {
    var eTitle = normalizeText(expectedTitle);
    var eBase = baseTitleOf(eTitle);
    var eInst = installmentOf(eTitle);
    if (eBase && name.indexOf(eBase) !== -1) score += 8;
    var cInst = candidateInstallment(eBase, name);
    if (cInst !== null && cInst !== eInst) score -= 15;
    if (expectedYear) {
      var fYear = extractYearFromTitle(name);
      if (fYear !== null && fYear !== expectedYear) score -= 15;
    }
  }

  return score;
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

// Score a cached torrent: AVC over HEVC, higher quality, small/quick, not a giant pack.
function scoreCachedCandidate(cand) {
  var codec = parseCodec(cand.title);
  var quality = parseQuality(cand.title);
  var size = parseSizeGB(cand.title);
  var score = (codec === 'avc' ? 60 : codec === 'hevc' ? 30 : 10) + quality * 5;
  if (is3DFile(cand.title)) score -= 60;
  if (size > 0 && size > 40) score -= 40;
  if (size > 0 && size <= 3) score += 6;
  if (/pack|collection|complete|box ?set|season/i.test(cand.title || '')) score -= 6;
  score += languagePenalty(cand.title);
  return score;
}

// Find the best cached candidate. Checks up to maxChecked hashes in batched requests.
async function findCachedCandidate(candidates, maxChecked) {
  var limit = Math.min(maxChecked || 100, candidates.length);
  var BATCH = 50;
  var cachedFound = [];
  for (var start = 0; start < limit; start += BATCH) {
    var chunk = candidates.slice(start, start + BATCH);
    var hashList = chunk.map(function (c) { return c.cleanHash; }).join(',');
    var j = await torboxFetch('/torrents/checkcached?hash=' + hashList + '&format=object&list_files=true', 8000);
    var map = parseCheckcachedMap(j);
    for (var i = 0; i < chunk.length; i++) {
      var entry = map[chunk[i].cleanHash];
      if (entry && entry.cached !== false && !is3DFile(chunk[i].title)) {
        cachedFound.push({ cand: chunk[i], files: entry.files || [] });
      }
    }
    if (cachedFound.length) break;
  }
  if (!cachedFound.length) return null;
  cachedFound.sort(function (a, b) {
    return scoreCachedCandidate(b.cand) - scoreCachedCandidate(a.cand);
  });
  return cachedFound[0];
}

async function findCachedCandidates(candidates, maxChecked) {
  var limit = Math.min(maxChecked || 100, candidates.length);
  var BATCH = 50;
  var cachedFound = [];
  for (var start = 0; start < limit; start += BATCH) {
    var chunk = candidates.slice(start, start + BATCH);
    var hashList = chunk.map(function (c) { return c.cleanHash; }).join(',');
    var j = await torboxFetch('/torrents/checkcached?hash=' + hashList + '&format=object&list_files=true', 8000);
    var map = parseCheckcachedMap(j);
    for (var i = 0; i < chunk.length; i++) {
      var entry = map[chunk[i].cleanHash];
      if (entry && entry.cached !== false && !is3DFile(chunk[i].title)) {
        cachedFound.push({ cand: chunk[i], files: entry.files || [] });
      }
    }
  }
  if (!cachedFound.length) return [];
  cachedFound.sort(function (a, b) {
    return scoreCachedCandidate(b.cand) - scoreCachedCandidate(a.cand);
  });
  return cachedFound;
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

function isBozoError(err) {
  if (!err) return false;
  var code = String(err.torboxError || err.code || '').toUpperCase();
  if (code === 'BOZO_FILE') return true;
  var msg = String(err.error || err.message || '').toUpperCase();
  return msg.indexOf('BOZO_FILE') !== -1 || msg.indexOf('BAD FILE') !== -1;
}

// ---- Segment-level health check for TorBox stream URLs ----
// createStream can succeed even when the underlying file never delivers bytes;
// these are the "bozo" files that hang at the CDN level. We verify the first
// media segment actually flows before committing to a stream.
var GOOD_STREAM_SET = {};
var BAD_STREAM_SET = {};

function resolveStreamUrl(base, ref) {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (ref.charAt(0) === '/') {
    var m = /^(https?:\/\/[^/]+)/i.exec(base);
    return m ? m[1] + ref : base + ref;
  }
  return base.slice(0, base.lastIndexOf('/') + 1) + ref;
}

function firstPlaylistLine(txt) {
  var lines = txt.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line && line.charAt(0) !== '#') return line;
  }
  return null;
}

async function fetchPlaylistText(url) {
  var r = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('playlist status ' + r.status);
  return r.text();
}

async function verifyHlsSegment(hlsUrl) {
  if (typeof fetch !== 'function') return true;
  try {
    var txt = await fetchPlaylistText(hlsUrl);
    var line = firstPlaylistLine(txt);
    if (!line) return false;
    if (/\.m3u8($|\?)/i.test(line)) {
      txt = await fetchPlaylistText(resolveStreamUrl(hlsUrl, line));
      line = firstPlaylistLine(txt);
      if (!line || /\.m3u8($|\?)/i.test(line)) return false;
    }
    var seg = await fetch(resolveStreamUrl(hlsUrl, line), { signal: AbortSignal.timeout(9000) });
    if (!seg.ok) throw new Error('segment status ' + seg.status);
    var reader = seg.body.getReader();
    var chunk = await reader.read();
    return !!(chunk.value && chunk.value.byteLength > 0);
  } catch (e) {
    return false;
  }
}

async function verifyDirectUrl(url) {
  if (typeof fetch !== 'function') return true;
  try {
    var r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { Range: 'bytes=0-1023' } });
    if (!r.ok && r.status !== 206) return false;
    var buf = await r.arrayBuffer();
    return buf.byteLength > 0;
  } catch (e) {
    return false;
  }
}

async function verifyStream(stream) {
  if (!stream || (!stream.hlsUrl && !stream.directUrl)) return { ok: false, key: null };
  var key = stream.hlsUrl || stream.directUrl;
  if (GOOD_STREAM_SET[key]) return { ok: true, key: key };
  if (BAD_STREAM_SET[key]) return { ok: false, key: key };
  var ok = stream.hlsUrl ? await verifyHlsSegment(stream.hlsUrl) : await verifyDirectUrl(stream.directUrl);
  if (ok) GOOD_STREAM_SET[key] = true;
  else BAD_STREAM_SET[key] = true;
  return { ok: ok, key: key };
}

function extractHlsUrl(json) {
  var payload = (json && json.data) || json || null;
  if (!payload || typeof payload !== 'object') return '';

  var candidates = [];
  if (payload.hls_url) candidates.push(payload.hls_url);
  if (payload.hlsUrl) candidates.push(payload.hlsUrl);
  if (payload.url) candidates.push(payload.url);
  if (payload.stream_url) candidates.push(payload.stream_url);
  if (payload.streamUrl) candidates.push(payload.streamUrl);
  if (payload.m3u8_url) candidates.push(payload.m3u8_url);
  if (payload.m3u8Url) candidates.push(payload.m3u8Url);
  if (payload.manifest_url) candidates.push(payload.manifest_url);
  if (payload.manifestUrl) candidates.push(payload.manifestUrl);
  if (payload.playback_url) candidates.push(payload.playback_url);
  if (payload.playbackUrl) candidates.push(payload.playbackUrl);
  if (Array.isArray(payload.urls)) payload.urls.forEach(function (u) { if (typeof u === 'string') candidates.push(u); });
  if (Array.isArray(payload.streams)) payload.streams.forEach(function (u) { if (typeof u === 'string') candidates.push(u); });

  for (var i = 0; i < candidates.length; i++) {
    var candidate = String(candidates[i] || '').trim();
    if (!candidate) continue;
    if (/\.m3u8($|\?)/i.test(candidate) || /\/stream\//i.test(candidate) || /\/manifest/i.test(candidate)) {
      return candidate;
    }
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

function fileSizeBytes(f) {
  if (!f) return 0;
  var n = parseFloat(f.size || f.bytes || f.length || f.size_bytes || 0);
  if (isFinite(n) && n > 0) return n;
  var m = /(\d+(?:\.\d+)?)\s*(?:GB|GiB)/i.exec(f.name || f.short_name || '');
  if (m) return parseFloat(m[1]) * 1024 * 1024 * 1024;
  var mb = /(\d+(?:\.\d+)?)\s*(?:MB|MiB)/i.exec(f.name || f.short_name || '');
  if (mb) return parseFloat(mb[1]) * 1024 * 1024;
  return 0;
}

// Best candidate to actually download: AVC first, good quality, but not a giant remux.
function downloadScore(c) {
  var codec = parseCodec(c.title);
  var quality = parseQuality(c.title);
  var size = parseSizeGB(c.title);
  var score = (codec === 'avc' ? 100 : codec === 'hevc' ? 60 : 30) + quality * 10;
  if (is3DFile(c.title)) score -= 60;
  if (size > 0 && size > 40) score -= 60;
  if (size > 0 && size <= 3) score += 8;
  if (/pack|collection|complete|box ?set|season/i.test(c.title || '')) score -= 30;
  score += languagePenalty(c.title);
  return score;
}

function rankDownloadCandidates(candidates) {
  if (!candidates || !candidates.length) return [];
  return candidates.slice().sort(function (a, b) {
    return downloadScore(b) - downloadScore(a);
  });
}

function pickDownloadCandidate(candidates) {
  return rankDownloadCandidates(candidates)[0] || null;
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

function pickVideoFile(files, type, season, episode, cand, meta) {
  var videoFiles = files.filter(function (f) {
    var name = (f.name || f.short_name || '').toLowerCase();
    var isVidMime = f.mimetype && f.mimetype.indexOf('video/') === 0;
    var isVidExt = /\.(mp4|mkv|avi|mov|webm|ts|m3u8)$/i.test(name);
    return isVidMime || isVidExt;
  });
  if (videoFiles.length === 0) videoFiles = files;

  var fileId = null;
  if (videoFiles.length > 0) {
    var scored = videoFiles.map(function (f, idx) {
      var name = f.name || f.short_name || '';
      return {
        file: f,
        idx: idx,
        size: fileSizeBytes(f),
        score: scoreVideoFileName(name, cand && cand.title, type, season, episode, meta && meta.title, meta && meta.year)
      };
    });

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.size !== a.size) return b.size - a.size;
      return a.idx - b.idx;
    });

    var best = scored[0] ? scored[0].file : null;
    fileId = best && best.id !== undefined ? best.id : (scored[0] ? scored[0].idx : null);
  }
  if (fileId === null || fileId === undefined) fileId = cand && cand.fileIdx;
  if (fileId === null || fileId === undefined) fileId = 0;
  return fileId;
}

function pickVideoFileCandidates(files, type, season, episode, cand, meta) {
  var videoFiles = files.filter(function (f) {
    var name = (f.name || f.short_name || '').toLowerCase();
    var isVidMime = f.mimetype && f.mimetype.indexOf('video/') === 0;
    var isVidExt = /\.(mp4|mkv|avi|mov|webm|ts|m3u8)$/i.test(name);
    return isVidMime || isVidExt;
  });
  if (videoFiles.length === 0) videoFiles = files;

  return videoFiles.map(function (f, idx) {
    var name = f.name || f.short_name || '';
    return {
      file: f,
      idx: idx,
      size: fileSizeBytes(f),
      score: scoreVideoFileName(name, cand && cand.title, type, season, episode, meta && meta.title, meta && meta.year)
    };
  }).sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (b.size !== a.size) return b.size - a.size;
    return a.idx - b.idx;
  }).map(function (entry) {
    var f = entry.file;
    if (f.id !== undefined) return f;
    var copy = {};
    for (var k in f) { if (Object.prototype.hasOwnProperty.call(f, k)) copy[k] = f[k]; }
    copy.id = entry.idx;
    return copy;
  });
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

async function createStreamForTorrent(torrentId, files, type, season, episode, cand, meta) {
  var candidateFiles = pickVideoFileCandidates(files || [], type, season, episode, cand, meta);
  if (!candidateFiles.length) candidateFiles = [{ id: 0 }];

  var lastError = null;
  for (var i = 0; i < candidateFiles.length; i++) {
    var currentFile = candidateFiles[i];
    var fileId = currentFile && currentFile.id !== undefined ? currentFile.id : 0;
    var path = '/stream/createstream?id=' + torrentId + '&file_id=' + fileId + '&type=torrent';
    var res = await torboxRequest(path, 'GET', null, 8000);
    if (!res) {
      lastError = { error: 'TorBox is unreachable. Try again.', torboxError: 'request_failed' };
      continue;
    }

    var json = res.json;
    var torboxCode = torboxErrorCode(json);
    if (!res.ok || !json || !json.success || !json.data) {
      lastError = { error: friendlyTorBoxError(json), torboxError: torboxCode || 'stream_failed' };
      if (torboxCode === 'BOZO_FILE' || torboxCode === 'bozo_file') continue;
      if (String(lastError.error || '').toLowerCase().indexOf('bad file') !== -1) continue;
      continue;
    }

    var hlsUrl = extractHlsUrl(json);
    if (!hlsUrl) {
      lastError = { error: 'TorBox returned no HLS manifest URL.', torboxError: 'no_hls' };
      continue;
    }

    return {
      hlsUrl: hlsUrl,
      source: buildSourceMeta(cand),
      sourceTitle: (cand && cand.title) || null,
      sourceWarning: buildSourceWarning(cand),
      debug: {
        hash: cand ? cand.cleanHash : null,
        torrentId: torrentId,
        fileId: fileId,
        codec: parseCodec(cand && cand.title)
      }
    };
  }

  return lastError || { error: 'TorBox could not create a native HLS stream for this title.', torboxError: 'stream_failed' };
}

function isBrowserPlayableFile(files, fileId, cand) {
  var codec = parseCodec(cand && cand.title);
  if (codec === 'hevc') return false;
  var f = null;
  if (Array.isArray(files)) {
    f = files.find(function (x) { return String(x.id) === String(fileId); });
  }
  var name = ((f && (f.name || f.short_name)) || '').toLowerCase();
  var mime = (f && f.mimetype) || '';
  var extOk = /\.(mp4|webm|mov|mkv|m4v|ts|avi)$/i.test(name);
  var mimeOk = mime.indexOf('video/') === 0;
  return extOk || mimeOk;
}

// Native TorBox HLS only. We no longer use direct-download fallbacks for playback.
async function resolveStreamOrDirect(torrentId, files, type, season, episode, cand, meta) {
  var stream = await createStreamForTorrent(torrentId, files, type, season, episode, cand, meta);
  if (stream && stream.hlsUrl) return stream;
  return stream || {
    error: 'TorBox could not create a native HLS stream for this title.',
    torboxError: 'stream_failed'
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
  var stream = await resolveStreamOrDirect(torrentId, prog.files, type, season, episode, cand);
  var verified = await verifyStream(stream);
  if (!verified.ok) {
    var queue = DOWNLOAD_QUEUE[String(torrentId)];
    var isBadStream = !!verified.key;
    if ((isBadStream || isBozoError(stream)) && queue && queue.nextIdx < queue.cands.length) {
      var next = queue.cands[queue.nextIdx];
      queue.nextIdx += 1;
      try { await torboxRequest('/torrents/delete?id=' + torrentId, 'GET', null, 4000); } catch (e) {}
      var dl = await startTorrentDownload(next, queue.type || type, queue.season || season, queue.episode || episode);
      if (dl && dl.torrentId) {
        DOWNLOAD_QUEUE[String(dl.torrentId)] = queue;
        return {
          status: 202,
          payload: { downloading: true, progress: 0, retry: true, torrentId: dl.torrentId, torrentHash: dl.hash, torrentTitle: dl.title || '' }
        };
      }
    }
    return {
      status: 404,
      payload: { error: (stream && stream.error) || 'Could not start streaming this torrent.', torboxError: (stream && stream.torboxError) || 'BOZO_FILE', fileId: stream && stream.fileId, bozo: true }
    };
  }
  return { status: 200, payload: stream };
}

// ---- Build a TorBox stream from a list of torrent candidates ----
async function buildTorBoxStream(candidates, type, season, episode, meta) {
  var cachedList = await findCachedCandidates(candidates, 100);
  if (!cachedList.length) return null;

  var lastErr = null;
  for (var ci = 0; ci < cachedList.length; ci++) {
    var best = cachedList[ci];
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
      lastErr = { error: 'Torrent is cached but could not be added to your TorBox account.', torboxError: 'no_torrent_id' };
      continue;
    }

    var stream = await resolveStreamOrDirect(torrentId, cachedFiles, type, season, episode, best.cand, meta);
    if (stream && (stream.hlsUrl || stream.directUrl)) {
      var v = await verifyStream(stream);
      if (v.ok) return stream;
      lastErr = { error: 'TorBox file is currently unavailable (bad file).', torboxError: 'BOZO_FILE', bozo: true };
      continue;
    }
    lastErr = stream || lastErr;
  }
  return lastErr || null;
}

// ---- Main pipeline (hybrid: client scrapes in-browser, server talks to TorBox) ----
async function processStreamRequest(req) {
  var tmdbId = req.query.tmdbId || (req.body && req.body.tmdbId);
  var type = req.query.type || (req.body && req.body.type);
  var season = req.query.season || (req.body && req.body.season) || '1';
  var episode = req.query.episode || (req.body && req.body.episode) || '1';
  var givenImdb = req.query.imdbId || (req.body && req.body.imdbId);

  // 1. Resolve IMDb ID from TMDB (cached) or from the client, and expected title/year for matching
  var meta = {
    title: req.query.title || (req.body && req.body.title) || null,
    year: parseInt(req.query.year || (req.body && req.body.year) || '', 10) || null
  };
  var imdbId = givenImdb || imdbCacheGet(tmdbId);
  if (!imdbId || (type === 'movie' && !meta.title)) {
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
      if (movie) {
        if (!meta.title) meta.title = movie.title || movie.original_title || null;
        if (!meta.year) {
          var rd = movie.release_date;
          meta.year = rd ? parseInt(String(rd).substring(0, 4), 10) : null;
        }
      }
    }
    imdbCacheSet(tmdbId, imdbId);
  }

  if (!imdbId) {
    return { status: 404, payload: { error: 'Could not resolve IMDb ID from TMDB', imdbId: null } };
  }

  var trKey = buildTrKey(imdbId, season, episode);
  var provided = extractCandidates(req);

  // 2. Use hashes the client scraped in its own browser, or a shared cache
  var candidates = null;
  if (provided && provided.length) {
    candidates = sortCandidates(provided);
  } else {
    var sharedHashes = trCacheGet(trKey);
    if (!sharedHashes) sharedHashes = await upstashTrGet(trKey);
    if (sharedHashes && sharedHashes.length) {
      candidates = sharedHashes.map(function (h) {
        if (typeof h === 'string') return { cleanHash: String(h).toLowerCase(), title: '' };
        return { cleanHash: String(h.h || '').toLowerCase(), title: h.t || '' };
      }).filter(function (c) { return c.cleanHash; });
    }
  }

  // 3. Nothing shared yet -> tell the client to scrape torrentio in its own browser
  if (!candidates || candidates.length === 0) {
    return { status: 404, payload: { error: 'No shared torrent sources for this title yet.', imdbId: imdbId, needsScrape: true } };
  }

  // 3b. Drop torrents that clearly belong to a different movie (wrong year / wrong installment)
  if (candidates.length) {
    candidates = filterCandidatesForTitle(candidates, meta, type);
  }

  // 4. TorBox path
  var download = req.query.download === '1' || req.query.download === 'true' || !!(req.body && req.body.download);
  var torBoxResult = await buildTorBoxStream(candidates, type, season, episode, meta);
  if (torBoxResult) {
    torBoxResult.imdbId = imdbId;
  }
  if (provided && provided.length) {
    var shareData = provided.map(function (c) { return { h: c.cleanHash, t: c.title || '' }; });
    trCacheSet(trKey, shareData);
    upstashTrSet(trKey, shareData);
  }
  if (torBoxResult && (torBoxResult.hlsUrl || torBoxResult.directUrl)) {
    return { status: 200, payload: torBoxResult };
  }
  if (torBoxResult && torBoxResult.error) {
    return { status: 404, payload: { error: torBoxResult.error, torboxError: torBoxResult.torboxError, imdbId: imdbId } };
  }

  // 5. Nothing cached -> start a download that the client polls to completion
  if (download) {
    var ranked = rankDownloadCandidates(candidates);
    var cand = ranked[0] || null;
    if (!cand) {
      return { status: 404, payload: { error: 'No usable torrent candidate found.', imdbId: imdbId, noCached: true } };
    }
    var dl = await startTorrentDownload(cand, type, season, episode);
    if (dl && dl.torrentId) {
      DOWNLOAD_QUEUE[String(dl.torrentId)] = { cands: ranked, nextIdx: 1, type: type, season: season, episode: episode, imdbId: imdbId };
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
    if (pollResult.status === 200 && pollResult.payload && (pollResult.payload.hlsUrl || pollResult.payload.directUrl)) {
      var pollKey = type + ':' + tmdbId + ':' + season + ':' + episode;
      var pollStore = toCacheStore(pollResult.payload);
      cacheSet(pollKey, pollStore);
      upstashSet(pollKey, pollStore, UPSTASH_RESULT_TTL);
    }
    return res.status(pollResult.status).json(pollResult.payload);
  }

  var cacheKey = buildCacheKey(type, tmdbId, season, episode);
  var refresh = req.query.refresh === '1' || req.query.refresh === 'true';

  if (!refresh) {
    var cached = normalizeCachedPayload(cacheGet(cacheKey));
    if (cached) {
      cached.cached = true;
      return res.status(200).json(cached);
    }
    var shared = normalizeCachedPayload(await upstashGet(cacheKey));
    if (shared) {
      cacheSet(cacheKey, shared);
      shared.cached = 'shared';
      return res.status(200).json(shared);
    }
  }

    var timeoutPromise = new Promise(function (resolve) {
    setTimeout(function () {
      resolve({ status: 404, payload: { error: 'Stream lookup timed out. Retrying in the app...' } });
    }, 30000);
  });

  try {
    var result = await Promise.race([
      processStreamRequest(req),
      timeoutPromise
    ]);

    if (result.status === 200 && result.payload && (result.payload.hlsUrl || result.payload.directUrl)) {
      var toStore = toCacheStore(result.payload);
      cacheSet(cacheKey, toStore);
      upstashSet(cacheKey, toStore, UPSTASH_RESULT_TTL);
    }

    return res.status(result.status).json(result.payload);
  } catch (err) {
    return res.status(404).json({ error: 'Stream lookup failed. Please try again.' });
  }
}

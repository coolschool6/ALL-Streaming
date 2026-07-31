// Environment Variables (With TMDB Fallback)
var TMDB_KEY = process.env.TMDB_API_KEY || 'cd27a14dfc1752e04b474124a5af6d2b';
var TORBOX_KEY = process.env.TORBOX_API_KEY;
var TORBOX_API = 'https://api.torbox.app/v1/api';
var TORRENTIO = 'https://torrentio.strem.fun';

// Upstash Redis Configuration
var UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
var UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
var UPSTASH_TTL = 3 * 60 * 60; // 3 hours

// Local In-Memory Cache (Bounded)
var RESULT_CACHE = {};
var RESULT_CACHE_TTL = 3 * 60 * 60 * 1000;
var RESULT_CACHE_MAX = 300;

var TR_CACHE = {};
var TR_CACHE_TTL = 24 * 60 * 60 * 1000;

var IMDB_CACHE = {};
var IMDB_CACHE_TTL = 24 * 60 * 60 * 1000;

// Cache Helper Functions
function trCacheKey(imdbId, season, episode) {
  return 'tr:' + imdbId + ':' + season + ':' + episode;
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

function upstashEnabled() {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

async function upstashGet(key) {
  if (!upstashEnabled()) return null;
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function() { ctrl.abort(); }, 1500);
    var r = await fetch(UPSTASH_URL + '/get/' + key, {
      headers: { 'Authorization': 'Bearer ' + UPSTASH_TOKEN },
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) return null;
    var data = await r.json();
    var v = data && data.result;
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch (e) { return v; }
    }
    return v;
  } catch (e) { return null; }
}

async function upstashSet(key, value, ttlSeconds) {
  if (!upstashEnabled()) return;
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function() { ctrl.abort(); }, 1500);
    await fetch(UPSTASH_URL + '/set/' + key + '?EX=' + (ttlSeconds || UPSTASH_TTL), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + UPSTASH_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(value),
      signal: ctrl.signal
    });
    clearTimeout(t);
  } catch (e) { /* Shared cache best effort */ }
}

// Fetch Utility Wrappers
async function tmdbFetch(path) {
  if (!TMDB_KEY) return null;
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function() { ctrl.abort(); }, 2500);
    var r = await fetch('https://api.themoviedb.org/3' + path + '?api_key=' + TMDB_KEY + '&language=en', { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function torboxFetch(path) {
  if (!TORBOX_KEY) return null;
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function() { ctrl.abort(); }, 3000);
    var r = await fetch(TORBOX_API + path, {
      headers: { 'Authorization': 'Bearer ' + TORBOX_KEY },
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function torboxPost(path, body) {
  if (!TORBOX_KEY) return null;
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function() { ctrl.abort(); }, 3500);
    var r = await fetch(TORBOX_API + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TORBOX_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body,
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

// Stream Parser Helpers
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

// Internal Logic Runner
async function processStreamRequest(req) {
  var tmdbId = req.query.tmdbId;
  var type = req.query.type;
  var season = req.query.season || '1';
  var episode = req.query.episode || '1';

  var refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  var cacheKey = type + ':' + tmdbId + ':' + season + ':' + episode;

  if (!refresh) {
    var cached = cacheGet(cacheKey);
    if (cached) {
      cached.cached = true;
      return { status: 200, payload: cached };
    }

    var shared = await upstashGet(cacheKey);
    if (shared) {
      cacheSet(cacheKey, shared);
      shared.cached = 'shared';
      return { status: 200, payload: shared };
    }
  }

  var imdbId = imdbCacheGet(tmdbId);

  if (!imdbId && type === 'tv') {
    var ext = await tmdbFetch('/tv/' + tmdbId + '/external_ids');
    imdbId = ext ? ext.imdb_id : null;
    if (!imdbId) {
      var tvData = await tmdbFetch('/tv/' + tmdbId);
      if (tvData && tvData.external_ids && tvData.external_ids.imdb_id) {
        imdbId = tvData.external_ids.imdb_id;
      }
    }
  } else if (!imdbId) {
    var movie = await tmdbFetch('/movie/' + tmdbId);
    imdbId = movie ? movie.imdb_id : null;
  }
  
  imdbCacheSet(tmdbId, imdbId);

  if (!imdbId) {
    return { status: 404, payload: { error: 'Could not resolve IMDb ID from TMDB' } };
  }

  var torrentioUrl = type === 'tv'
    ? TORRENTIO + '/stream/series/' + imdbId + ':' + season + ':' + episode + '.json'
    : TORRENTIO + '/stream/movie/' + imdbId + '.json';

  var trKey = trCacheKey(imdbId, season, episode);
  var tr = trCacheGet(trKey) || await upstashGet(trKey);
  var trFromCache = !!tr;

  if (!tr) {
    try {
      var ctrl = new AbortController();
      var t = setTimeout(function() { ctrl.abort(); }, 3500);
      var trRes = await fetch(torrentioUrl, { signal: ctrl.signal });
      clearTimeout(t);
      
      if (trRes.status === 429) {
        return { status: 429, payload: { error: 'Torrentio rate limit reached.' } };
      }
      if (!trRes.ok) {
        return { status: 404, payload: { error: 'Torrent search failed.' } };
      }
      tr = await trRes.json();
    } catch (e) {
      return { status: 404, payload: { error: 'Torrent search connection timed out.' } };
    }
  }

  if (!tr || !tr.streams || tr.streams.length === 0) {
    return { status: 404, payload: { error: 'No torrent streams available.' } };
  }

  if (!trFromCache) {
    trCacheSet(trKey, tr);
    await upstashSet(trKey, tr, 24 * 60 * 60);
  }

  var candidates = tr.streams
    .filter(function(s) { return s && s.infoHash; })
    .sort(function(a, b) {
      var ca = parseCodec(a.title), cb = parseCodec(b.title);
      var pa = ca === 'avc' ? 2 : (ca === 'hevc' ? 1 : 0);
      var pb = cb === 'avc' ? 2 : (cb === 'hevc' ? 1 : 0);
      if (pb !== pa) return pb - pa;
      return parseQuality(b.title) - parseQuality(a.title);
    });

  var best = null;
  var bestQ = 0;
  var hash = null;
  var isCached = false;
  var cachedFiles = [];
  var chosenCodec = '';

  // Parallel Batch check all candidate torrents simultaneously
  var batch = candidates.slice(0, 25);
  var batchResults = await Promise.all(batch.map(function (cand) {
    return torboxFetch('/torrents/checkcached?hash=' + cand.infoHash + '&format=object&list_files=true')
      .then(function (hashResult) {
        var candCached = false;
        var candFiles = [];
        if (hashResult && hashResult.success && hashResult.data && typeof hashResult.data === 'object' && !Array.isArray(hashResult.data)) {
          var hashData = hashResult.data[cand.infoHash];
          if (hashData) candCached = true;
          if (hashData && hashData.files) candFiles = hashData.files;
        }
        return { cand: cand, candCached: candCached, candFiles: candFiles };
      })
      .catch(function () { return { cand: cand, candCached: false, candFiles: [] }; });
  }));

  for (var bi = 0; bi < batchResults.length; bi++) {
    if (batchResults[bi].candCached) {
      var match = batchResults[bi];
      best = match.cand;
      bestQ = parseQuality(match.cand.title);
      hash = match.cand.infoHash;
      isCached = true;
      cachedFiles = match.candFiles || [];
      chosenCodec = parseCodec(match.cand.title);
      break;
    }
  }

  if (!isCached) {
    return { status: 404, payload: { error: 'Stream is not cached on TorBox.' } };
  }

  var fileId = 0;
  var videoFiles = cachedFiles.filter(function(f) { 
    var name = (f.name || f.short_name || '').toLowerCase();
    var isVidMime = f.mimetype && f.mimetype.indexOf('video/') === 0;
    var isVidExt = /\.(mp4|mkv|avi|mov|ts|m3u8)$/i.test(name);
    return isVidMime || isVidExt;
  });

  if (videoFiles.length === 0) videoFiles = cachedFiles;

  if (type === 'tv' && videoFiles.length > 0) {
    var sPadded = String(season).padStart(2, '0');
    var ePadded = String(episode).padStart(2, '0');
    var epMatchPatterns = [
      new RegExp('S' + sPadded + 'E' + ePadded, 'i'),
      new RegExp(season + 'x' + ePadded, 'i'),
      new RegExp('E' + ePadded, 'i')
    ];

    var matched = null;
    for (var p = 0; p < epMatchPatterns.length; p++) {
      var pat = epMatchPatterns[p];
      matched = videoFiles.find(function(f) { return pat.test(f.name || f.short_name || ''); });
      if (matched) break;
    }

    fileId = matched ? matched.id : videoFiles[0].id;
  } else if (videoFiles.length > 0) {
    fileId = videoFiles[0].id;
  }

  var magnet = 'magnet:?xt=urn:btih:' + hash;
  var createBody = new URLSearchParams();
  createBody.append('magnet', magnet);
  createBody.append('add_only_if_cached', 'true');
  if (type === 'tv') createBody.append('name', imdbId + '_S' + season + 'E' + episode);

  var created = await torboxPost('/torrents/createtorrent', createBody.toString());
  if (!created || !created.success) {
    return { status: 404, payload: { error: 'TorBox failed to create torrent.' } };
  }

  var torrentId = created.data ? created.data.torrent_id : null;
  if (!torrentId) {
    var mylist = await torboxFetch('/torrents/mylist?limit=1');
    if (mylist && mylist.success && mylist.data && mylist.data.length > 0) {
      torrentId = mylist.data[0].id;
    }
  }

  if (!torrentId) {
    return { status: 404, payload: { error: 'Could not resolve torrent reference ID.' } };
  }

  var streamUrl = '/stream/createstream?id=' + torrentId + '&file_id=' + fileId + '&type=torrent';
  var stream = await torboxFetch(streamUrl);

  if (!stream || !stream.success || !stream.data) {
    return { status: 404, payload: { error: 'Failed to request video stream generation.' } };
  }

  var hlsUrl = stream.data.hls_url;
  if (!hlsUrl) {
    return { status: 404, payload: { error: 'HLS URL is missing from response.' } };
  }

  var qualityName = 'HD';
  if (bestQ === 4) qualityName = '4K';
  else if (bestQ === 3) qualityName = '1080p';
  else if (bestQ === 2) qualityName = '720p';

  var sourceName = 'TorBox - ' + qualityName;
  var titleMatch = best.title ? best.title.match(/\|\s*(.+)$/) : null;
  if (titleMatch) sourceName += ' - ' + titleMatch[1].trim();

  var debugInfo = {
    hash: hash,
    torrentId: torrentId,
    fileId: fileId,
    codec: chosenCodec,
    needsTranscoding: stream.data.needs_transcoding,
    isTranscoding: stream.data.is_transcoding,
    isCached: isCached,
    serverTime: Date.now()
  };

  var payload = { hlsUrl: hlsUrl, source: sourceName, debug: debugInfo };
  cacheSet(cacheKey, payload);
  await upstashSet(cacheKey, payload);

  return { status: 200, payload: payload };
}

// Exported Handler With Strict Vercel 8.5s Timeout Guard
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!TORBOX_KEY) {
    return res.status(500).json({ error: 'TORBOX_API_KEY environment variable missing.' });
  }

  var tmdbId = req.query.tmdbId;
  var type = req.query.type;

  if (!tmdbId || !type) {
    return res.status(400).json({ error: 'Missing parameters tmdbId or type' });
  }

  // 8.5-second execution guard so function returns 404 before Vercel kills it at 10s with 502
  var timeoutPromise = new Promise(function(resolve) {
    setTimeout(function() {
      resolve({ status: 404, payload: { error: 'Stream lookup timed out. Fallback to server selector.' } });
    }, 8500);
  });

  try {
    var result = await Promise.race([
      processStreamRequest(req),
      timeoutPromise
    ]);
    return res.status(result.status).json(result.payload);
  } catch (err) {
    return res.status(404).json({ error: 'Stream lookup failed.' });
  }
}
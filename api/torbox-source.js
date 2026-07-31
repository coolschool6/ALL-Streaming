// Environment Variables
var TMDB_KEY = process.env.TMDB_API_KEY || 'cd27a14dfc1752e04b474124a5af6d2b';
var TORBOX_KEY = process.env.TORBOX_API_KEY;
var TORBOX_API = 'https://api.torbox.app/v1/api';

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
    var t = setTimeout(function() { ctrl.abort(); }, 4000);
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
    var t = setTimeout(function() { ctrl.abort(); }, 4500);
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

// Helpers
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

// Parallel Stream Fetching across Multiple Addons & APIs
async function fetchSingleScraper(baseUrl, subPath) {
  var ctrl = new AbortController();
  var t = setTimeout(function() { ctrl.abort(); }, 4500);
  try {
    var res = await fetch(baseUrl + subPath, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error('Bad response');
    var data = await res.json();
    if (data && data.streams && data.streams.length > 0) {
      return data.streams;
    }
    throw new Error('No streams');
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// YTS API Backup (Guaranteed work for Movies on Vercel)
async function fetchYtsStreams(imdbId) {
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function() { ctrl.abort(); }, 3500);
    var res = await fetch('https://yts.mx/api/v2/list_movies.json?query_term=' + imdbId, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    var data = await res.json();
    if (data && data.data && data.data.movies && data.data.movies[0] && data.data.movies[0].torrents) {
      return data.data.movies[0].torrents.map(function(t) {
        return {
          infoHash: t.hash,
          title: 'YTS ' + t.quality + ' ' + t.type
        };
      });
    }
    return [];
  } catch (e) {
    return [];
  }
}

async function getAllCandidateStreams(imdbId, type, season, episode) {
  var subPath = type === 'tv'
    ? '/stream/series/' + imdbId + ':' + season + ':' + episode + '.json'
    : '/stream/movie/' + imdbId + '.json';

  var scrapers = [
    'https://torrentio.strem.fun',
    'https://knightcrawler.elfhosted.com',
    'https://torrentio.elfhosted.com',
    'https://stremio-addons.com'
  ];

  // Fire all scrapers simultaneously
  var promises = scrapers.map(function(url) { return fetchSingleScraper(url, subPath); });
  
  if (type === 'movie') {
    promises.push(fetchYtsStreams(imdbId));
  }

  // Return the fastest successful provider
  try {
    var results = await Promise.allSettled(promises);
    var combined = [];
    for (var i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled' && Array.isArray(results[i].value)) {
        combined = combined.concat(results[i].value);
      }
    }
    return combined;
  } catch (e) {
    return [];
  }
}

// Main Process Execution
async function processStreamRequest(req) {
  var tmdbId = req.query.tmdbId;
  var type = req.query.type;
  var season = req.query.season || '1';
  var episode = req.query.episode || '1';

  // 1. Resolve IMDb ID from TMDB
  var imdbId = null;
  if (type === 'tv') {
    var ext = await tmdbFetch('/tv/' + tmdbId + '/external_ids');
    imdbId = ext ? ext.imdb_id : null;
    if (!imdbId) {
      var tvData = await tmdbFetch('/tv/' + tmdbId);
      if (tvData && tvData.external_ids && tvData.external_ids.imdb_id) {
        imdbId = tvData.external_ids.imdb_id;
      }
    }
  } else {
    var movie = await tmdbFetch('/movie/' + tmdbId);
    imdbId = movie ? movie.imdb_id : null;
  }

  if (!imdbId) {
    return { status: 404, payload: { error: 'Could not resolve IMDb ID from TMDB' } };
  }

  // 2. Fetch Streams in Parallel
  var streams = await getAllCandidateStreams(imdbId, type, season, episode);

  if (!streams || streams.length === 0) {
    return { status: 404, payload: { error: 'Torrent search connection timed out or no streams available.' } };
  }

  // 3. Clean & Deduplicate Candidates
  var hashSet = new Set();
  var candidates = streams
    .filter(function(s) { return s && (s.infoHash || s.hash); })
    .map(function(s) {
      s.cleanHash = String(s.infoHash || s.hash).trim().toLowerCase();
      return s;
    })
    .filter(function(s) {
      if (hashSet.has(s.cleanHash)) return false;
      hashSet.add(s.cleanHash);
      return true;
    })
    .sort(function(a, b) {
      var ca = parseCodec(a.title), cb = parseCodec(b.title);
      var pa = ca === 'avc' ? 2 : (ca === 'hevc' ? 1 : 0);
      var pb = cb === 'avc' ? 2 : (cb === 'hevc' ? 1 : 0);
      if (pb !== pa) return pb - pa;
      return parseQuality(b.title) - parseQuality(a.title);
    });

  if (candidates.length === 0) {
    return { status: 404, payload: { error: 'No valid torrent hashes found.' } };
  }

  // 4. Check TorBox Cache for Top 25 Candidates
  var topCandidates = candidates.slice(0, 25);
  var hashList = topCandidates.map(function(c) { return c.cleanHash; }).join(',');
  
  var checkRes = await torboxFetch('/torrents/checkcached?hash=' + hashList + '&format=object&list_files=true');

  var best = null;
  var bestQ = 0;
  var hash = null;
  var isCached = false;
  var cachedFiles = [];
  var chosenCodec = '';

  if (checkRes && checkRes.success && checkRes.data) {
    var cacheData = checkRes.data;
    for (var i = 0; i < topCandidates.length; i++) {
      var cand = topCandidates[i];
      var foundData = cacheData[cand.cleanHash] || cacheData[cand.cleanHash.toUpperCase()];
      
      if (foundData) {
        best = cand;
        bestQ = parseQuality(cand.title);
        hash = cand.cleanHash;
        isCached = true;
        cachedFiles = foundData.files || [];
        chosenCodec = parseCodec(cand.title);
        break;
      }
    }
  }

  if (!isCached) {
    return { status: 404, payload: { error: 'Stream is not cached on TorBox.' } };
  }

  // 5. Select Best Video File
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

  // 6. Check existing user transfers FIRST
  var torrentId = null;
  var mylist = await torboxFetch('/torrents/mylist');
  
  if (mylist && mylist.success && Array.isArray(mylist.data)) {
    var existing = mylist.data.find(function(item) {
      return item.hash && String(item.hash).toLowerCase() === hash.toLowerCase();
    });
    if (existing) {
      torrentId = existing.id;
    }
  }

  // If not already in account list, create it
  if (!torrentId) {
    var magnet = 'magnet:?xt=urn:btih:' + hash;
    var createBody = new URLSearchParams();
    createBody.append('magnet', magnet);
    createBody.append('add_only_if_cached', 'true');
    if (type === 'tv') createBody.append('name', imdbId + '_S' + season + 'E' + episode);

    var created = await torboxPost('/torrents/createtorrent', createBody.toString());
    if (created && created.success && created.data) {
      torrentId = created.data.torrent_id || created.data.id;
    }
  }

  if (!torrentId) {
    return { status: 404, payload: { error: 'Could not resolve torrent reference ID.' } };
  }

  // 7. Request stream generation
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

  return {
    status: 200,
    payload: {
      hlsUrl: hlsUrl,
      source: sourceName,
      debug: { hash: hash, torrentId: torrentId, fileId: fileId, codec: chosenCodec }
    }
  };
}

// Exported Handler
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

  var timeoutPromise = new Promise(function(resolve) {
    setTimeout(function() {
      resolve({ status: 404, payload: { error: 'Stream lookup timed out. Fallback to server selector.' } });
    }, 9000);
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
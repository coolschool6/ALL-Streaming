var TMDB_KEY = process.env.TMDB_API_KEY || 'cd27a14dfc1752e04b474124a5af6d2b';
var TORBOX_KEY = process.env.TORBOX_API_KEY;
var TORBOX_API = 'https://api.torbox.app/v1/api';
var TORRENTIO = 'https://torrentio.strem.fun';

async function tmdbFetch(path) {
  try {
    var r = await fetch('https://api.themoviedb.org/3' + path + '?api_key=' + TMDB_KEY + '&language=en');
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function torboxFetch(path) {
  try {
    var r = await fetch(TORBOX_API + path, {
      headers: { 'Authorization': 'Bearer ' + TORBOX_KEY }
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function torboxPost(path, body) {
  try {
    var r = await fetch(TORBOX_API + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TORBOX_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

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

function pickBestStream(streams) {
  if (!streams || streams.length === 0) return null;
  var best = null;
  var bestQ = -1;
  var bestCodecPref = -1;
  for (var i = 0; i < streams.length; i++) {
    var s = streams[i];
    if (!s.infoHash) continue;
    var q = parseQuality(s.title);
    var codec = parseCodec(s.title);
    var codecPref = codec === 'avc' ? 2 : (codec === 'hevc' ? 1 : 0);
    if (codecPref > bestCodecPref || (codecPref === bestCodecPref && q > bestQ)) {
      bestCodecPref = codecPref;
      bestQ = q;
      best = s;
    }
  }
  return { stream: best, quality: bestQ, codec: bestCodecPref === 2 ? 'avc' : (bestCodecPref === 1 ? 'hevc' : '') };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!TORBOX_KEY) {
    return res.status(500).json({ error: 'TorBox API key not configured' });
  }

  var tmdbId = req.query.tmdbId;
  var type = req.query.type;
  var season = req.query.season || '1';
  var episode = req.query.episode || '1';

  if (!tmdbId || !type) {
    return res.status(400).json({ error: 'Missing tmdbId or type' });
  }

  try {
    var imdbId;

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
      return res.status(404).json({ error: 'Could not resolve IMDb ID' });
    }

    var torrentioUrl = type === 'tv'
      ? TORRENTIO + '/stream/series/' + imdbId + ':' + season + ':' + episode + '.json'
      : TORRENTIO + '/stream/movie/' + imdbId + '.json';

    var tr;
    try {
      var trRes = await fetch(torrentioUrl);
      tr = await trRes.json();
    } catch (e) {
      return res.status(502).json({ error: 'Torrentio fetch failed' });
    }

    if (!tr || !tr.streams || tr.streams.length === 0) {
      return res.status(404).json({ error: 'No torrent streams found' });
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

    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      var candHash = cand.infoHash;
      var hashResult = await torboxFetch('/torrents/checkcached?hash=' + candHash + '&format=object&list_files=true');

      var candCached = false;
      var candFiles = [];
      if (hashResult && hashResult.success && hashResult.data && typeof hashResult.data === 'object' && !Array.isArray(hashResult.data)) {
        var hashData = hashResult.data[candHash];
        if (hashData) candCached = true;
        if (hashData && hashData.files) candFiles = hashData.files;
      }

      if (candCached) {
        best = cand;
        bestQ = parseQuality(cand.title);
        hash = candHash;
        isCached = true;
        cachedFiles = candFiles;
        chosenCodec = parseCodec(cand.title);
        break;
      }
    }

    if (!isCached) {
      return res.status(404).json({ error: 'Not cached on TorBox' });
    }

    var fileId = 0;
    var videoFiles = cachedFiles.filter(function(f) { return f.mimetype && f.mimetype.indexOf('video/') === 0; });
    if (videoFiles.length === 0) videoFiles = cachedFiles;

    if (type === 'tv' && videoFiles.length > 0) {
      var epStr = 'S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0');
      var matched = null;
      for (var fi = 0; fi < videoFiles.length; fi++) {
        var f = videoFiles[fi];
        if (f.name && f.name.toUpperCase().indexOf(epStr) !== -1) { matched = f; break; }
      }
      if (matched) fileId = matched.id;
      else fileId = videoFiles[0].id;
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
      return res.status(502).json({ error: 'Failed to create torrent on TorBox' });
    }

    var torrentId = created.data ? created.data.torrent_id : null;
    if (!torrentId) {
      var mylist = await torboxFetch('/torrents/mylist?limit=1');
      if (mylist && mylist.success && mylist.data && mylist.data.length > 0) {
        torrentId = mylist.data[0].id;
      }
    }

    if (!torrentId) {
      return res.status(502).json({ error: 'Could not get torrent ID from TorBox' });
    }

    var streamUrl = '/stream/createstream?id=' + torrentId + '&file_id=' + fileId + '&type=torrent';
    var stream = await torboxFetch(streamUrl);

    if (!stream || !stream.success || !stream.data) {
      return res.status(502).json({ error: 'Failed to create stream on TorBox' });
    }

    var hlsUrl = stream.data.hls_url;
    if (!hlsUrl) {
      return res.status(502).json({ error: 'No HLS URL in stream response' });
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
      serverTime: Date.now(),
      streamUrl: streamUrl,
      candidatesChecked: ci + 1
    };

    return res.status(200).json({ hlsUrl: hlsUrl, source: sourceName, debug: debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxENxJOCkcRQsYYGa-zGFwjz7R6-JRGHB5WP4lFqszzlQiFmLXT6IJihUGLmtxhBuPa/exec';
var GAS_URL = process.env.GAS_URL || DEFAULT_GAS_URL;

function gasFetch(url) {
  var ctrl = new AbortController();
  var t = setTimeout(function() { ctrl.abort(); }, 6000);
  return fetch(GAS_URL + '?action=fetch_url&url=' + encodeURIComponent(url), { signal: ctrl.signal })
    .then(function (r) { clearTimeout(t); return r.json(); })
    .then(function (d) {
      if (d.error) throw new Error(d.error);
      return d;
    })
    .catch(function (err) {
      clearTimeout(t);
      throw err;
    });
}

async function smartFetch(url) {
  var controller = new AbortController();
  var id = setTimeout(function () { controller.abort(); }, 3500);
  try {
    var direct = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    clearTimeout(id);
    var text = await direct.text();
    if (text.includes('Just a moment') || text.includes('challenges.cloudflare')) {
      var viaGas = await gasFetch(url);
      return viaGas.content || '';
    }
    return text;
  } catch (e) {
    clearTimeout(id);
    try {
      var viaGasFallback = await gasFetch(url);
      return viaGasFallback.content || '';
    } catch (gasErr) {
      return '';
    }
  }
}

function isUrl(s) {
  return s && typeof s === 'string' && (s.startsWith('http://') || s.startsWith('https://'));
}

async function fetchWithTimeout(url, ms) {
  var controller = new AbortController();
  var id = setTimeout(function () { controller.abort(); }, ms);
  try {
    var r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    clearTimeout(id);
    var t = await r.text();
    if (t.includes('Just a moment') || t.includes('challenges.cloudflare')) {
      var g = await gasFetch(url);
      return g.content || '';
    }
    return t;
  } catch (e) {
    clearTimeout(id);
    try {
      var fallbackG = await gasFetch(url);
      return fallbackG.content || '';
    } catch (err) {
      return '';
    }
  }
}

function rewriteM3u8(content, sourceUrl) {
  if (!sourceUrl || !isUrl(sourceUrl)) return content;
  var base = sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1);
  if (!isUrl(base)) return content;

  var linesArr = content.split('\n');
  var result = [];

  for (var k = 0; k < linesArr.length; k++) {
    var t = linesArr[k].trim();
    if (!t || t.startsWith('#')) { 
      result.push(linesArr[k]); 
      continue; 
    }
    // Don't re-proxy if link already contains proxy call
    if (t.includes('/api/proxy?url=')) {
      result.push(t);
      continue;
    }
    try {
      var absolute = isUrl(t) ? t : new URL(t, base).href;
      result.push('/api/proxy?url=' + encodeURIComponent(absolute));
    } catch (e) {
      result.push(linesArr[k]);
    }
  }
  return result.join('\n').trim();
}

async function fetchM3u8Content(m3u8Url) {
  var output = await fetchWithTimeout(m3u8Url, 3500);
  if (!output) return null;
  var resolvedUrl = m3u8Url;
  var depth = 0;

  while (output.indexOf('#EXTM3U') === -1 && depth < 3) {
    var bareUrl = output.trim();
    if (!isUrl(bareUrl)) break;
    output = await fetchWithTimeout(bareUrl, 3500);
    if (!output) break;
    resolvedUrl = bareUrl;
    depth++;
  }

  if (output.indexOf('#EXTM3U') !== -1) {
    return rewriteM3u8(output, resolvedUrl);
  }

  if (isUrl(output.trim())) {
    var singleUrl = output.trim();
    if (singleUrl.includes('/api/proxy?url=')) return '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1920x1080\n' + singleUrl;
    return '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1920x1080\n/api/proxy?url=' + encodeURIComponent(singleUrl);
  }
  return null;
}

async function tryGetM3u8FromPlaylist(playlistUrl) {
  try {
    var plText = await fetchWithTimeout(playlistUrl, 3500);
    if (!plText) return null;
    var plData = JSON.parse(plText);
    var sources = plData.playlist && plData.playlist[0] ? plData.playlist[0].sources : [];
    for (var i = 0; i < sources.length; i++) {
      var file = sources[i].file;
      if (file && file.indexOf('/error') === -1 && isUrl(file)) {
        return file;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  var tmdbId = req.query.tmdbId;
  var type = req.query.type;
  var season = req.query.season || '1';
  var episode = req.query.episode || '1';

  if (!tmdbId || !type) {
    return res.status(400).json({ error: 'Missing required parameters: tmdbId or type' });
  }

  try {
    var xpassUrl = type === 'tv'
      ? 'https://play.xpass.top/e/tv/' + tmdbId + '/' + season + '/' + episode + '?autostart=true'
      : 'https://play.xpass.top/e/movie/' + tmdbId + '?autostart=true';

    var html = await smartFetch(xpassUrl);
    if (!html) {
      return res.status(502).json({ error: 'Failed to retrieve source page content.' });
    }

    var match = html.match(/"playlist":"([^"]+)"/);
    if (!match) {
      return res.status(404).json({ error: 'No playlist found on xpass provider.' });
    }

    var primaryPlaylistUrl = 'https://play.xpass.top' + match[1];

    var backupPlaylistUrls = [];
    var backupRegex = /"url":"([^"]+)"/g;
    var bMatch;
    while ((bMatch = backupRegex.exec(html)) !== null) {
      var url = bMatch[1];
      if (url.indexOf('/playlist.json') !== -1 && url.indexOf('/mdata/') !== -1) {
        backupPlaylistUrls.push('https://play.xpass.top' + url);
      }
    }

    var primaryM3u8 = await tryGetM3u8FromPlaylist(primaryPlaylistUrl);
    var result = null;

    if (primaryM3u8) {
      result = await fetchM3u8Content(primaryM3u8);
      if (result) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'public, s-maxage=30, max-age=0');
        res.setHeader('X-Source', 'vip.1x2.space');
        return res.status(200).send(result);
      }
    }

    var backupM3u8Candidates = await Promise.all(backupPlaylistUrls.map(tryGetM3u8FromPlaylist));
    var backupM3u8Urls = backupM3u8Candidates.filter(Boolean);

    if (backupM3u8Urls.length > 0) {
      backupM3u8Urls = backupM3u8Urls.filter(function (u, i) { return backupM3u8Urls.indexOf(u) === i; });
      var backupResults = await Promise.all(backupM3u8Urls.map(fetchM3u8Content));
      var validBackups = backupResults.filter(Boolean);

      if (validBackups.length > 0) {
        var sourceLabel = 'backup-cdn';
        try {
          var domainMatch = backupM3u8Urls[0].match(/https?:\/\/([^\/]+)/);
          if (domainMatch) sourceLabel = domainMatch[1];
        } catch (e) {}

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'public, s-maxage=30, max-age=0');
        res.setHeader('X-Source', sourceLabel);
        return res.status(200).send(validBackups[0]);
      }
    }

    return res.status(404).send('// stream-unavailable');
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error', stack: err.stack });
  }
}
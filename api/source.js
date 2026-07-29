var GAS_URL = 'https://script.google.com/macros/s/AKfycbwLLoqYeMjV3eERrQ5NXJyJmr4ZhWHwJqwcbOVuF5yy_lwHy77leaFbDrS9GyWt-5pp/exec';

function gasFetch(url) {
  return fetch(GAS_URL + '?action=fetch_url&url=' + encodeURIComponent(url))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.error) throw new Error(d.error);
      return d;
    });
}

async function smartFetch(url) {
  var direct = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  var text = await direct.text();
  if (text.includes('Just a moment') || text.includes('challenges.cloudflare')) {
    var viaGas = await gasFetch(url);
    return viaGas.content;
  }
  return text;
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
    return res.status(400).json({ error: 'Missing tmdbId or type' });
  }

  try {
    var xpassUrl = type === 'tv'
      ? 'https://play.xpass.top/e/tv/' + tmdbId + '/' + season + '/' + episode + '?autostart=true'
      : 'https://play.xpass.top/e/movie/' + tmdbId + '?autostart=true';

    var html = await smartFetch(xpassUrl);

    var match = html.match(/"playlist":"([^"]+)"/);
    if (!match) {
      return res.status(404).json({ error: 'No playlist found in xpass page' });
    }

    var playlistUrl = 'https://play.xpass.top' + match[1];

    var plText = await smartFetch(playlistUrl);
    var plData = JSON.parse(plText);

    var m3u8Url = plData.playlist?.[0]?.sources?.[0]?.file;
    if (!m3u8Url) {
      return res.status(404).json({ error: 'No m3u8 URL in playlist' });
    }

    var m3u8Content;
    var m3u8Direct = await fetch(m3u8Url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    m3u8Content = await m3u8Direct.text();
    if (m3u8Content.includes('Just a moment') || m3u8Content.includes('challenges.cloudflare')) {
      var m3u8ViaGas = await gasFetch(m3u8Url);
      m3u8Content = m3u8ViaGas.content;
    }

    var baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    var lines = m3u8Content.split('\n');
    var rewritten = lines.map(function (line) {
      var trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      var absUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : new URL(trimmed, baseUrl).href;
      return '/api/proxy?url=' + encodeURIComponent(absUrl);
    });
    var output = rewritten.join('\n').trim();

    if (output.indexOf('#EXTM3U') === -1 && output.length > 0) {
      output = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1920x1080\n' + output;
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(output);
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

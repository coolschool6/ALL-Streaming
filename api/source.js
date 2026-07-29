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

    var htmlRes = await fetch(xpassUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    var html = await htmlRes.text();

    var match = html.match(/"playlist":"([^"]+)"/);
    if (!match) {
      return res.status(404).json({ error: 'No playlist found in xpass page' });
    }

    var playlistUrl = 'https://play.xpass.top' + match[1];

    var plRes = await fetch(playlistUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    var plData = await plRes.json();

    var m3u8Url = plData.playlist?.[0]?.sources?.[0]?.file;
    if (!m3u8Url) {
      return res.status(404).json({ error: 'No m3u8 URL in playlist' });
    }

    var m3u8Res = await fetch(m3u8Url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    var m3u8Content = await m3u8Res.text();

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

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(rewritten.join('\n'));
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

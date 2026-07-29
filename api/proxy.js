export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') return res.status(200).end();

  var rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing url param' });

  try {
    var targetUrl = decodeURIComponent(rawUrl);

    var proxyRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://play.xpass.top/',
        'Origin': 'https://play.xpass.top'
      }
    });

    var contentType = proxyRes.headers.get('content-type') || '';

    if (contentType.includes('mpegurl') || contentType.includes('m3u8') || targetUrl.includes('.m3u8')) {
      var text = await proxyRes.text();

      if (text.includes('Just a moment') || text.includes('challenges.cloudflare')) {
        var GAS_URL = 'https://script.google.com/macros/s/AKfycbwLLoqYeMjV3eERrQ5NXJyJmr4ZhWHwJqwcbOVuF5yy_lwHy77leaFbDrS9GyWt-5pp/exec';
        var gasRes = await fetch(GAS_URL + '?action=fetch_url&url=' + encodeURIComponent(targetUrl));
        var gasData = await gasRes.json();
        if (!gasData.error) {
          text = gasData.content;
          contentType = gasData.contentType || contentType;
        }
      }

      var baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      var lines = text.split('\n');
      var rewritten = lines.map(function (line) {
        var trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        var absUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://')
          ? trimmed
          : new URL(trimmed, baseUrl).href;
        return '/api/proxy?url=' + encodeURIComponent(absUrl);
      });
      res.setHeader('Content-Type', contentType || 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).send(rewritten.join('\n'));
    }

    var buffer = Buffer.from(await proxyRes.arrayBuffer());
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

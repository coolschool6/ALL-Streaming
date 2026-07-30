var GAS_URL = 'https://script.google.com/macros/s/AKfycbwLLoqYeMjV3eERrQ5NXJyJmr4ZhWHwJqwcbOVuF5yy_lwHy77leaFbDrS9GyWt-5pp/exec';

function isCloudflare(body) {
  return body.indexOf('Just a moment') !== -1 || body.indexOf('challenges.cloudflare') !== -1 || body.indexOf('cf-browser-verification') !== -1;
}

async function tryGas(url) {
  var r = await fetch(GAS_URL + '?action=fetch_binary&url=' + encodeURIComponent(url));
  var d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') return res.status(200).end();

  var rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing url param' });

  try {
    var targetUrl = decodeURIComponent(rawUrl);
    var rangeHeader = req.headers['range'] || '';

    var fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    };

    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    if (targetUrl.indexOf('.m3u8') === -1) {
      // segments — use browser-like headers, no custom Referer/Origin
      if (req.headers['referer']) {
        fetchHeaders['Referer'] = req.headers['referer'];
      }
    } else {
      fetchHeaders['Referer'] = 'https://play.xpass.top/';
      fetchHeaders['Origin'] = 'https://play.xpass.top';
    }

    var proxyRes = await fetch(targetUrl, { headers: fetchHeaders });

    var contentType = proxyRes.headers.get('content-type') || '';

    var isM3u8 = contentType.includes('mpegurl') || contentType.includes('m3u8') || targetUrl.includes('.m3u8');

    if (isM3u8) {
      var text = await proxyRes.text();

      if (isCloudflare(text)) {
        var gasData;
        try {
          gasData = await tryGas(targetUrl);
          text = gasData.content;
          contentType = gasData.contentType || contentType;
        } catch (e) {}
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

    // binary segment
    var buffer = Buffer.from(await proxyRes.arrayBuffer());

    // Cloudflare check for segments
    if (contentType.includes('text/html') && buffer.length > 0) {
      var head = buffer.slice(0, 100).toString();
      if (isCloudflare(head) || head.indexOf('<script') !== -1) {
        try {
          var gasData2 = await tryGas(targetUrl);
          if (gasData2.content && gasData2.content.length > 0) {
            buffer = Buffer.from(gasData2.content, 'base64');
            contentType = gasData2.contentType || contentType;
          }
        } catch (e) {}
      } else if (!head.match(/^<(html|!DOCTYPE|!doctype)/i)) {
        contentType = 'video/MP2T';
      }
    }

    if (buffer.length === 0) {
      try {
        var gasData3 = await tryGas(targetUrl);
        if (gasData3.content && gasData3.content.length > 0) {
          buffer = Buffer.from(gasData3.content, 'base64');
          contentType = gasData3.contentType || contentType;
        }
      } catch (e) {}
    }

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', buffer.length);
    if (rangeHeader) {
      res.setHeader('Content-Range', 'bytes 0-' + (buffer.length - 1) + '/' + buffer.length);
      return res.status(206).send(buffer);
    }
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

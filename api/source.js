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
    if (!m3u8Url || m3u8Url.indexOf('/error') !== -1 || !m3u8Url.startsWith('http')) {
      return res.status(200).send('// stream-unavailable');
    }

    function isUrl(s) {
      return s.startsWith('http://') || s.startsWith('https://');
    }

    function rewriteM3u8(content, sourceUrl) {
      if (!sourceUrl || !isUrl(sourceUrl)) return content;
      var base = sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1);
      if (!isUrl(base)) return content;
      var linesArr = content.split('\n');
      var result = [];
      for (var k = 0; k < linesArr.length; k++) {
        var t = linesArr[k].trim();
        if (!t || t.startsWith('#')) { result.push(linesArr[k]); continue; }
        try {
          var absolute = isUrl(t) ? t : new URL(t, base).href;
          if (absolute.indexOf('.m3u8') !== -1) {
            result.push('/api/proxy?url=' + encodeURIComponent(absolute));
          } else {
            result.push(absolute);
          }
        } catch (e) {
          result.push(linesArr[k]);
        }
      }
      return result.join('\n').trim();
    }

    var output;
    try {
      var m3u8Gas = await gasFetch(m3u8Url);
      output = m3u8Gas.content || '';
    } catch (e) {
      var m3u8Direct = await fetch(m3u8Url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      output = await m3u8Direct.text();
    }

    var resolvedUrl = m3u8Url;
    var depth = 0;
    while (output.indexOf('#EXTM3U') === -1 && depth < 3) {
      var bareUrl = output.trim();
      if (!isUrl(bareUrl)) break;
      try {
        var gasResp = await gasFetch(bareUrl);
        output = gasResp.content || '';
      } catch (e) {
        break;
      }
      resolvedUrl = bareUrl;
      depth++;
    }

    if (output.indexOf('#EXTM3U') !== -1) {
      output = rewriteM3u8(output, resolvedUrl);
    } else if (isUrl(output.trim())) {
      var singleUrl = output.trim();
      if (singleUrl.indexOf('.m3u8') !== -1) {
        var single = '/api/proxy?url=' + encodeURIComponent(singleUrl);
        output = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1920x1080\n' + single;
      } else {
        output = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1920x1080\n' + singleUrl;
      }
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(output);
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

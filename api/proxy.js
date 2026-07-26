const TARGET = 'https://dulo.tv';

module.exports = async function handler(req, res) {
  const path = req.query.path || '';

  let targetUrl = TARGET + '/' + path;
  if (req.url && req.url.includes('?')) {
    const qs = req.url.split('?')[1];
    if (qs) targetUrl += '?' + qs;
  }

  const forwardHeaders = new Headers();
  const skip = ['host', 'connection', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'vercel-forwarding', 'x-vercel-id'];
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (!skip.includes(lower) && value) {
      forwardHeaders.set(key, Array.isArray(value) ? value[0] : value);
    }
  }
  forwardHeaders.set('Host', 'dulo.tv');
  forwardHeaders.set('Origin', TARGET);
  forwardHeaders.set('Referer', TARGET + '/');

  try {
    const resp = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      redirect: 'follow',
    });

    const contentType = resp.headers.get('content-type') || '';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      res.setHeader('Set-Cookie', cookie);
    }

    if (contentType.includes('text/html')) {
      let html = await resp.text();

      html = html.replace(/<head([^>]*)>/i, '<head$1><base href="/watch/">');

      html = html.replace(/src="\/assets\//g, 'src="/assets/');
      html = html.replace(/href="\/assets\//g, 'href="/assets/');
      html = html.replace(/href="\/favicon/g, 'href="/favicon');
      html = html.replace(/href="\/apple-touch-icon/g, 'href="/apple-touch-icon');
      html = html.replace(/src="\/cdn-cgi\//g, 'src="/cdn-cgi/');

      html = html.replace(/https:\/\/dulo\.tv\/cdn-cgi\/content/g, TARGET + '/cdn-cgi/content');

      html = html.replace(/<title[^>]*>.*?<\/title>/i, '<title>ALLStreaming - Access Gate</title>');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.status(resp.status).send(html);
    }

    const respHeaders = {};
    for (const [key, value] of resp.headers.entries()) {
      const lower = key.toLowerCase();
      if (lower === 'content-type' || lower === 'content-length' || lower === 'cache-control') {
        respHeaders[key] = value;
      }
    }

    const body = Buffer.from(await resp.arrayBuffer());
    return res.status(resp.status).set(respHeaders).send(body);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(502).json({ error: 'proxy_error', message: err.message });
  }
};

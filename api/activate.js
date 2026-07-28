module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var KV_URL = process.env.KV_REST_API_URL;
  var KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured. Run: vercel kv link' });
  }

  var { key, device } = req.body || {};
  if (!key) {
    return res.status(400).json({ error: 'Missing key' });
  }

  var activation = {
    key: key,
    device: device || 'Unknown',
    activatedAt: new Date().toISOString(),
    timestamp: Date.now()
  };

  try {
    // Get existing activations
    var getRes = await fetch(KV_URL + '/get/activations', {
      headers: { 'Authorization': 'Bearer ' + KV_TOKEN }
    });
    var existing = [];
    if (getRes.ok) {
      var getData = await getRes.json();
      if (getData.result) {
        existing = JSON.parse(getData.result);
      }
    }

    // Append new activation
    existing.unshift(activation);

    // Keep only last 200 activations
    if (existing.length > 200) {
      existing = existing.slice(0, 200);
    }

    // Save back
    await fetch(KV_URL + '/set/activations', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + KV_TOKEN,
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(existing)
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to log activation' });
  }
};

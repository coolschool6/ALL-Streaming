module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  var KV_URL = process.env.KV_REST_API_URL;
  var KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured. Run: vercel kv link' });
  }

  try {
    var getRes = await fetch(KV_URL + '/get/activations', {
      headers: { 'Authorization': 'Bearer ' + KV_TOKEN }
    });

    var activations = [];
    if (getRes.ok) {
      var getData = await getRes.json();
      if (getData.result) {
        activations = JSON.parse(getData.result);
      }
    }

    return res.status(200).json(activations);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch activations' });
  }
};

const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'allstreaming-default-secret-change-me';

function getKeys() {
  try {
    return JSON.parse(process.env.ACCESS_KEYS || '[]');
  } catch (e) {
    return [];
  }
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

function calcRemaining(createdAt, validDays) {
  var created = new Date(createdAt + 'T00:00:00Z');
  var expiry = new Date(created);
  expiry.setDate(expiry.getDate() + validDays);
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body;
  if (!body || !body.action) return res.status(400).json({ error: 'Missing action' });

  var keys = getKeys();

  if (body.action === 'validate-key') {
    var inputKey = (body.key || '').trim().toUpperCase();
    var keyObj = null;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].key.toUpperCase() === inputKey) {
        keyObj = keys[i];
        break;
      }
    }
    if (!keyObj) return res.status(401).json({ valid: false, error: 'Invalid key' });

    var remaining = calcRemaining(keyObj.createdAt, keyObj.validDays);
    if (remaining <= 0) return res.status(401).json({ valid: false, error: 'expired' });

    var expiryDate = new Date(keyObj.createdAt + 'T00:00:00Z');
    expiryDate.setDate(expiryDate.getDate() + keyObj.validDays);
    var payload = JSON.stringify({ k: keyObj.key, e: expiryDate.getTime() });
    var signature = sign(payload);
    var token = Buffer.from(payload).toString('base64url') + '.' + signature;

    return res.status(200).json({ valid: true, token: token, remaining: remaining });
  }

  if (body.action === 'verify-token') {
    if (!body.token) return res.status(401).json({ valid: false, error: 'No token' });

    try {
      var parts = body.token.split('.');
      if (parts.length !== 2) throw new Error('bad format');

      var payloadStr = Buffer.from(parts[0], 'base64url').toString();
      var expectedSig = sign(payloadStr);

      if (parts[1] !== expectedSig) return res.status(401).json({ valid: false, error: 'Tampered token' });

      var data = JSON.parse(payloadStr);
      var now = Date.now();
      if (data.e < now) return res.status(401).json({ valid: false, error: 'expired' });

      var rem = Math.ceil((data.e - now) / (1000 * 60 * 60 * 24));
      return res.status(200).json({ valid: true, remaining: rem });
    } catch (e) {
      return res.status(401).json({ valid: false, error: 'Invalid token' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
};

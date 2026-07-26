const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysPath = path.join(__dirname, '..', 'keys.json');
const statePath = path.join(__dirname, '..', 'key-state.json');

const SECRET = process.env.SESSION_SECRET || 'allstreaming-default-secret-change-me';

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function loadKeys() {
  var keys = readJsonFile(keysPath, []);
  return Array.isArray(keys) ? keys : [];
}

function loadState() {
  var state = readJsonFile(statePath, {});
  return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
}

function saveState(state) {
  writeJsonFile(statePath, state);
}

function getActivationDate(keyObj, state) {
  var stored = state[keyObj.key];
  if (stored && stored.activatedAt) {
    return stored.activatedAt;
  }
  if (keyObj.activatedAt) {
    return keyObj.activatedAt;
  }
  return null;
}

function setActivationDate(state, keyObj, activatedAt) {
  state[keyObj.key] = {
    activatedAt: activatedAt,
    validDays: keyObj.validDays
  };
  saveState(state);
}

function calcRemaining(activatedAt, validDays) {
  var created = new Date(activatedAt);
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

  if (body.action === 'validate-key') {
    var inputKey = typeof body.key === 'string' ? body.key : '';
    var keys = loadKeys();
    var state = loadState();
    var keyObj = null;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].key === inputKey) {
        keyObj = keys[i];
        break;
      }
    }
    if (!keyObj) return res.status(401).json({ valid: false, error: 'Invalid key' });

    var validDays = Number(keyObj.validDays);
    if (!Number.isFinite(validDays) || validDays <= 0) {
      return res.status(500).json({ valid: false, error: 'Invalid key configuration' });
    }

    var activatedAt = getActivationDate(keyObj, state);
    if (!activatedAt) {
      activatedAt = new Date().toISOString();
      setActivationDate(state, keyObj, activatedAt);
    }

    var remaining = calcRemaining(activatedAt, validDays);
    if (remaining <= 0) return res.status(401).json({ valid: false, error: 'expired' });

    var expiryDate = new Date(activatedAt);
    expiryDate.setDate(expiryDate.getDate() + validDays);
    var payload = JSON.stringify({ k: keyObj.key, a: activatedAt, d: validDays, e: expiryDate.getTime() });
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

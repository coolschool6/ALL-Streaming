const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysPath = path.join(__dirname, '..', 'keys.json');
const statePath = path.join(__dirname, '..', 'key-state.json');
const SECRET = process.env.SESSION_SECRET || 'allstreaming-default-secret-change-me';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO_OWNER = process.env.REPO_OWNER || 'coolschool6';
const REPO_NAME = process.env.REPO_NAME || 'ALLStreaming';

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

function loadKeys() {
  try {
    var keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    return Array.isArray(keys) ? keys : [];
  } catch (e) {
    return [];
  }
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { return {}; }
}

function saveState(state) {
  try { fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8'); } catch (e) {}
}

async function persistState(state) {
  saveState(state);
  if (!GITHUB_TOKEN) return;
  try {
    var url = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/key-state.json';
    var existing = await fetch(url, { headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'ALLStreaming' } });
    var sha = null;
    if (existing.ok) { var d = await existing.json(); sha = d.sha; }
    var res = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json', 'User-Agent': 'ALLStreaming' },
      body: JSON.stringify({ message: 'Update key activation state', content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'), sha: sha, branch: 'main' })
    });
  } catch (e) {}
}

function findKey(inputKey) {
  var keys = loadKeys();
  var normalised = inputKey.trim().toUpperCase();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].key.toUpperCase() === normalised) {
      return keys[i];
    }
  }
  return null;
}

function calcRemaining(activatedAt, validDays) {
  var expiry = new Date(activatedAt);
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
    var keyObj = findKey(inputKey);

    if (!keyObj) return res.status(401).json({ valid: false, error: 'Invalid key' });

    var validDays = Number(keyObj.validDays);
    if (!Number.isFinite(validDays) || validDays <= 0) {
      return res.status(500).json({ valid: false, error: 'Invalid key configuration' });
    }

    var state = loadState();
    var keyState = state[keyObj.key];
    var activatedAt;
    if (keyState && keyState.activatedAt) {
      activatedAt = keyState.activatedAt;
    } else {
      activatedAt = new Date().toISOString();
      state[keyObj.key] = { activatedAt: activatedAt };
      persistState(state);
    }

    var expiryMs = new Date(activatedAt).getTime() + validDays * 86400000;
    var remaining = calcRemaining(activatedAt, validDays);
    if (remaining <= 0) return res.status(401).json({ valid: false, error: 'expired' });

    var payload = JSON.stringify({ k: keyObj.key, a: activatedAt, d: validDays, e: expiryMs });
    var signature = sign(payload);
    var token = Buffer.from(payload).toString('base64url') + '.' + signature;

    return res.status(200).json({
      valid: true,
      token: token,
      remaining: remaining,
      activatedAt: activatedAt,
      expiresAt: new Date(expiryMs).toISOString()
    });
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

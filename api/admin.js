const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysPath = path.join(__dirname, '..', 'keys.json');
const SECRET = process.env.SESSION_SECRET || 'allstreaming-default-secret-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
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

function saveKeysToMemory(keys) {
  try {
    fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2) + '\n', 'utf8');
  } catch (e) {}
}

async function githubReadFile(filePath) {
  if (!GITHUB_TOKEN) return null;
  var url = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + filePath;
  var res = await fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + GITHUB_TOKEN,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ALLStreaming-Admin'
    }
  });
  if (!res.ok) return null;
  return await res.json();
}

async function githubWriteFile(filePath, content, sha, message) {
  if (!GITHUB_TOKEN) return false;
  var url = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + filePath;
  var body = {
    message: message,
    content: Buffer.from(content).toString('base64'),
    sha: sha,
    branch: 'main'
  };
  var res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + GITHUB_TOKEN,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ALLStreaming-Admin'
    },
    body: JSON.stringify(body)
  });
  return res.ok;
}

async function persistKeys(keys) {
  saveKeysToMemory(keys);
  if (!GITHUB_TOKEN) return true;
  try {
    var fileData = await githubReadFile('keys.json');
    var sha = fileData ? fileData.sha : null;
    var content = JSON.stringify(keys, null, 2) + '\n';
    return await githubWriteFile('keys.json', content, sha, 'Update keys via admin panel');
  } catch (e) {
    return true;
  }
}

function findKey(keys, name) {
  var normalised = name.trim().toUpperCase();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].key.toUpperCase() === normalised) return keys[i];
  }
  return null;
}

function getKeyDurationMs(keyObj) {
  var days = Number(keyObj.validDays) || 0;
  var mins = Number(keyObj.validMinutes) || 0;
  return days * 86400000 + mins * 60000;
}

function getKeyDurationLabel(keyObj) {
  var days = Number(keyObj.validDays) || 0;
  var mins = Number(keyObj.validMinutes) || 0;
  if (days > 0 && mins > 0) return days + 'd ' + mins + 'm';
  if (days > 0) return days + 'd';
  if (mins > 0) return mins + 'm';
  return '?';
}

function createAdminToken() {
  var payload = JSON.stringify({ admin: true, iat: Date.now() });
  var signature = sign(payload);
  return Buffer.from(payload).toString('base64url') + '.' + signature;
}

function verifyAdminToken(token) {
  try {
    var parts = token.split('.');
    if (parts.length !== 2) return false;
    var payloadStr = Buffer.from(parts[0], 'base64url').toString();
    var expectedSig = sign(payloadStr);
    if (parts[1] !== expectedSig) return false;
    var data = JSON.parse(payloadStr);
    return data.admin === true;
  } catch (e) {
    return false;
  }
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body;
  if (!body || !body.action) return res.status(400).json({ error: 'Missing action' });

  if (body.action === 'admin-login') {
    if (body.password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    var token = createAdminToken();
    return res.status(200).json({ valid: true, token: token });
  }

  var adminToken = req.headers['x-admin-token'];
  if (!adminToken || !verifyAdminToken(adminToken)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (body.action === 'admin-check') {
    return res.status(200).json({ valid: true });
  }

  if (body.action === 'admin-list') {
    var keys = loadKeys();
    var statePath = path.join(__dirname, '..', 'key-state.json');
    var state = {};
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}

    var enriched = keys.map(function (k) {
      var durationMs = getKeyDurationMs(k);
      var result = {
        key: k.key,
        validDays: k.validDays || 0,
        validMinutes: k.validMinutes || 0,
        durationLabel: getKeyDurationLabel(k),
        userNote: k.userNote || '',
        disabled: !!k.disabled
      };
      var s = state[k.key];
      if (s && s.activatedAt) {
        result.activatedAt = s.activatedAt;
        var expiryMs = new Date(s.activatedAt).getTime() + durationMs;
        result.expiresAt = expiryMs;
        result.remainingMs = expiryMs - Date.now();
      }
      return result;
    });
    return res.status(200).json({ keys: enriched });
  }

  if (body.action === 'admin-check-key') {
    var inputKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!inputKey) return res.status(400).json({ error: 'Key name required' });

    var keys = loadKeys();
    var keyObj = findKey(keys, inputKey);
    if (!keyObj) return res.status(200).json({ valid: false, error: 'Key not found in keys.json' });
    if (keyObj.disabled) return res.status(200).json({ valid: false, error: 'Key is disabled' });

    var durationMs = getKeyDurationMs(keyObj);
    if (durationMs <= 0) {
      return res.status(200).json({ valid: false, error: 'Invalid key configuration' });
    }

    var statePath = path.join(__dirname, '..', 'key-state.json');
    var state = {};
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}

    var keyState = state[keyObj.key];
    if (keyState && keyState.activatedAt) {
      var expiryMs = new Date(keyState.activatedAt).getTime() + durationMs;
      var remainingMs = expiryMs - Date.now();
      if (remainingMs <= 0) {
        return res.status(200).json({ valid: false, error: 'expired', activatedAt: keyState.activatedAt, expiresAt: expiryMs });
      }
      return res.status(200).json({
        valid: true,
        activatedAt: keyState.activatedAt,
        expiresAt: expiryMs,
        remainingMs: remainingMs,
        durationLabel: getKeyDurationLabel(keyObj)
      });
    }

    var now = new Date().toISOString();
    var expiryMs = new Date(now).getTime() + durationMs;
    return res.status(200).json({
      valid: true,
      activatedAt: null,
      expiresAt: expiryMs,
      remainingMs: durationMs,
      durationLabel: getKeyDurationLabel(keyObj),
      note: 'Not yet activated by any user'
    });
  }

  if (body.action === 'admin-add') {
    var newKey = typeof body.key === 'string' ? body.key.trim() : '';
    var newDays = Number(body.validDays);
    var newNote = typeof body.userNote === 'string' ? body.userNote.trim() : '';

    if (!newKey) return res.status(400).json({ error: 'Key name required' });
    if (!Number.isFinite(newDays) || newDays <= 0) return res.status(400).json({ error: 'Valid days required' });

    var addKeys = loadKeys();
    if (findKey(addKeys, newKey)) {
      return res.status(409).json({ error: 'Key already exists' });
    }

    addKeys.push({ key: newKey, validDays: newDays, userNote: newNote });
    await persistKeys(addKeys);
    return res.status(200).json({ success: true });
  }

  if (body.action === 'admin-disable') {
    var disableKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!disableKey) return res.status(400).json({ error: 'Key name required' });

    var disableKeys = loadKeys();
    var keyToDisable = findKey(disableKeys, disableKey);
    if (!keyToDisable) return res.status(404).json({ error: 'Key not found' });

    keyToDisable.disabled = true;
    await persistKeys(disableKeys);
    return res.status(200).json({ success: true });
  }

  if (body.action === 'admin-enable') {
    var enableKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!enableKey) return res.status(400).json({ error: 'Key name required' });

    var enableKeys = loadKeys();
    var keyToEnable = findKey(enableKeys, enableKey);
    if (!keyToEnable) return res.status(404).json({ error: 'Key not found' });

    delete keyToEnable.disabled;
    await persistKeys(enableKeys);
    return res.status(200).json({ success: true });
  }

  if (body.action === 'admin-delete') {
    var deleteKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!deleteKey) return res.status(400).json({ error: 'Key name required' });

    var deleteKeys = loadKeys();
    var normalisedDelete = deleteKey.toUpperCase();
    var found = false;
    var newKeysList = [];
    for (var i = 0; i < deleteKeys.length; i++) {
      if (deleteKeys[i].key.toUpperCase() === normalisedDelete) {
        found = true;
      } else {
        newKeysList.push(deleteKeys[i]);
      }
    }
    if (!found) return res.status(404).json({ error: 'Key not found' });

    await persistKeys(newKeysList);
    return res.status(200).json({ success: true });
  }

  if (body.action === 'admin-extend') {
    var extendKey = typeof body.key === 'string' ? body.key.trim() : '';
    var addDays = Number(body.addDays);
    if (!extendKey) return res.status(400).json({ error: 'Key name required' });
    if (!Number.isFinite(addDays) || addDays <= 0) return res.status(400).json({ error: 'Days to add required' });

    var extendKeys = loadKeys();
    var keyToExtend = findKey(extendKeys, extendKey);
    if (!keyToExtend) return res.status(404).json({ error: 'Key not found' });

    keyToExtend.validDays = Number(keyToExtend.validDays) + addDays;
    await persistKeys(extendKeys);
    return res.status(200).json({ success: true, newDays: keyToExtend.validDays });
  }

  return res.status(400).json({ error: 'Unknown action' });
};

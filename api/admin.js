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
    var enriched = keys.map(function (k) {
      var result = { key: k.key, validDays: k.validDays, userNote: k.userNote || '', disabled: !!k.disabled };
      if (!k.disabled && k._token) {
        result._token = k._token;
      }
      return result;
    });
    return res.status(200).json({ keys: enriched });
  }

  if (body.action === 'admin-add') {
    var newKey = typeof body.key === 'string' ? body.key.trim() : '';
    var newDays = Number(body.validDays);
    var newNote = typeof body.userNote === 'string' ? body.userNote.trim() : '';

    if (!newKey) return res.status(400).json({ error: 'Key name required' });
    if (!Number.isFinite(newDays) || newDays <= 0) return res.status(400).json({ error: 'Valid days required' });

    var addKeys = loadKeys();
    for (var i = 0; i < addKeys.length; i++) {
      if (addKeys[i].key.toUpperCase() === newKey.toUpperCase()) {
        return res.status(409).json({ error: 'Key already exists' });
      }
    }

    addKeys.push({ key: newKey, validDays: newDays, userNote: newNote });
    await persistKeys(addKeys);
    return res.status(200).json({ success: true });
  }

  if (body.action === 'admin-disable') {
    var disableKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!disableKey) return res.status(400).json({ error: 'Key name required' });

    var disableKeys = loadKeys();
    var found = false;
    for (var i = 0; i < disableKeys.length; i++) {
      if (disableKeys[i].key.toUpperCase() === disableKey.toUpperCase()) {
        disableKeys[i].disabled = true;
        found = true;
        break;
      }
    }
    if (!found) return res.status(404).json({ error: 'Key not found' });

    await persistKeys(disableKeys);
    return res.status(200).json({ success: true });
  }

  if (body.action === 'admin-enable') {
    var enableKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!enableKey) return res.status(400).json({ error: 'Key name required' });

    var enableKeys = loadKeys();
    var found = false;
    for (var i = 0; i < enableKeys.length; i++) {
      if (enableKeys[i].key.toUpperCase() === enableKey.toUpperCase()) {
        delete enableKeys[i].disabled;
        found = true;
        break;
      }
    }
    if (!found) return res.status(404).json({ error: 'Key not found' });

    await persistKeys(enableKeys);
    return res.status(200).json({ success: true });
  }

  if (body.action === 'admin-delete') {
    var deleteKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!deleteKey) return res.status(400).json({ error: 'Key name required' });

    var deleteKeys = loadKeys();
    var found = false;
    var newKeysList = [];
    for (var i = 0; i < deleteKeys.length; i++) {
      if (deleteKeys[i].key.toUpperCase() === deleteKey.toUpperCase()) {
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
    var found = false;
    for (var i = 0; i < extendKeys.length; i++) {
      if (extendKeys[i].key.toUpperCase() === extendKey.toUpperCase()) {
        extendKeys[i].validDays = Number(extendKeys[i].validDays) + addDays;
        found = true;
        break;
      }
    }
    if (!found) return res.status(404).json({ error: 'Key not found' });

    await persistKeys(extendKeys);
    return res.status(200).json({ success: true, newDays: extendKeys[i].validDays });
  }

  return res.status(400).json({ error: 'Unknown action' });
};

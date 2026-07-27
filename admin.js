(function () {
  'use strict';

  var ADMIN_TOKEN_KEY = 'ak_admin_token';
  var API_URL = '/api/admin';

  var loginView = document.getElementById('login-view');
  var dashboardView = document.getElementById('dashboard-view');
  var loginForm = document.getElementById('login-form');
  var loginError = document.getElementById('login-error');
  var keysTbody = document.getElementById('keys-tbody');
  var keysLoading = document.getElementById('keys-loading');
  var keysTableWrap = document.getElementById('keys-table-wrap');
  var keysEmpty = document.getElementById('keys-empty');

  function showView(view) {
    loginView.classList.remove('active');
    dashboardView.classList.remove('active');
    view.classList.add('active');
  }

  function showError(el, text) {
    el.textContent = text;
    el.classList.add('visible');
  }

  function hideError(el) {
    el.textContent = '';
    el.classList.remove('visible');
  }

  function showStatus(el, text) {
    el.textContent = text;
    el.classList.add('visible');
  }

  function hideStatus(el) {
    el.textContent = '';
    el.classList.remove('visible');
  }

  function getAdminToken() {
    try { return localStorage.getItem(ADMIN_TOKEN_KEY) || null; } catch (e) { return null; }
  }

  function saveAdminToken(token) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  }

  function clearAdminToken() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }

  async function apiCall(body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getAdminToken();
    if (token) headers['X-Admin-Token'] = token;

    var res = await fetch(API_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  }

  var currentKeys = [];

  function getKeyStatus(keyObj) {
    if (keyObj.disabled) return 'disabled';
    var token = keyObj._token;
    if (!token) return 'unused';
    try {
      var parts = token.split('.');
      if (parts.length !== 2) return 'unknown';
      var payloadStr = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
      var data = JSON.parse(payloadStr);
      if (data.e < Date.now()) return 'expired';
      var days = Math.ceil((data.e - Date.now()) / 86400000);
      return 'active (' + days + 'd left)';
    } catch (e) {
      return 'unknown';
    }
  }

  function renderKeys(keys) {
    currentKeys = keys;
    keysLoading.style.display = 'none';

    if (!keys || keys.length === 0) {
      keysTableWrap.style.display = 'none';
      keysEmpty.style.display = 'block';
      updateStats(keys || []);
      return;
    }

    keysEmpty.style.display = 'none';
    keysTableWrap.style.display = 'block';
    keysTbody.innerHTML = '';

    var total = keys.length;
    var active = 0;
    var expired = 0;
    var disabled = 0;

    keys.forEach(function (k) {
      var tr = document.createElement('tr');
      if (k.disabled) tr.className = 'row-disabled';

      var status = getKeyStatus(k);
      var statusClass = 'status-unused';
      if (k.disabled) { statusClass = 'status-disabled'; disabled++; }
      else if (status.indexOf('active') === 0) { statusClass = 'status-active'; active++; }
      else if (status === 'expired') { statusClass = 'status-expired'; expired++; }
      else if (status === 'unused') { statusClass = 'status-unused'; }

      tr.innerHTML =
        '<td class="key-name">' + escHtml(k.key) + '</td>' +
        '<td>' + k.validDays + '</td>' +
        '<td class="key-note">' + escHtml(k.userNote || '-') + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + escHtml(status) + '</span></td>' +
        '<td class="actions">' +
          (k.disabled
            ? '<button class="btn-sm btn-enable" data-key="' + escAttr(k.key) + '">Enable</button>'
            : '<button class="btn-sm btn-disable" data-key="' + escAttr(k.key) + '">Disable</button>'
          ) +
          '<button class="btn-sm btn-danger" data-key="' + escAttr(k.key) + '" data-action="delete">Delete</button>' +
        '</td>';

      keysTbody.appendChild(tr);
    });

    updateStats(keys);
  }

  function updateStats(keys) {
    var total = keys.length;
    var active = 0;
    var expired = 0;
    var disabled = 0;

    keys.forEach(function (k) {
      if (k.disabled) { disabled++; return; }
      var s = getKeyStatus(k);
      if (s.indexOf('active') === 0) active++;
      else if (s === 'expired') expired++;
    });

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-expired').textContent = expired;
    document.getElementById('stat-disabled').textContent = disabled;
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function loadKeys() {
    keysLoading.style.display = 'block';
    keysTableWrap.style.display = 'none';
    keysEmpty.style.display = 'none';
    try {
      var result = await apiCall({ action: 'admin-list' });
      renderKeys(result.keys || []);
    } catch (e) {
      keysLoading.textContent = 'Failed to load keys: ' + e.message;
    }
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideError(loginError);
    var pw = document.getElementById('admin-password').value;
    if (!pw) return;

    try {
      var result = await apiCall({ action: 'admin-login', password: pw });
      saveAdminToken(result.token);
      showView(dashboardView);
      loadKeys();
    } catch (e) {
      showError(loginError, 'Wrong password.');
      document.getElementById('admin-password').value = '';
      document.getElementById('admin-password').focus();
    }
  });

  document.getElementById('add-key-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = document.getElementById('add-key-msg');
    hideStatus(msg);
    hideError(loginError);

    var name = document.getElementById('new-key-name').value.trim();
    var days = parseInt(document.getElementById('new-key-days').value, 10);
    var note = document.getElementById('new-key-note').value.trim();

    if (!name || !days || days <= 0) {
      showError(loginError, 'Enter a key name and valid days.');
      return;
    }

    try {
      await apiCall({ action: 'admin-add', key: name, validDays: days, userNote: note });
      showStatus(msg, 'Key "' + name + '" added. Deploying...');
      document.getElementById('new-key-name').value = '';
      document.getElementById('new-key-days').value = '';
      document.getElementById('new-key-note').value = '';
      setTimeout(loadKeys, 3000);
    } catch (e) {
      showError(loginError, 'Failed: ' + e.message);
    }
  });

  document.getElementById('extend-key-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = document.getElementById('extend-key-msg');
    hideStatus(msg);
    hideError(loginError);

    var name = document.getElementById('extend-key-name').value.trim();
    var days = parseInt(document.getElementById('extend-key-days').value, 10);

    if (!name || !days || days <= 0) {
      showError(loginError, 'Enter a key name and days to add.');
      return;
    }

    try {
      await apiCall({ action: 'admin-extend', key: name, addDays: days });
      showStatus(msg, 'Extended "' + name + '" by ' + days + ' days. Deploying...');
      document.getElementById('extend-key-name').value = '';
      document.getElementById('extend-key-days').value = '';
      setTimeout(loadKeys, 3000);
    } catch (e) {
      showError(loginError, 'Failed: ' + e.message);
    }
  });

  keysTbody.addEventListener('click', async function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var keyName = btn.dataset.key;
    var action = btn.dataset.action || (btn.classList.contains('btn-disable') ? 'disable' : btn.classList.contains('btn-enable') ? 'enable' : null);

    if (!action || !keyName) return;

    if (action === 'delete' && !confirm('Delete key "' + keyName + '"? This cannot be undone.')) return;
    if (action === 'disable' && !confirm('Disable key "' + keyName + '"?')) return;

    btn.disabled = true;
    btn.textContent = '...';

    try {
      await apiCall({ action: 'admin-' + action, key: keyName });
      setTimeout(loadKeys, 2000);
    } catch (e) {
      alert('Failed: ' + e.message);
      btn.disabled = false;
      btn.textContent = action === 'disable' ? 'Disable' : action === 'enable' ? 'Enable' : 'Delete';
    }
  });

  document.getElementById('btn-refresh').addEventListener('click', loadKeys);

  document.getElementById('btn-logout').addEventListener('click', function () {
    clearAdminToken();
    showView(loginView);
    document.getElementById('admin-password').value = '';
  });

  async function init() {
    var token = getAdminToken();
    if (token) {
      try {
        var result = await apiCall({ action: 'admin-check' });
        if (result.valid) {
          showView(dashboardView);
          loadKeys();
          return;
        }
      } catch (e) {
        clearAdminToken();
      }
    }
    showView(loginView);
  }

  init();
})();

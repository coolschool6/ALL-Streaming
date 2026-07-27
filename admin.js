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

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderKeys(keys) {
    keysLoading.style.display = 'none';

    if (!keys || keys.length === 0) {
      keysTableWrap.style.display = 'none';
      keysEmpty.style.display = 'block';
      document.getElementById('stat-total').textContent = '0';
      document.getElementById('stat-active').textContent = '0';
      document.getElementById('stat-expired').textContent = '0';
      document.getElementById('stat-disabled').textContent = '0';
      return;
    }

    keysEmpty.style.display = 'none';
    keysTableWrap.style.display = 'block';
    keysTbody.innerHTML = '';

    var total = keys.length;
    var activeCount = 0;
    var expiredCount = 0;
    var disabledCount = 0;

    keys.forEach(function (k) {
      var tr = document.createElement('tr');
      if (k.disabled) tr.className = 'row-disabled';

      var statusText, statusClass;
      if (k.disabled) {
        statusText = 'Disabled';
        statusClass = 'status-disabled';
        disabledCount++;
      } else if (k.activatedAt) {
        var remaining = Math.ceil((k.expiresAt - Date.now()) / 86400000);
        if (remaining <= 0) {
          statusText = 'Expired';
          statusClass = 'status-expired';
          expiredCount++;
        } else {
          statusText = 'Active (' + remaining + 'd left)';
          statusClass = 'status-active';
          activeCount++;
        }
      } else {
        statusText = 'Available';
        statusClass = 'status-unused';
      }

      var note = k.userNote || '-';
      var activatedStr = k.activatedAt ? new Date(k.activatedAt).toLocaleDateString() : '-';
      var expiresStr = k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '-';

      tr.innerHTML =
        '<td class="key-name">' + escHtml(k.key) + '</td>' +
        '<td>' + k.validDays + 'd</td>' +
        '<td class="key-note">' + escHtml(note) + '</td>' +
        '<td>' + activatedStr + '</td>' +
        '<td>' + expiresStr + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>' +
        '<td class="actions">' +
          (k.disabled
            ? '<button class="btn-sm btn-enable" data-key="' + escAttr(k.key) + '">Enable</button>'
            : '<button class="btn-sm btn-disable" data-key="' + escAttr(k.key) + '">Disable</button>'
          ) +
          '<button class="btn-sm btn-danger" data-key="' + escAttr(k.key) + '" data-action="delete">Delete</button>' +
        '</td>';

      keysTbody.appendChild(tr);
    });

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-active').textContent = activeCount;
    document.getElementById('stat-expired').textContent = expiredCount;
    document.getElementById('stat-disabled').textContent = disabledCount;
  }

  async function loadKeys() {
    keysLoading.style.display = 'block';
    keysLoading.textContent = 'Loading keys...';
    keysTableWrap.style.display = 'none';
    keysEmpty.style.display = 'none';
    try {
      var result = await apiCall({ action: 'admin-list' });
      renderKeys(result.keys || []);
    } catch (e) {
      try {
        var res = await fetch('keys.json', { cache: 'no-store' });
        var keys = await res.json();
        renderKeys(Array.isArray(keys) ? keys : []);
      } catch (e2) {
        keysLoading.textContent = 'Failed to load keys: ' + e.message;
      }
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
      showStatus(msg, 'Key "' + name + '" added.');
      document.getElementById('new-key-name').value = '';
      document.getElementById('new-key-days').value = '';
      document.getElementById('new-key-note').value = '';
      setTimeout(loadKeys, 1500);
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
      showStatus(msg, 'Extended "' + name + '" by ' + days + ' days.');
      document.getElementById('extend-key-name').value = '';
      document.getElementById('extend-key-days').value = '';
      setTimeout(loadKeys, 1500);
    } catch (e) {
      showError(loginError, 'Failed: ' + e.message);
    }
  });

  document.getElementById('check-key-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = document.getElementById('check-key-msg');
    hideStatus(msg);
    hideError(loginError);

    var name = document.getElementById('check-key-name').value.trim();
    if (!name) {
      showError(loginError, 'Enter a key name to check.');
      return;
    }

    try {
      var result = await apiCall({ action: 'admin-check-key', key: name });
      if (result.valid) {
        var actDate = result.activatedAt ? new Date(result.activatedAt).toLocaleString() : 'Not yet';
        var expDate = result.expiresAt ? new Date(result.expiresAt).toLocaleString() : '-';
        showStatus(msg,
          'Key: ' + name + ' — VALID\n' +
          'Activated: ' + actDate + '\n' +
          'Expires: ' + expDate + '\n' +
          'Days remaining: ' + result.remaining
        );
      } else {
        showStatus(msg, 'Key: ' + name + ' — ' + (result.error || 'INVALID'));
      }
      document.getElementById('check-key-name').value = '';
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
      setTimeout(loadKeys, 1000);
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

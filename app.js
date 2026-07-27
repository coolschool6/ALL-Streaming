(function () {
  'use strict';

  var SESSION_KEY = 'ak_session';
  var TARGET_URL = 'https://dulo.tv/';
  var API_URL = '/api/validate';
  var REDIRECT_DELAY = 3000;

  var gateView = document.getElementById('gate-view');
  var expiredView = document.getElementById('expired-view');
  var keyInput = document.getElementById('key-input');
  var errorMsg = document.getElementById('error-msg');
  var statusMsg = document.getElementById('status-msg');
  var countdownEl = document.getElementById('countdown-timer');

  var countdownInterval = null;

  function showView(view) {
    gateView.classList.remove('active');
    expiredView.classList.remove('active');
    view.classList.add('active');
  }

  function showError() {
    errorMsg.classList.add('visible');
    keyInput.value = '';
    keyInput.focus();
  }

  function showErrorMessage(text) {
    errorMsg.textContent = text;
    errorMsg.classList.add('visible');
    keyInput.value = '';
    keyInput.focus();
  }

  function hideError() {
    errorMsg.classList.remove('visible');
    errorMsg.textContent = 'Invalid or expired access key. Please check and try again.';
  }

  function showStatus(text) {
    statusMsg.textContent = text;
    statusMsg.classList.add('visible');
  }

  function hideStatus() {
    statusMsg.textContent = '';
    statusMsg.classList.remove('visible');
  }

  function showCountdown(text) {
    countdownEl.textContent = text;
    countdownEl.classList.add('visible');
  }

  function hideCountdown() {
    countdownEl.textContent = '';
    countdownEl.classList.remove('visible');
  }

  function setLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Verifying...';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(
      atob(str).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join('')
    );
  }

  function decodeToken(token) {
    try {
      var parts = token.split('.');
      if (parts.length !== 2) return null;
      return JSON.parse(base64UrlDecode(parts[0]));
    } catch (e) {
      return null;
    }
  }

  async function apiCall(body) {
    var res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  }

  function saveSession(token) {
    localStorage.setItem(SESSION_KEY, token);
  }

  function getSession() {
    try {
      return localStorage.getItem(SESSION_KEY) || null;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function startCountdown(expiresAt, onExpired) {
    if (countdownInterval) clearInterval(countdownInterval);

    function update() {
      var diff = expiresAt - Date.now();
      if (diff <= 0) {
        clearInterval(countdownInterval);
        hideCountdown();
        if (onExpired) onExpired();
        return;
      }
      var days = Math.floor(diff / 86400000);
      var hours = Math.floor((diff % 86400000) / 3600000);
      var mins = Math.floor((diff % 3600000) / 60000);
      var secs = Math.floor((diff % 60000) / 1000);
      showCountdown(days + 'd ' + hours + 'h ' + mins + 'm ' + secs + 's remaining');
    }

    update();
    countdownInterval = setInterval(update, 1000);
  }

  function stopCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    hideCountdown();
  }

  function beginRedirect(expiresAt) {
    stopCountdown();
    startCountdown(expiresAt, function () {
      showView(expiredView);
    });
    showStatus('Key verified. Redirecting to platform...');
    setTimeout(function () {
      window.location.href = TARGET_URL;
    }, REDIRECT_DELAY);
  }

  async function attemptLogin(inputKey) {
    var btn = document.querySelector('.btn-primary');
    setLoading(btn, true);
    hideError();
    hideStatus();
    stopCountdown();

    try {
      var result;
      try {
        result = await apiCall({ action: 'validate-key', key: inputKey });
      } catch (apiError) {
        result = await validateLocally(inputKey);
      }

      if (result.valid && result.token) {
        saveSession(result.token);
        var data = decodeToken(result.token);
        if (data && data.e) {
          beginRedirect(data.e);
        } else {
          window.location.href = TARGET_URL;
        }
      } else {
        if (result.error === 'expired') {
          showErrorMessage('This key has already started and its time period has ended.');
        } else if (result.error === 'Invalid key') {
          showErrorMessage('That key does not match exactly. Check spelling, case, and spaces.');
        } else if (result.error === 'Invalid key configuration') {
          showErrorMessage('This key is misconfigured in keys.json.');
        } else {
          showError();
        }
      }
    } catch (e) {
      showErrorMessage('Validation failed. Check the key exactly or make sure keys.json is reachable.');
    } finally {
      setLoading(btn, false);
    }
  }

  async function validateLocally(inputKey) {
    try {
      var res = await fetch('keys.json', { cache: 'no-store' });
      var keys = await res.json();
    } catch (e) {
      return { valid: false, error: 'Cannot load keys' };
    }

    var keyObj = null;
    var normalised = inputKey.trim().toUpperCase();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].key.toUpperCase() === normalised) {
        keyObj = keys[i];
        break;
      }
    }

    if (!keyObj) {
      return { valid: false, error: 'Invalid key' };
    }

    var validDays = Number(keyObj.validDays);
    if (!Number.isFinite(validDays) || validDays <= 0) {
      return { valid: false, error: 'Invalid key configuration' };
    }

    var activatedAt = new Date().toISOString();
    var expiryMs = new Date(activatedAt).getTime() + validDays * 86400000;
    var remaining = Math.ceil((expiryMs - Date.now()) / 86400000);
    if (remaining <= 0) {
      return { valid: false, error: 'expired' };
    }

    var payload = JSON.stringify({ k: keyObj.key, a: activatedAt, d: validDays, e: expiryMs });
    var token = btoa(payload) + '.local';

    return {
      valid: true,
      token: token,
      remaining: remaining,
      activatedAt: activatedAt,
      expiresAt: new Date(expiryMs).toISOString()
    };
  }

  async function checkExistingSession() {
    var token = getSession();
    if (!token) {
      showView(gateView);
      return;
    }

    var data = decodeToken(token);

    if (data && data.e && data.e > Date.now()) {
      beginRedirect(data.e);
      return;
    }

    if (data && data.e && data.e <= Date.now()) {
      clearSession();
      showView(expiredView);
      stopCountdown();
      return;
    }

    try {
      var result = await apiCall({ action: 'verify-token', token: token });
      if (result.valid) {
        if (data && data.e) {
          beginRedirect(data.e);
        } else {
          window.location.href = TARGET_URL;
        }
        return;
      }
    } catch (e) {
      // token invalid
    }

    clearSession();
    showView(gateView);
  }

  document.getElementById('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    hideError();
    var val = keyInput.value.trim();
    if (!val) {
      keyInput.focus();
      return;
    }
    attemptLogin(val);
  });

  document.getElementById('btn-retry').addEventListener('click', function () {
    keyInput.value = '';
    hideError();
    hideStatus();
    stopCountdown();
    showView(gateView);
    keyInput.focus();
  });

  document.getElementById('btn-clear-session').addEventListener('click', function () {
    clearSession();
    keyInput.value = '';
    hideError();
    hideStatus();
    stopCountdown();
    showView(gateView);
    keyInput.focus();
  });

  keyInput.addEventListener('input', hideError);

  checkExistingSession();
})();

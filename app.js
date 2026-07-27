(function () {
  'use strict';

  var SESSION_KEY = 'ak_session';
  var LOCAL_STATE_KEY = 'ak_local_activation_state';
  var TARGET_URL = 'https://dulo.tv/';
  var API_URL = '/api/validate';

  var gateView = document.getElementById('gate-view');
  var expiredView = document.getElementById('expired-view');
  var keyInput = document.getElementById('key-input');
  var errorMsg = document.getElementById('error-msg');
  var statusMsg = document.getElementById('status-msg');

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

  async function apiCall(body) {
    var res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
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

  function getLocalState() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveLocalState(state) {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
  }

  async function loadKeys() {
    var res = await fetch('keys.json', { cache: 'no-store' });
    return await res.json();
  }

  function calcRemaining(activatedAt, validDays) {
    var start = new Date(activatedAt);
    var expiry = new Date(start);
    expiry.setDate(expiry.getDate() + Number(validDays));
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  async function validateLocally(inputKey) {
    var keys = await loadKeys();
    var keyObj = null;

    for (var i = 0; i < keys.length; i++) {
      if (keys[i].key === inputKey) {
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

    var state = getLocalState();
    var activatedAt = state[keyObj.key] && state[keyObj.key].activatedAt;
    if (!activatedAt) {
      activatedAt = new Date().toISOString();
      state[keyObj.key] = { activatedAt: activatedAt, validDays: validDays };
      saveLocalState(state);
    }

    var remaining = calcRemaining(activatedAt, validDays);
    if (remaining <= 0) {
      return { valid: false, error: 'expired' };
    }

    return {
      valid: true,
      token: 'local:' + btoa(JSON.stringify({ k: keyObj.key, a: activatedAt, d: validDays })),
      remaining: remaining,
      activatedAt: activatedAt,
      expiresAt: new Date(new Date(activatedAt).getTime() + validDays * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  async function attemptLogin(inputKey) {
    var btn = document.querySelector('.btn-primary');
    setLoading(btn, true);
    hideError();
    hideStatus();

    try {
      var result;
      try {
        result = await apiCall({ action: 'validate-key', key: inputKey });
      } catch (apiError) {
        result = await validateLocally(inputKey);
      }
      if (result.valid && result.token) {
        saveSession(result.token);
        showStatus('Activated on ' + new Date(result.activatedAt).toLocaleString() + '. Days remaining: ' + result.remaining + '.');
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

  function checkExistingSession() {
    var token = getSession();
    if (!token) {
      showView(gateView);
      hideStatus();
      return;
    }

    showView(gateView);
    showStatus('A saved session is on this browser. Enter the same key to review its start date and remaining time, or use a different key to clear it.');
  }

  document.getElementById('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    hideError();
    var val = keyInput.value;
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
    showView(gateView);
    keyInput.focus();
  });

  document.getElementById('btn-clear-session').addEventListener('click', function () {
    clearSession();
    keyInput.value = '';
    hideError();
    hideStatus();
    showView(gateView);
    keyInput.focus();
  });

  keyInput.addEventListener('input', hideError);

  checkExistingSession();
})();

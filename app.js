(function () {
  'use strict';

  var SESSION_KEY = 'ak_session';
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

  function hideError() {
    errorMsg.classList.remove('visible');
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

  async function attemptLogin(inputKey) {
    var btn = document.querySelector('.btn-primary');
    setLoading(btn, true);
    hideError();
    hideStatus();

    try {
      var result = await apiCall({ action: 'validate-key', key: inputKey });
      if (result.valid && result.token) {
        saveSession(result.token);
        showStatus('Activated on ' + new Date(result.activatedAt).toLocaleString() + '. Days remaining: ' + result.remaining + '.');
      } else {
        showError();
      }
    } catch (e) {
      showError();
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

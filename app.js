(function () {
  'use strict';

  var SESSION_KEY = 'ak_session';
  var TARGET_URL = 'https://dulo.tv/';
  var API_URL = '/api/validate';

  var gateView = document.getElementById('gate-view');
  var expiredView = document.getElementById('expired-view');
  var keyInput = document.getElementById('key-input');
  var errorMsg = document.getElementById('error-msg');

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

    try {
      var result = await apiCall({ action: 'validate-key', key: inputKey });
      if (result.valid && result.token) {
        saveSession(result.token);
        window.location.href = TARGET_URL;
      } else {
        showError();
      }
    } catch (e) {
      showError();
    } finally {
      setLoading(btn, false);
    }
  }

  async function checkExistingSession() {
    var token = getSession();
    if (!token) {
      showView(gateView);
      return;
    }

    try {
      var result = await apiCall({ action: 'verify-token', token: token });
      if (result.valid) {
        window.location.href = TARGET_URL;
      } else {
        clearSession();
        if (result.error === 'expired') {
          showView(expiredView);
        } else {
          showView(gateView);
        }
      }
    } catch (e) {
      clearSession();
      showView(gateView);
    }
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
    showView(gateView);
    keyInput.focus();
  });

  keyInput.addEventListener('input', hideError);

  checkExistingSession();
})();

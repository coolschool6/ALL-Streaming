(function () {
  'use strict';

  var SESSION_KEY = 'ak_session';
  var TARGET_URL = 'https://dulo.tv/';

  var gateView = document.getElementById('gate-view');
  var expiredView = document.getElementById('expired-view');
  var keyInput = document.getElementById('key-input');
  var errorMsg = document.getElementById('error-msg');

  function showView(view) {
    gateView.classList.remove('active');
    expiredView.classList.remove('active');
    view.classList.add('active');
  }

  function calcRemainingDays(keyObj) {
    var created = new Date(keyObj.createdAt + 'T00:00:00');
    var expiry = new Date(created);
    expiry.setDate(expiry.getDate() + keyObj.validDays);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  function findKey(inputKey) {
    var trimmed = inputKey.trim().toUpperCase();
    for (var i = 0; i < ACCESS_KEYS.length; i++) {
      if (ACCESS_KEYS[i].key.toUpperCase() === trimmed) return ACCESS_KEYS[i];
    }
    return null;
  }

  function saveSession(keyObj, remaining) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      key: keyObj.key,
      validDays: keyObj.validDays,
      createdAt: keyObj.createdAt,
      remaining: remaining,
      loginAt: new Date().toISOString()
    }));
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function showError() {
    errorMsg.classList.add('visible');
    keyInput.value = '';
    keyInput.focus();
  }

  function hideError() {
    errorMsg.classList.remove('visible');
  }

  function attemptLogin(inputKey) {
    var keyObj = findKey(inputKey);
    if (!keyObj) {
      showError();
      return;
    }
    var remaining = calcRemainingDays(keyObj);
    if (remaining <= 0) {
      saveSession(keyObj, 0);
      showView(expiredView);
      return;
    }
    saveSession(keyObj, remaining);
    window.location.href = TARGET_URL;
  }

  function checkExistingSession() {
    var session = getSession();
    if (!session) {
      showView(gateView);
      return;
    }
    var keyObj = findKey(session.key);
    if (!keyObj) {
      clearSession();
      showView(gateView);
      return;
    }
    var remaining = calcRemainingDays(keyObj);
    if (remaining <= 0) {
      showView(expiredView);
      return;
    }
    window.location.href = TARGET_URL;
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

(function () {
  'use strict';

  const SESSION_KEY = 'ak_session';
  const TARGET_URL = 'https://dulo.tv/';

  const gateView = document.getElementById('gate-view');
  const platformView = document.getElementById('platform-view');
  const expiredView = document.getElementById('expired-view');
  const keyInput = document.getElementById('key-input');
  const errorMsg = document.getElementById('error-msg');
  const daysLeftEl = document.getElementById('days-left');
  const platformFrame = document.getElementById('platform-frame');

  function showView(view) {
    [gateView, platformView, expiredView].forEach(v => v.classList.remove('active'));
    view.classList.add('active');
  }

  function calcRemainingDays(keyObj) {
    const created = new Date(keyObj.createdAt);
    const expiry = new Date(created);
    expiry.setDate(expiry.getDate() + keyObj.validDays);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    const diffMs = expiry.getTime() - today.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  function findKey(inputKey) {
    const trimmed = inputKey.trim().toUpperCase();
    return ACCESS_KEYS.find(k => k.key.toUpperCase() === trimmed);
  }

  function saveSession(keyObj, remaining) {
    const session = {
      key: keyObj.key,
      userNote: keyObj.userNote,
      validDays: keyObj.validDays,
      createdAt: keyObj.createdAt,
      remaining: remaining,
      loginAt: new Date().toISOString()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function loadPlatform(session) {
    daysLeftEl.textContent = session.remaining;
    platformFrame.src = TARGET_URL;
    showView(platformView);
  }

  function handleExpired() {
    showView(expiredView);
  }

  function handleInvalid() {
    errorMsg.classList.add('visible');
    keyInput.value = '';
    keyInput.focus();
  }

  function hideError() {
    errorMsg.classList.remove('visible');
  }

  function attemptLogin(inputKey) {
    const keyObj = findKey(inputKey);
    if (!keyObj) {
      handleInvalid();
      return;
    }
    const remaining = calcRemainingDays(keyObj);
    if (remaining <= 0) {
      saveSession(keyObj, 0);
      handleExpired();
      return;
    }
    saveSession(keyObj, remaining);
    loadPlatform({ remaining, keyObj });
  }

  function checkExistingSession() {
    const session = getSession();
    if (!session) {
      showView(gateView);
      return;
    }
    const keyObj = findKey(session.key);
    if (!keyObj) {
      clearSession();
      showView(gateView);
      return;
    }
    const remaining = calcRemainingDays(keyObj);
    if (remaining <= 0) {
      handleExpired();
      return;
    }
    loadPlatform({ remaining });
  }

  function handleLogout() {
    platformFrame.src = 'about:blank';
    clearSession();
    keyInput.value = '';
    hideError();
    showView(gateView);
    keyInput.focus();
  }

  document.getElementById('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    hideError();
    const val = keyInput.value.trim();
    if (!val) {
      keyInput.focus();
      return;
    }
    attemptLogin(val);
  });

  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-retry').addEventListener('click', function () {
    keyInput.value = '';
    hideError();
    showView(gateView);
    keyInput.focus();
  });

  keyInput.addEventListener('input', hideError);

  checkExistingSession();
})();

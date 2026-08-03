(function () {
  'use strict';

  // ===== GOOGLE SHEETS PAYWALL SYSTEM =====
  // Keys stored in Google Sheet, accessed via Apps Script web app
  // localStorage caches the expiry for instant offline check

  var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxQRgoIOUUJaJP0WKFaFFs4y4UVyhMh853GJPyO1CO4TDfag9H8cduAS_05ffrxLaxz/exec';
  var VERIFY_INTERVAL_MS = 15 * 60 * 1000;
  var expiryTimerId = null;

  function clearExpiryTimer() {
    if (expiryTimerId) {
      clearTimeout(expiryTimerId);
      expiryTimerId = null;
    }
  }

  function scheduleExpiryTimer(expiryTime) {
    clearExpiryTimer();
    var expiryMs = parseInt(expiryTime, 10);
    if (!expiryMs || isNaN(expiryMs)) return;
    var delay = Math.max(0, expiryMs - Date.now() + 1000);
    expiryTimerId = setTimeout(function () {
      clearExpiryTimer();
      checkPaywall();
      backgroundVerifyKey();
    }, delay);
  }

  function checkPaywall() {
    var overlay = document.getElementById('paywall-overlay');
    var badge = document.getElementById('sub-badge');
    var daysLeftEl = document.getElementById('sub-days-left');
    if (!overlay) return;

    var expiryTime = localStorage.getItem('asfr_expiry_time');
    var now = Date.now();

    if (expiryTime && now < parseInt(expiryTime, 10)) {
      scheduleExpiryTimer(expiryTime);
      overlay.style.display = 'none';
      if (badge && daysLeftEl) {
        var timeLeftMs = parseInt(expiryTime, 10) - now;
        var daysLeft = Math.ceil(timeLeftMs / (1000 * 60 * 60 * 24));
        daysLeftEl.textContent = daysLeft;
        badge.style.display = 'flex';
      }
    } else {
      clearExpiryTimer();
      localStorage.removeItem('asfr_access_key');
      localStorage.removeItem('asfr_expiry_time');
      stopVideoPlayback();
      overlay.style.display = 'flex';
      if (badge) badge.style.display = 'none';
    }
    document.documentElement.style.display = '';
  }

  function verifyOrActivateKey(keyValue) {
    return fetch(SCRIPT_URL + '?action=verify&key=' + encodeURIComponent(keyValue))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status === 'ready_to_activate') {
          return fetch(SCRIPT_URL + '?action=activate&key=' + encodeURIComponent(keyValue))
            .then(function (res) { return res.json(); })
            .then(function (actData) {
              if (actData.status === 'activated' || actData.status === 'already_activated') {
                localStorage.setItem('asfr_access_key', keyValue);
                localStorage.setItem('asfr_expiry_time', actData.expiresAt.toString());
                scheduleExpiryTimer(actData.expiresAt);
                return { success: true, expiresAt: actData.expiresAt };
              }
              return { success: false, error: 'Activation failed' };
            });
        } else if (data.status === 'active') {
          localStorage.setItem('asfr_access_key', keyValue);
          localStorage.setItem('asfr_expiry_time', data.expiresAt.toString());
          scheduleExpiryTimer(data.expiresAt);
          return { success: true, expiresAt: data.expiresAt, daysRemaining: data.daysRemaining };
        } else if (data.status === 'expired') {
          return { success: false, error: 'This key has expired.' };
        } else {
          return { success: false, error: 'Invalid key.' };
        }
      });
  }

  function backgroundVerifyKey() {
    var savedKey = localStorage.getItem('asfr_access_key');
    var expiryTime = localStorage.getItem('asfr_expiry_time');
    if (!savedKey || !expiryTime) return;

    var lastCheck = localStorage.getItem('asfr_last_verify');
    var now = Date.now();
    if (lastCheck && (now - parseInt(lastCheck, 10)) < VERIFY_INTERVAL_MS) return;

    fetch(SCRIPT_URL + '?action=verify&key=' + encodeURIComponent(savedKey))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status === 'expired' || data.status === 'invalid') {
          clearExpiryTimer();
          localStorage.removeItem('asfr_access_key');
          localStorage.removeItem('asfr_expiry_time');
          localStorage.removeItem('asfr_last_verify');
          checkPaywall();
        } else if (data.status === 'active') {
          localStorage.setItem('asfr_expiry_time', data.expiresAt.toString());
          localStorage.setItem('asfr_last_verify', now.toString());
          scheduleExpiryTimer(data.expiresAt);
          checkPaywall();
        }
      })
      .catch(function () {});
  }

  function setupPaywallEvents() {
    var activateBtn = document.getElementById('btn-activate');
    var keyInput = document.getElementById('key-input');
    var errorMsg = document.getElementById('paywall-error');

    if (!activateBtn || !keyInput) return;

    activateBtn.addEventListener('click', function () {
      var enteredKey = keyInput.value.trim();
      if (!enteredKey) {
        errorMsg.textContent = 'Please enter a key.';
        return;
      }

      var btn = activateBtn;
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      errorMsg.textContent = '';

      verifyOrActivateKey(enteredKey).then(function (result) {
        btn.disabled = false;
        btn.textContent = 'Activate';

        if (result.success) {
          document.getElementById('paywall-overlay').style.display = 'none';
          var daysLeft = result.daysRemaining || Math.ceil((result.expiresAt - Date.now()) / 86400000);
          alert('Access granted! You have ' + daysLeft + ' day(s) remaining.');
          window.location.reload();
        } else {
          errorMsg.textContent = result.error + ' Contact WhatsApp to purchase a valid key.';
        }
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = 'Activate';
        errorMsg.textContent = 'Network error. Check your connection.';
      });
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    checkPaywall();
    backgroundVerifyKey();
    setInterval(backgroundVerifyKey, VERIFY_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        checkPaywall();
        backgroundVerifyKey();
      }
    });
    setupPaywallEvents();

    var logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        localStorage.removeItem('asfr_access_key');
        localStorage.removeItem('asfr_expiry_time');
        window.location.reload();
      });
    }
  });


  // ===== STREAMING PLATFORM ENGINE =====
  var API_KEY = 'cd27a14dfc1752e04b474124a5af6d2b';
  var BASE = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/';
  var currentLang = localStorage.getItem('asfr_lang') || 'en';

  var content = document.getElementById('content');
  var loading = document.getElementById('loading');
  var heroBackdrop = document.getElementById('hero-backdrop');
  var heroTitle = document.getElementById('hero-title');
  var heroOverview = document.getElementById('hero-overview');
  var heroBadge = document.getElementById('hero-badge');
  var heroDots = document.getElementById('hero-dots');
  var btnWatch = document.getElementById('btn-watch');
  var btnInfo = document.getElementById('btn-info');
  var playerModal = document.getElementById('player-modal');
  var playerIframe = document.getElementById('player-iframe');
  var playerTitle = document.getElementById('player-title');
  var playerClose = document.getElementById('player-close');
  var tvControls = document.getElementById('tv-controls');
  var seasonSelect = document.getElementById('season-select');
  var episodeSelect = document.getElementById('episode-select');
  var detailModal = document.getElementById('detail-modal');
  var detailClose = document.getElementById('detail-close');
  var detailBackdrop = document.getElementById('detail-backdrop');
  var detailPoster = document.getElementById('detail-poster');
  var detailTitle = document.getElementById('detail-title');
  var detailMeta = document.getElementById('detail-meta');
  var detailOverview = document.getElementById('detail-overview');
  var detailWatch = document.getElementById('detail-watch');
  var searchToggle = document.getElementById('search-toggle');
  var searchBar = document.getElementById('search-bar');
  var searchInput = document.getElementById('search-input');
  var searchClose = document.getElementById('search-close') || document.getElementById('searchClose');
  var navBtns = document.querySelectorAll('.nav-btn');

  var BLOCKED_TMDB_IDS = { 634649: true };
  var BLOCKED_STORAGE_KEY = 'asfr_blocked_ids';
  var runtimeBlocked = {};
  function loadRuntimeBlocked() {
    runtimeBlocked = {};
    try {
      var raw = localStorage.getItem(BLOCKED_STORAGE_KEY);
      if (raw) {
        var list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (var i = 0; i < list.length; i++) runtimeBlocked[list[i]] = true;
        }
      }
    } catch (e) {}
    return runtimeBlocked;
  }
  loadRuntimeBlocked();
  function blockItemNow(id) {
    if (!id) return;
    if (BLOCKED_TMDB_IDS[id]) return;
    runtimeBlocked[id] = true;
    try {
      var keys = Object.keys(runtimeBlocked);
      localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(keys));
    } catch (e) {}
  }
  function isBlockedItem(item) {
    if (!item) return false;
    return !!BLOCKED_TMDB_IDS[item.id] || !!runtimeBlocked[item.id];
  }

  var heroItems = [];
  var heroIndex = 0;
  var heroInterval = null;
  var currentFilter = 'all';
  var searchTimeout = null;
  var searchOverlayTimeout = null;
  var currentMedia = null;
  var hlsInstance = null;
  var customActive = false;
  var sourceCache = { url: null, hlsUrl: null, directUrl: null, direct: false, ready: false, warm: false };
  var forceRefresh = false;
  var prefetchInFlight = {};
  var prefetchPromises = {};
  var lastProgressSave = 0;
  var PLAYBACK_SAVE_INTERVAL = 5000;
  var currentPlaybackId = null;
  var currentStreamRequestId = 0;
  var playbackCounter = 0;
  var resumeTarget = null;
  var hlsFatalRetries = 0;
  var prewarmInFlight = false;
  var nextPrefetchedFor = null;
  var loaderStart = 0;

  function newPlaybackId() {
    playbackCounter++;
    return playbackCounter;
  }

  function fetchTMDB(endpoint) {
    var sep = endpoint.indexOf('?') === -1 ? '?' : '&';
    return fetch(BASE + endpoint + sep + 'api_key=' + API_KEY + '&language=' + currentLang)
      .then(function (res) {
        if (!res.ok) throw new Error('TMDB error');
        return res.json();
      })
      .then(function (data) {
        return data.results !== undefined ? data.results : data;
      });
  }

  function imgURL(path, size) {
    if (!path) return '';
    return IMG + (size || 'w500') + path;
  }

  function escapeHTML(str) {
    var d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function parseReleaseDate(item) {
    var raw = item && (item.release_date || item.first_air_date || '');
    if (!raw) return null;
    var dt = new Date(raw);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function isFutureRelease(item) {
    var dt = parseReleaseDate(item);
    if (!dt) return false;
    return dt.getTime() > Date.now();
  }

  function getAvailabilityMessage(item) {
    return isFutureRelease(item) ? 'Available on a future date upon official release' : '';
  }

  function addAvailabilityBadge(card, item, posterEl) {
    var existing = card.querySelector('.card-availability');
    if (existing) existing.remove();
    if (!isFutureRelease(item)) return;
    var badge = document.createElement('div');
    badge.className = 'card-availability';
    badge.textContent = 'Coming Soon';
    var poster = posterEl || card.querySelector('.card-poster');
    if (poster) poster.appendChild(badge);
  }

  function initHero(items) {
    heroItems = items.filter(function (it) { return !isBlockedItem(it); }).slice(0, 8);
    heroIndex = 0;
    renderHeroItem();
    renderHeroDots();
    startHeroRotation();
  }

  function renderHeroItem() {
    if (!heroItems.length) return;
    var item = heroItems[heroIndex];
    var bg = item.backdrop_path || item.poster_path;
    heroBackdrop.style.backgroundImage = bg ? 'url(' + imgURL(bg, 'original') + ')' : 'none';
    heroTitle.textContent = item.title || item.name || '';
    heroOverview.textContent = item.overview || '';
    btnWatch.onclick = function () { openPlayer(item, item.media_type || 'movie'); };
    btnInfo.onclick = function () { openDetail(item, item.media_type || 'movie'); };
  }

  function renderHeroDots() {
    heroDots.innerHTML = '';
    for (var i = 0; i < heroItems.length; i++) {
      var dot = document.createElement('div');
      dot.className = 'hero-dot' + (i === heroIndex ? ' active' : '');
      dot.setAttribute('data-index', i);
      dot.addEventListener('click', function () {
        heroIndex = parseInt(this.getAttribute('data-index'));
        renderHeroItem();
        updateHeroDots();
        restartHeroRotation();
      });
      heroDots.appendChild(dot);
    }
  }

  function updateHeroDots() {
    var dots = heroDots.querySelectorAll('.hero-dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('active', i === heroIndex);
    }
  }

  function startHeroRotation() {
    heroInterval = setInterval(function () {
      heroIndex = (heroIndex + 1) % heroItems.length;
      renderHeroItem();
      updateHeroDots();
    }, 6000);
  }

  function restartHeroRotation() {
    clearInterval(heroInterval);
    startHeroRotation();
  }

  var CHANNELS = [
    { name: 'Netflix', logo: 'logos/netflix.png', provider_id: 8 },
    { name: 'Prime Video', logo: 'logos/primevideo.png', provider_id: 9 },
    { name: 'Disney+', logo: 'logos/disney.png', provider_id: 337 },
    { name: 'Hulu', logo: 'logos/hulu.png', provider_id: 15 },
    { name: 'Max', logo: 'logos/hbomax.png', provider_id: 1899 },
    { name: 'Apple TV+', logo: 'logos/appletv.png', provider_id: 350 },
    { name: 'Paramount+', logo: 'logos/paramount.png', provider_id: 531 },
    { name: 'Peacock', logo: 'logos/peacock.png', provider_id: 386 },
    { name: 'Crunchyroll', logo: 'logos/crunchyroll.png', provider_id: 283 },
    { name: 'AMC+', logo: 'logos/amc.png', provider_id: 528 }
  ];

  function createChannelsRow() {
    var section = document.createElement('div');
    section.className = 'category-row';
    section.setAttribute('data-type', 'all');

    var header = document.createElement('div');
    header.className = 'row-header';
    var h2 = document.createElement('h2');
    h2.className = 'row-title';
    h2.textContent = 'Channels & Apps';
    header.appendChild(h2);
    section.appendChild(header);

    var track = document.createElement('div');
    track.className = 'cards-track channels-track';

    for (var i = 0; i < CHANNELS.length; i++) {
      (function(ch) {
        var card = document.createElement('div');
        card.className = 'channel-card';
        var logoWrap = document.createElement('div');
        logoWrap.className = 'channel-logo';
        var img = document.createElement('img');
        img.src = ch.logo;
        img.alt = ch.name;
        logoWrap.appendChild(img);
        card.appendChild(logoWrap);
        card.addEventListener('click', function (e) {
          e.preventDefault();
          loadProviderContent(ch);
        });
        track.appendChild(card);
      })(CHANNELS[i]);
    }
    section.appendChild(track);
    return section;
  }

  function loadProviderContent(channel) {
    clearSearchResults();
    showAllRows(false);
    var section = document.createElement('div');
    section.className = 'search-row';
    section.id = 'search-results';

    var headerBox = document.createElement('div');
    headerBox.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom: 20px;';
    var h2 = document.createElement('h2');
    h2.className = 'row-title';
    h2.textContent = channel.name + ' Titles';
    var backBtn = document.createElement('button');
    backBtn.textContent = '← Back to Home';
    backBtn.className = 'btn btn-secondary';
    backBtn.onclick = function () { clearSearchResults(); };
    headerBox.appendChild(h2);
    headerBox.appendChild(backBtn);
    section.appendChild(headerBox);

    var grid = document.createElement('div');
    grid.className = 'search-results-grid';
    section.appendChild(grid);
    content.appendChild(section);

    Promise.all([
      fetchTMDB('/discover/movie?watch_region=US&with_watch_providers=' + channel.provider_id + '&sort_by=popularity.desc'),
      fetchTMDB('/discover/tv?watch_region=US&with_watch_providers=' + channel.provider_id + '&sort_by=popularity.desc')
    ]).then(function (results) {
      var movies = (results[0] || []).map(function(m) { m.media_type = 'movie'; return m; });
      var tvs = (results[1] || []).map(function(t) { t.media_type = 'tv'; return t; });
      var combined = [];
      var maxLen = Math.max(movies.length, tvs.length);
      for (var i = 0; i < maxLen; i++) {
        if (movies[i]) combined.push(movies[i]);
        if (tvs[i]) combined.push(tvs[i]);
      }
      if (combined.length === 0) {
        grid.innerHTML = '<div class="search-empty">No titles found for this provider.</div>';
        return;
      }
      for (var ci = 0; ci < combined.length; ci++) {
        var cCard = createCard(combined[ci], combined[ci].media_type);
        if (cCard) grid.appendChild(cCard);
      }
    });
    window.scrollTo({ top: 300, behavior: 'smooth' });
  }

  function createCategoryRow(title, items, type, useTopStyle) {
    var section = document.createElement('div');
    section.className = 'category-row';
    section.setAttribute('data-type', type || 'all');

    var header = document.createElement('div');
    header.className = 'row-header';
    var h2 = document.createElement('h2');
    h2.className = 'row-title';
    h2.textContent = title;
    header.appendChild(h2);
    section.appendChild(header);

    var track = document.createElement('div');
    track.className = 'cards-track';
    var displayItems = useTopStyle ? items.slice(0, 10) : items;

    for (var i = 0; i < displayItems.length; i++) {
      var item = displayItems[i];
      var mediaType = item.media_type || type || 'movie';
      if (useTopStyle) {
        var topCard = createTopCard(item, mediaType, i + 1);
        if (topCard) track.appendChild(topCard);
      } else {
        var regCard = createCard(item, mediaType);
        if (regCard) track.appendChild(regCard);
      }
    }
    section.appendChild(track);
    return section;
  }

  function renderContinueWatching() {
    var existing = document.getElementById('continue-watching');
    if (existing) existing.remove();
    var map = {};
    try { map = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch (err) { map = {}; }
    var entries = [];
    Object.keys(map).forEach(function (key) {
      var entry = map[key];
      if (!entry || !entry.title) return;
      var parts = key.split(':');
      if (parts.length < 4) return;
      entries.push({ type: parts[0], id: parts[1], s: parts[2], e: parts[3], entry: entry });
    });
    entries.sort(function (a, b) { return (b.entry.t || 0) - (a.entry.t || 0); });

    var groups = [];
    var groupMap = {};
    entries.forEach(function (item) {
      var gKey = item.type + ':' + item.id;
      if (!groupMap[gKey]) {
        groupMap[gKey] = { type: item.type, id: item.id, latest: item, s: item.s, e: item.e };
        groups.push(groupMap[gKey]);
      } else {
        var g = groupMap[gKey];
        if ((item.entry.t || 0) > (g.latest.entry.t || 0)) {
          g.latest = item;
          g.s = item.s;
          g.e = item.e;
        }
      }
    });
    groups.sort(function (a, b) { return (b.latest.entry.t || 0) - (a.latest.entry.t || 0); });
    if (!groups.length) return;

    var section = document.createElement('div');
    section.className = 'category-row';
    section.id = 'continue-watching';
    section.setAttribute('data-type', 'all');
    var header = document.createElement('div');
    header.className = 'row-header';
    var h2 = document.createElement('h2');
    h2.className = 'row-title';
    h2.textContent = 'Continue Watching';
    header.appendChild(h2);
    section.appendChild(header);

    var track = document.createElement('div');
    track.className = 'cards-track';
    groups.slice(0, 12).forEach(function (cw) {
      var card = document.createElement('div');
      card.className = 'card continue-card';
      card.setAttribute('data-type', cw.type);
      card.setAttribute('data-id', cw.id);
      var poster = document.createElement('div');
      poster.className = 'card-poster';
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.src = cw.latest.entry.poster ? imgURL(cw.latest.entry.poster, 'w342') : '';
      img.alt = cw.latest.entry.title;
      poster.appendChild(img);
      var pct = (cw.latest.entry.dur > 0) ? Math.min(100, Math.round((cw.latest.entry.pos / cw.latest.entry.dur) * 100)) : 0;
      var bar = document.createElement('div');
      bar.className = 'continue-progress';
      var fill = document.createElement('div');
      fill.className = 'continue-progress-fill';
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      poster.appendChild(bar);
      var badge = document.createElement('span');
      badge.className = 'continue-label';
      badge.textContent = cw.type === 'tv' ? 'Continue S' + cw.s + 'E' + cw.e : 'Continue';
      poster.appendChild(badge);
      card.appendChild(poster);
      var info = document.createElement('div');
      info.className = 'card-info';
      var name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = cw.latest.entry.title;
      info.appendChild(name);
      var sub = document.createElement('div');
      sub.className = 'card-year';
      sub.textContent = cw.type === 'tv' ? 'S' + cw.s + ' \u00b7 E' + cw.e : fmtTime(Math.max(0, cw.latest.entry.dur - cw.latest.entry.pos)) + ' left';
      info.appendChild(sub);
      card.appendChild(info);
      card.addEventListener('click', function () {
        var item = { id: cw.id, title: cw.latest.entry.title, poster_path: cw.latest.entry.poster };
        resumeTarget = { type: cw.type, s: cw.s, e: cw.e };
        openPlayer(item, cw.type);
      });
      if (!isBlockedItem(cw)) track.appendChild(card);
    });
    section.appendChild(track);
    content.insertBefore(section, content.firstChild);
  }

  function createCard(item, mediaType) {
    if (isBlockedItem(item)) return null;
    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-type', mediaType);
    card.setAttribute('data-id', item.id);
    var poster = document.createElement('div');
    poster.className = 'card-poster';
    var img = document.createElement('img');
    img.loading = 'lazy';
    var src = item.poster_path || item.backdrop_path;
    img.src = src ? imgURL(src) : '';
    img.alt = item.title || item.name || '';
    poster.appendChild(img);

    if (item.vote_average && item.vote_average > 0) {
      var ratingBadge = document.createElement('div');
      ratingBadge.className = 'card-rating';
      ratingBadge.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' + item.vote_average.toFixed(1);
      poster.appendChild(ratingBadge);
    }

    addAvailabilityBadge(card, item, poster);
    card.appendChild(poster);

    var info = document.createElement('div');
    info.className = 'card-info';
    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = item.title || item.name || '';
    info.appendChild(name);

    var yearText = (item.release_date || item.first_air_date || '').substring(0, 4);
    if (yearText) {
      var year = document.createElement('div');
      year.className = 'card-year';
      year.textContent = yearText;
      info.appendChild(year);
    }
    card.appendChild(info);

    card.addEventListener('click', function () { openDetail(item, mediaType); });
    card.addEventListener('mouseenter', function () {
      scheduleHoverPrefetch(item, mediaType === 'tv' ? 'tv' : 'movie', card);
    });
    card.addEventListener('mouseleave', function () {
      if (card._hoverTimer) { clearTimeout(card._hoverTimer); card._hoverTimer = null; }
      var badge = card.querySelector('.card-warm-badge');
      if (badge) badge.remove();
      card.classList.remove('card--warming');
    });
    return card;
  }

  function createTopCard(item, mediaType, rank) {
    if (isBlockedItem(item)) return null;
    var card = document.createElement('div');
    card.className = 'top-card';
    card.setAttribute('data-type', mediaType);
    card.setAttribute('data-id', item.id);
    var num = document.createElement('div');
    num.className = 'top-number';
    num.textContent = rank;
    card.appendChild(num);
    var posterWrap = document.createElement('div');
    posterWrap.className = 'top-card-poster';
    var img = document.createElement('img');
    img.loading = 'lazy';
    var src = item.poster_path || item.backdrop_path;
    img.src = src ? imgURL(src) : '';
    posterWrap.appendChild(img);
    addAvailabilityBadge(card, item, posterWrap);
    card.appendChild(posterWrap);
    card.addEventListener('click', function () { openDetail(item, mediaType); });
    card.addEventListener('mouseenter', function () {
      scheduleHoverPrefetch(item, mediaType === 'tv' ? 'tv' : 'movie', card);
    });
    card.addEventListener('mouseleave', function () {
      if (card._hoverTimer) { clearTimeout(card._hoverTimer); card._hoverTimer = null; }
      var badge = card.querySelector('.card-warm-badge');
      if (badge) badge.remove();
      card.classList.remove('card--warming');
    });
    return card;
  }

  function openDetail(item, mediaType) {
    if (isBlockedItem(item)) return;
    if (mediaType === 'tv') {
      openShowPage(item);
      return;
    }
    var bg = item.backdrop_path || item.poster_path;
    detailBackdrop.style.backgroundImage = bg ? 'url(' + imgURL(bg, 'original') + ')' : 'none';
    detailPoster.innerHTML = item.poster_path ? '<img src="' + imgURL(item.poster_path) + '" alt="">' : '';
    detailTitle.textContent = item.title || item.name || '';
    detailOverview.textContent = item.overview || '';
    var blocked = isFutureRelease(item);
    detailWatch.disabled = blocked;
    detailWatch.textContent = blocked ? 'Coming Soon' : 'Watch now';
    detailWatch.onclick = function () {
      if (blocked) return;
      closeDetail();
      openPlayer(item, mediaType);
    };
    detailModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (mediaType !== 'tv') {
      if (!blocked) {
        detailWatch.textContent = 'Watch now';
        var prog = progressGet('movie', item.id, 1, 1);
        if (prog && prog.pos > 15) detailWatch.textContent = 'Resume \u00b7 ' + fmtTime(prog.pos);
      }
      preFetchSource(item, mediaType).catch(function () {});
    }
  }

  /* ===== FULL-PAGE SHOW VIEW ===== */
  var showPage = document.getElementById('show-page');
  var showBackdrop = document.getElementById('show-backdrop');
  var showTitle = document.getElementById('show-title');
  var showMeta = document.getElementById('show-meta');
  var seasonBtn = document.getElementById('season-btn');
  var seasonDropdown = document.getElementById('season-dropdown');
  var showEpisodes = document.getElementById('show-episodes');
  var episodesLoading = document.getElementById('episodes-loading');
  var showSynopsis = document.getElementById('show-synopsis');
  var showSimilarTrack = document.getElementById('show-similar-track');
  var showBackBtn = document.getElementById('show-back-btn');
  var currentShowData = null;
  var currentSeasonNum = 1;

  function openShowPage(item) {
    showPage.classList.add('active');
    document.body.style.overflow = 'hidden';
    showEpisodes.innerHTML = '';
    showEpisodes.appendChild(episodesLoading);
    showSimilarTrack.innerHTML = '';
    showSynopsis.innerHTML = '';
    showTitle.textContent = item.name || item.title || '';
    seasonBtn.innerHTML = 'Season 1 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    seasonDropdown.innerHTML = '';
    seasonDropdown.classList.remove('open');
    currentSeasonNum = 1;

    var bg = item.backdrop_path || item.poster_path;
    showBackdrop.style.backgroundImage = bg ? 'url(' + imgURL(bg, 'original') + ')' : 'none';

    var availability = document.getElementById('show-availability');
    if (availability) {
      if (isFutureRelease(item)) {
        availability.classList.remove('hidden');
        var releaseDate = parseReleaseDate(item);
        var dateText = releaseDate ? releaseDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'a future date';
        availability.textContent = 'Coming Soon \u2014 available upon official release on ' + dateText;
      } else {
        availability.classList.add('hidden');
        availability.textContent = '';
      }
    }

    fetchTMDB('/tv/' + item.id).then(function (tvData) {
      currentShowData = tvData;
      var year = (tvData.first_air_date || '').substring(0, 4);
      var rating = tvData.vote_average ? tvData.vote_average.toFixed(1) : '';
      var seasons = (tvData.seasons || []).filter(function(s) { return s.season_number > 0; });
      var seasonCount = tvData.number_of_seasons || seasons.length;

      var metaHTML = '';
      if (year) metaHTML += '<span class="meta-item">' + year + '</span>';
      if (rating) metaHTML += '<span class="meta-dot"></span><span class="meta-item meta-rating meta-imdb">IMDb ' + rating + '</span>';
      if (seasonCount) metaHTML += '<span class="meta-dot"></span><span class="meta-item">' + seasonCount + ' Season' + (seasonCount !== 1 ? 's' : '') + '</span>';
      showMeta.innerHTML = metaHTML;

      seasonDropdown.innerHTML = '';
      seasons.forEach(function (s) {
        var btn = document.createElement('button');
        btn.className = 'season-option' + (s.season_number === 1 ? ' active' : '');
        btn.textContent = s.name || ('Season ' + s.season_number);
        btn.setAttribute('data-season', s.season_number);
        btn.addEventListener('click', function () {
          var sn = parseInt(this.getAttribute('data-season'));
          currentSeasonNum = sn;
          seasonBtn.innerHTML = (this.textContent) + ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
          seasonDropdown.querySelectorAll('.season-option').forEach(function(o) { o.classList.remove('active'); });
          btn.classList.add('active');
          seasonDropdown.classList.remove('open');
          renderSeasonEpisodes(item.id, sn);
        });
        seasonDropdown.appendChild(btn);
      });

      renderSeasonEpisodes(item.id, 1);
      renderSimilarShows(item.id);
      preFetchSource(item, 'tv', 1, 1).catch(function () {});
    });
  }

  function closeShowPage() {
    showPage.classList.remove('active');
    document.body.style.overflow = '';
    currentShowData = null;
  }

  function renderSeasonEpisodes(tvId, seasonNum) {
    episodesLoading.classList.add('active');
    showEpisodes.innerHTML = '';
    showEpisodes.appendChild(episodesLoading);

    fetchTMDB('/tv/' + tvId + '/season/' + seasonNum).then(function (seasonData) {
      episodesLoading.classList.remove('active');
      showEpisodes.innerHTML = '';

      var episodes = seasonData.episodes || [];
      var seasonName = seasonData.name || ('Season ' + seasonNum);

      episodes.forEach(function (ep) {
        var card = document.createElement('div');
        card.className = 'episode-card';

        var thumb = document.createElement('div');
        thumb.className = 'episode-thumb';
        var thumbImg = document.createElement('img');
        thumbImg.loading = 'lazy';
        var thumbSrc = ep.still_path || (currentShowData && currentShowData.backdrop_path);
        thumbImg.src = thumbSrc ? imgURL(thumbSrc, 'w500') : '';
        thumbImg.alt = ep.name || '';
        thumb.appendChild(thumbImg);

        var info = document.createElement('div');
        info.className = 'episode-info';

        var label = document.createElement('div');
        label.className = 'episode-label';
        label.textContent = 'Season ' + seasonNum + ', Episode ' + ep.episode_number;

        var name = document.createElement('h3');
        name.className = 'episode-name';
        name.textContent = ep.name || ('Episode ' + ep.episode_number);

        var desc = document.createElement('p');
        desc.className = 'episode-desc';
        desc.textContent = ep.overview || '';

        var footer = document.createElement('div');
        footer.className = 'episode-footer';
        if (ep.runtime) {
          var runtime = document.createElement('span');
          runtime.textContent = ep.runtime + ' min';
          footer.appendChild(runtime);
        }
        if (ep.air_date) {
          var date = document.createElement('span');
          var d = new Date(ep.air_date);
          date.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          footer.appendChild(date);
        }
        var hdBadge = document.createElement('span');
        hdBadge.className = 'ep-badge';
        hdBadge.textContent = 'HD';
        footer.appendChild(hdBadge);

        info.appendChild(label);
        info.appendChild(name);
        info.appendChild(desc);
        info.appendChild(footer);

        card.appendChild(thumb);
        card.appendChild(info);

        card.addEventListener('click', function () {
          openPlayer(currentShowData, 'tv');
          setTimeout(function () {
            if (seasonSelect) seasonSelect.value = seasonNum;
            if (seasonSelect) seasonSelect.dispatchEvent(new Event('change'));
            setTimeout(function () {
              if (episodeSelect) episodeSelect.value = ep.episode_number;
              if (episodeSelect) episodeSelect.dispatchEvent(new Event('change'));
            }, 600);
          }, 500);
        });

        showEpisodes.appendChild(card);
      });

      var synLabel = document.createElement('div');
      synLabel.className = 'syn-label';
      synLabel.textContent = seasonName + ' · ' + episodes.length + ' Episodes';

      var synText = document.createElement('div');
      synText.className = 'syn-text';
      synText.textContent = currentShowData ? currentShowData.overview || '' : '';

      showSynopsis.innerHTML = '';
      showSynopsis.appendChild(synLabel);
      showSynopsis.appendChild(synText);

      if (episodes.length > 0 && currentShowData) {
        preFetchSource(currentShowData, 'tv', seasonNum, episodes[0].episode_number).catch(function () {});
      }
    });
  }

  function renderSimilarShows(tvId) {
    showSimilarTrack.innerHTML = '';
    fetchTMDB('/tv/' + tvId + '/similar').then(function (shows) {
      var items = (shows || []).slice(0, 15);
      items.forEach(function (show) {
        var card = document.createElement('div');
        card.className = 'show-similar-card';

        var poster = document.createElement('div');
        poster.className = 'similar-poster';
        var img = document.createElement('img');
        img.loading = 'lazy';
        var src = show.poster_path || show.backdrop_path;
        img.src = src ? imgURL(src) : '';
        img.alt = show.name || '';
        poster.appendChild(img);

        var name = document.createElement('div');
        name.className = 'similar-name';
        name.textContent = show.name || '';

        card.appendChild(poster);
        card.appendChild(name);
        card.addEventListener('click', function () {
          openShowPage(show);
          showPage.scrollTop = 0;
        });
        showSimilarTrack.appendChild(card);
      });
    });
  }

  function closeDetail() {
    detailModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function populateQualityChips(levels) {
    var settingsEl = document.getElementById('player-settings');
    if (!settingsEl) return;
    var group = settingsEl.querySelector('.setting-group[data-group="quality"]');
    if (!group) return;
    var chips = group.querySelectorAll('.setting-chip');
    for (var i = 0; i < chips.length; i++) chips[i].remove();
    function addChip(value, label, active) {
      var chip = document.createElement('span');
      chip.className = 'setting-chip' + (active ? ' setting-chip--active' : '');
      chip.setAttribute('data-setting', 'quality');
      chip.setAttribute('data-value', value);
      chip.textContent = label;
      group.appendChild(chip);
    }
    addChip('default', 'Auto', true);
    var heights = [];
    var seen = {};
    (levels || []).forEach(function (l) {
      if (l.height && !seen[l.height]) { seen[l.height] = true; heights.push(l.height); }
    });
    heights.sort(function (a, b) { return b - a; });
    heights.forEach(function (h) { addChip(String(h), h + 'p', false); });
  }

  function initCustomPlayer(sourceUrl, sourceName, isDirect) {
    var pid = currentPlaybackId;
    var video = document.getElementById('hls-video');
    var iframe = document.getElementById('player-iframe');
    if (!video || !iframe) return;

    destroyCustomPlayer();

    updatePlayNextButton();
    customActive = true;
    hlsFatalRetries = 0;
    setShield(false);
    iframe.style.display = 'none';
    video.style.display = 'block';
    video.controls = false;
    video.removeAttribute('src');

    attachPlaybackEvents();
    video.addEventListener('loadedmetadata', function () {
      if (currentPlaybackId !== pid) return;
      resumeFromCache(video);
    }, { once: true });

    var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) && /AppleWebKit/.test(navigator.userAgent);

    if (isDirect || video.canPlayType('application/vnd.apple.mpegurl') || isIOS) {
      video.src = sourceUrl;
      video.addEventListener('loadedmetadata', function () {
        if (currentPlaybackId !== pid) return;
        showLoader(false);
        video.play().catch(function () {});
      }, { once: true });
      video.addEventListener('error', function () {
        if (currentPlaybackId !== pid) return;
        onPlaybackError();
      }, { once: true });
      video.addEventListener('playing', function () {
        if (currentPlaybackId !== pid) return;
        showLoader(false);
      });
    } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      hlsInstance = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 200 * 1000 * 1000,
        maxBufferHole: 0.5,
        enableWorker: true,
        lowLatencyMode: true,
        startFragPrefetch: true,
        backBufferLength: 20,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 500,
        levelLoadingRetryDelay: 500,
        fragLoadingRetryDelay: 500,
      });
      hlsInstance.loadSource(sourceUrl);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
        if (currentPlaybackId !== pid) return;
        populateQualityChips(hlsInstance ? hlsInstance.levels : null);
        showLoader(false);
        video.play().catch(function () {});
      });
      hlsInstance.on(Hls.Events.ERROR, function (e, data) {
        if (!data || !data.fatal) return;
        if (currentPlaybackId !== pid) return;
        hlsFatalRetries++;
        if (hlsFatalRetries <= 2) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            showLoader(true, 'Connection hiccup. Reconnecting...');
            try { hlsInstance.startLoad(); } catch (err) {}
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            showLoader(true, 'Video decode hiccup. Recovering...');
            try { hlsInstance.recoverMediaError(); } catch (err) {}
          } else {
            try { hlsInstance.destroy(); } catch (err) {}
            hlsInstance = null;
            onPlaybackError();
          }
          return;
        }
        try { hlsInstance.destroy(); } catch (err) {}
        hlsInstance = null;
        onPlaybackError();
      });
      video.addEventListener('playing', function () {
        if (currentPlaybackId !== pid) return;
        showLoader(false);
      });
    } else {
      customActive = false;
      video.style.display = 'none';
      showLoader(false);
      showPlayerError('HLS playback is not supported by this browser.');
    }
  }

  function stopVideoPlayback() {
    if (hlsInstance) {
      try { hlsInstance.stopLoad(); hlsInstance.destroy(); } catch (e) {}
      hlsInstance = null;
    }
    var activeVideo = document.getElementById('hls-video');
    if (activeVideo) {
      try { activeVideo.pause(); } catch (e) {}
      try {
        activeVideo.removeAttribute('src');
        if (activeVideo.srcObject) activeVideo.srcObject = null;
        activeVideo.load();
        activeVideo.currentTime = 0;
      } catch (e) {}
    }
    hidePlayerMenu();
    playerModal.classList.remove('controls-hidden');
  }

  function destroyCustomPlayer() {
    customActive = false;
    detachPlaybackEvents();
    stopVideoPlayback();
    destroyNetflixControls();
    var video = document.getElementById('hls-video');
    var iframe = document.getElementById('player-iframe');
    if (video) { video.style.display = 'none'; video.controls = false; }
    if (iframe) { iframe.style.display = 'block'; }
  }

  function setShield(show) {
    var el = document.getElementById('player-shield');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  function showLoader(show, status, progressOrSeconds) {
    var el = document.getElementById('player-loader');
    var statusEl = document.getElementById('loader-status');
    var fillEl = document.getElementById('loader-fill');
    var countEl = document.getElementById('loader-count');
    if (!el) return;
    el.classList.toggle('hidden', !show);
    if (!show) {
      loaderStart = 0;
      if (fillEl) fillEl.style.width = '0%';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (!loaderStart) loaderStart = Date.now();
    var spinner = el.querySelector('.spinner');
    var track = el.querySelector('.loader-track');
    if (spinner) spinner.style.display = '';
    if (track) track.style.display = '';
    if (status && statusEl) statusEl.textContent = status;
    if (progressOrSeconds && typeof progressOrSeconds === 'number' && progressOrSeconds > 0) {
      var pct = Math.max(0, Math.min(100, progressOrSeconds));
      if (fillEl) {
        fillEl.style.width = pct + '%';
        fillEl.classList.add('determinate');
      }
      if (countEl) {
        var elapsed = Math.max(1, (Date.now() - loaderStart) / 1000);
        var estTotal = (elapsed * 100) / pct;
        var remain = Math.max(1, Math.round(estTotal - elapsed));
        countEl.textContent = 'Estimated ~' + remain + 's remaining';
      }
    } else {
      if (fillEl) {
        fillEl.style.width = '30%';
        fillEl.classList.remove('determinate');
      }
      if (countEl) countEl.textContent = 'This may take up to 45 seconds';
    }
  }

  function showPlayerError(msg) {
    showLoader(false);
    stopVideoPlayback();
    var video = document.getElementById('hls-video');
    if (video) video.style.display = 'none';
    var el = document.getElementById('player-loader');
    if (!el) return;
    el.classList.remove('hidden');
    var spinner = el.querySelector('.spinner');
    var track = el.querySelector('.loader-track');
    if (spinner) spinner.style.display = 'none';
    if (track) track.style.display = 'none';
    var statusEl = document.getElementById('loader-status');
    if (statusEl) statusEl.textContent = msg || 'Stream could not be played.';
    var countEl = document.getElementById('loader-count');
    if (countEl) countEl.textContent = '';
  }

  // ===================== Netflix-style player controls =====================
  var controlsIdleTimer = null;
  var isScrubbing = false;
  var nfWired = false;
  var nfFlashTimer = null;
  var lastTapTime = 0;
  var lastTapX = 0;
  var lastTapY = 0;
  var tapTimerM = null;
  var SKIP_INTRO_END = 110;

  function getPlayerVideo() {
    return document.getElementById('hls-video');
  }

  function isTouchDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  function isPlayerActive() {
    return playerModal && playerModal.classList.contains('active');
  }

  function isMenuOpen() {
    var menu = document.getElementById('nf-menu');
    return menu && !menu.classList.contains('hidden');
  }

  function hidePlayerMenu() {
    var menu = document.getElementById('nf-menu');
    if (menu) menu.classList.add('hidden');
  }

  function showPlayerControls() {
    playerModal.classList.remove('controls-hidden');
    if (controlsIdleTimer) { clearTimeout(controlsIdleTimer); controlsIdleTimer = null; }
    var video = getPlayerVideo();
    if (video && !video.paused) {
      controlsIdleTimer = setTimeout(hidePlayerControls, 3000);
    }
  }

  function hidePlayerControls() {
    if (!isPlayerActive()) return;
    if (isScrubbing || isMenuOpen()) { showPlayerControls(); return; }
    var video = getPlayerVideo();
    if (!video || video.paused) return;
    playerModal.classList.add('controls-hidden');
  }

  function pokeControls() {
    showPlayerControls();
  }

  function toggleControlsVisibility() {
    if (playerModal.classList.contains('controls-hidden')) {
      showPlayerControls();
    } else {
      if (isMenuOpen()) hidePlayerMenu();
      if (!isScrubbing) playerModal.classList.add('controls-hidden');
    }
  }

  function flashNf(msg) {
    var el = document.getElementById('nf-flash');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'flex';
    if (nfFlashTimer) clearTimeout(nfFlashTimer);
    nfFlashTimer = setTimeout(function () { el.style.display = 'none'; }, 900);
  }

  function skipBy(sec, label) {
    var video = getPlayerVideo();
    if (!video) return;
    var nt = (video.currentTime || 0) + sec;
    if (isFinite(video.duration) && video.duration > 0) nt = Math.min(nt, video.duration);
    nt = Math.max(0, nt);
    try { video.currentTime = nt; } catch (e) {}
    if (label) flashNf(label);
    updateProgressUI();
  }

  function handleDoubleTap(x) {
    var w = window.innerWidth || 1;
    var r = x / w;
    if (r < 0.35) skipBy(-10, 'Rewind 10s');
    else if (r > 0.65) skipBy(10, 'Forward 10s');
    else togglePlayPause();
  }

  function togglePlayPause() {
    var video = getPlayerVideo();
    if (!video) return;
    if (video.paused) video.play().catch(function () {});
    else video.pause();
    showPlayerControls();
  }

  function updatePlayPauseUI() {
    var video = getPlayerVideo();
    var ic = document.getElementById('nf-play-ic');
    var center = document.getElementById('nf-center');
    var paused = !video || video.paused;
    if (ic) {
      ic.innerHTML = paused
        ? '<path d="M8 5v14l11-7z"/>'
        : '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    }
    if (center) center.style.display = paused ? 'flex' : 'none';
  }

  function updateProgressUI() {
    var video = getPlayerVideo();
    var played = document.getElementById('nf-played');
    var scrub = document.getElementById('nf-scrubber');
    var timeEl = document.getElementById('nf-time');
    if (!video || !played || !scrub) return;
    var dur = video.duration || 0;
    var t = video.currentTime || 0;
    var pct = dur > 0 ? (t / dur) * 100 : 0;
    played.style.width = pct + '%';
    scrub.style.left = pct + '%';
    if (timeEl) timeEl.textContent = fmtTime(t) + ' / ' + fmtTime(dur);
  }

  function updateBufferedUI() {
    var video = getPlayerVideo();
    var bufferedEl = document.getElementById('nf-buffered');
    if (!video || !bufferedEl) return;
    var dur = video.duration || 0;
    var pct = 0;
    if (dur > 0 && video.buffered && video.buffered.length) {
      pct = (video.buffered.end(video.buffered.length - 1) / dur) * 100;
    }
    bufferedEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function updateVolumeUI() {
    var video = getPlayerVideo();
    var volInput = document.getElementById('nf-vol');
    var ic = document.getElementById('nf-vol-ic');
    if (!video) return;
    var muted = video.muted || video.volume === 0;
    var v = muted ? 0 : video.volume;
    if (volInput) volInput.value = Math.round(v * 100);
    if (ic) {
      if (muted) {
        ic.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
      } else if (v < 0.5) {
        ic.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
      } else {
        ic.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
      }
    }
  }

  function changeVolumeBy(delta) {
    var video = getPlayerVideo();
    if (!video) return;
    var v = video.muted ? 0 : video.volume;
    v = Math.max(0, Math.min(1, v + delta));
    video.volume = v;
    video.muted = v === 0;
  }

  function toggleMute() {
    var video = getPlayerVideo();
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  }

  function seekByPercent(p) {
    var video = getPlayerVideo();
    if (!video) return;
    if (isFinite(video.duration) && video.duration > 0) {
      try { video.currentTime = p * video.duration; } catch (e) {}
    }
  }

  function toggleFullscreen() {
    var el = document.getElementById('player-modal') || document.documentElement;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(function () {});
    } else {
      var video = getPlayerVideo();
      if (video && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }
  }

  function updateFullscreenUI() {
    var ic = document.getElementById('nf-fs-ic');
    if (!ic) return;
    if (document.fullscreenElement) {
      ic.innerHTML = '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';
    } else {
      ic.innerHTML = '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
    }
  }

  function updateSkipIntro() {
    var btn = document.getElementById('nf-skip-intro');
    if (!btn) return;
    var show = false;
    var video = getPlayerVideo();
    if (video && currentMedia && currentMedia.type === 'tv') {
      var t = video.currentTime || 0;
      var d = video.duration || 0;
      if (t >= 5 && t < SKIP_INTRO_END && d > 180) show = true;
    }
    btn.style.display = show ? '' : 'none';
  }

  function skipIntroClick() {
    var video = getPlayerVideo();
    if (!video) return;
    try { video.currentTime = Math.min(video.duration || SKIP_INTRO_END, SKIP_INTRO_END); } catch (e) {}
    updateSkipIntro();
  }

  function buildSpeedMenu() {
    var wrap = document.getElementById('nf-speed-opts');
    if (!wrap) return;
    wrap.innerHTML = '';
    var opts = [0.5, 0.75, 1, 1.25, 1.5, 2];
    for (var i = 0; i < opts.length; i++) {
      var d = document.createElement('div');
      d.className = 'nf-menu-opt';
      d.setAttribute('data-kind', 'speed');
      d.setAttribute('data-value', String(opts[i]));
      d.textContent = opts[i] + 'x';
      wrap.appendChild(d);
    }
    updateSpeedMenuUI();
  }

  function updateSpeedMenuUI() {
    var wrap = document.getElementById('nf-speed-opts');
    if (!wrap) return;
    var video = getPlayerVideo();
    var rate = video ? video.playbackRate : 1;
    var opts = wrap.querySelectorAll('.nf-menu-opt');
    for (var i = 0; i < opts.length; i++) {
      var v = parseFloat(opts[i].getAttribute('data-value'));
      opts[i].classList.toggle('active', Math.abs(v - rate) < 0.001);
    }
  }

  function initNetflixControls() {
    if (nfWired) return;
    nfWired = true;

    var playBtn = document.getElementById('nf-play');
    var playBig = document.getElementById('nf-play-big');
    var skipIntro = document.getElementById('nf-skip-intro');
    var progress = document.getElementById('nf-progress');
    var tooltip = document.getElementById('nf-tooltip');
    var muteBtn = document.getElementById('nf-mute');
    var volInput = document.getElementById('nf-vol');
    var settingsBtn = document.getElementById('nf-settings-btn');
    var menu = document.getElementById('nf-menu');
    var pipBtn = document.getElementById('nf-pip');
    var fsBtn = document.getElementById('nf-fullscreen');
    var video = getPlayerVideo();

    if (playBtn) playBtn.addEventListener('click', togglePlayPause);
    if (playBig) playBig.addEventListener('click', togglePlayPause);
    if (skipIntro) skipIntro.addEventListener('click', skipIntroClick);

    function seekToPointer(e) {
      var vid = getPlayerVideo();
      if (!vid || !progress) return;
      var rect = progress.getBoundingClientRect();
      var r = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      r = Math.max(0, Math.min(1, r));
      if (isFinite(vid.duration) && vid.duration > 0) {
        try { vid.currentTime = r * vid.duration; } catch (err) {}
      }
      var played = document.getElementById('nf-played');
      var scrub = document.getElementById('nf-scrubber');
      var pct = r * 100;
      if (played) played.style.width = pct + '%';
      if (scrub) scrub.style.left = pct + '%';
    }

    function updateSeekTooltip(e) {
      var vid = getPlayerVideo();
      if (!vid || !tooltip || !progress) return;
      var rect = progress.getBoundingClientRect();
      var r = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      r = Math.max(0, Math.min(1, r));
      tooltip.style.left = (r * 100) + '%';
      tooltip.textContent = fmtTime(r * (vid.duration || 0));
      tooltip.style.opacity = '1';
    }

    if (progress) {
      progress.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        isScrubbing = true;
        progress.classList.add('dragging');
        if (progress.setPointerCapture) { try { progress.setPointerCapture(e.pointerId); } catch (err) {} }
        seekToPointer(e);
        e.preventDefault();
      });
      progress.addEventListener('pointermove', function (e) {
        updateSeekTooltip(e);
        if (isScrubbing) seekToPointer(e);
      });
      progress.addEventListener('pointerup', function (e) {
        if (isScrubbing) seekToPointer(e);
        isScrubbing = false;
        progress.classList.remove('dragging');
        if (progress.releasePointerCapture) { try { progress.releasePointerCapture(e.pointerId); } catch (err) {} }
        showPlayerControls();
      });
      progress.addEventListener('pointercancel', function () {
        isScrubbing = false;
        progress.classList.remove('dragging');
      });
      progress.addEventListener('pointerleave', function () {
        if (!isScrubbing && tooltip) tooltip.style.opacity = '0';
      });
    }

    if (muteBtn) muteBtn.addEventListener('click', function () {
      var vid = getPlayerVideo();
      if (!vid) return;
      vid.muted = !vid.muted;
      if (!vid.muted && vid.volume === 0) vid.volume = 0.5;
      updateVolumeUI();
      showPlayerControls();
    });
    if (volInput) volInput.addEventListener('input', function () {
      var vid = getPlayerVideo();
      if (!vid) return;
      var val = parseInt(volInput.value, 10) / 100;
      vid.volume = val;
      vid.muted = val === 0;
      updateVolumeUI();
    });

    if (settingsBtn && menu) {
      settingsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var hidden = menu.classList.contains('hidden');
        hidePlayerMenu();
        if (hidden) {
          menu.classList.remove('hidden');
          showPlayerControls();
        }
      });
      menu.addEventListener('click', function (e) {
        var opt = e.target.closest ? e.target.closest('.nf-menu-opt') : null;
        if (!opt) return;
        var kind = opt.getAttribute('data-kind');
        var value = opt.getAttribute('data-value');
        if (kind === 'speed') {
          var sp = parseFloat(value);
          var vid = getPlayerVideo();
          if (vid && isFinite(sp)) { vid.playbackRate = sp; updateSpeedMenuUI(); flashNf('Speed ' + sp + 'x'); }
        }
        showPlayerControls();
      });
    }
    document.addEventListener('click', function (e) {
      if (menu && !e.target.closest('.nf-settingswrap') && !menu.classList.contains('hidden')) {
        hidePlayerMenu();
      }
    });

    if (pipBtn) {
      var supportsPip = document.pictureInPictureEnabled && video && typeof video.requestPictureInPicture === 'function' && !/iP(hone|ad|od)/.test(navigator.userAgent);
      pipBtn.style.display = supportsPip ? '' : 'none';
      pipBtn.addEventListener('click', function () {
        var vid = getPlayerVideo();
        if (!vid) return;
        if (document.pictureInPictureElement) {
          if (document.exitPictureInPicture) document.exitPictureInPicture().catch(function () {});
        } else if (vid.requestPictureInPicture) {
          vid.requestPictureInPicture().catch(function () {
            flashNf('PiP unavailable');
          });
        }
      });
    }
    if (video) {
      video.addEventListener('enterpictureinpicture', function () { if (pipBtn) pipBtn.classList.add('active'); });
      video.addEventListener('leavepictureinpicture', function () { if (pipBtn) pipBtn.classList.remove('active'); });
    }

    if (fsBtn) fsBtn.addEventListener('click', function () {
      toggleFullscreen();
      showPlayerControls();
    });

    if (video) {
      video.addEventListener('timeupdate', function () {
        if (!isScrubbing) updateProgressUI();
        updateSkipIntro();
      });
      video.addEventListener('progress', updateBufferedUI);
      video.addEventListener('play', function () { updatePlayPauseUI(); showPlayerControls(); });
      video.addEventListener('pause', function () { updatePlayPauseUI(); showPlayerControls(); });
      video.addEventListener('volumechange', updateVolumeUI);
      video.addEventListener('durationchange', updateProgressUI);
      video.addEventListener('seeking', function () { if (!isScrubbing) updateProgressUI(); });
      video.addEventListener('seeked', updateProgressUI);
      video.addEventListener('ended', showPlayerControls);
    }

    document.addEventListener('fullscreenchange', updateFullscreenUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUI);

    if (playerModal) {
      playerModal.addEventListener('mousemove', pokeControls);
      playerModal.addEventListener('keydown', pokeControls);
    }

    if (video) {
      video.addEventListener('click', function () {
        if (isTouchDevice()) return;
        toggleControlsVisibility();
      });
      if (isTouchDevice()) {
        video.addEventListener('touchstart', function (e) {
          if (e.touches.length !== 1) return;
          var now = Date.now();
          var touch = e.touches[0];
          var x = touch.clientX;
          var dt = now - lastTapTime;
          var dx = Math.abs(x - lastTapX);
          var dy = Math.abs(touch.clientY - lastTapY);
          if (dt < 320 && dx < 40 && dy < 40) {
            if (tapTimerM) clearTimeout(tapTimerM);
            lastTapTime = 0;
            e.preventDefault();
            handleDoubleTap(x);
          } else {
            lastTapTime = now;
            lastTapX = x;
            lastTapY = touch.clientY;
            if (tapTimerM) clearTimeout(tapTimerM);
            tapTimerM = setTimeout(function () { toggleControlsVisibility(); }, 320);
          }
        }, { passive: false });
      }
    }

    buildSpeedMenu();
    updatePlayPauseUI();
    updateVolumeUI();
    updateProgressUI();
    updateBufferedUI();
    updateFullscreenUI();
    updateSkipIntro();
  }

  function destroyNetflixControls() {
    if (controlsIdleTimer) { clearTimeout(controlsIdleTimer); controlsIdleTimer = null; }
    hidePlayerMenu();
    if (playerModal) playerModal.classList.remove('controls-hidden');
    updatePlayPauseUI();
  }

  var STREAM_CACHE_TTL = 24 * 60 * 60 * 1000;
  var STREAM_CACHE_VERSION = 'v6';
  var STREAM_CACHE_VERSION_KEY = 'asfr_stream_cache_version';

  function clearLegacyStreamCache() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('asfr_hls_') === 0) keys.push(key);
      }
      for (var j = 0; j < keys.length; j++) localStorage.removeItem(keys[j]);
      localStorage.setItem(STREAM_CACHE_VERSION_KEY, STREAM_CACHE_VERSION);
    } catch (e) {}
  }

  function ensureStreamCacheFresh() {
    try {
      if (localStorage.getItem(STREAM_CACHE_VERSION_KEY) !== STREAM_CACHE_VERSION) {
        clearLegacyStreamCache();
      }
    } catch (e) {
      clearLegacyStreamCache();
    }
  }

  function streamCacheKey(type, id, season, episode) {
    return 'asfr_hls_' + STREAM_CACHE_VERSION + '_' + type + '_' + id + '_' + (season || 1) + '_' + (episode || 1);
  }

  function streamCacheGet(type, id, season, episode) {
    try {
      var raw = localStorage.getItem(streamCacheKey(type, id, season, episode));
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || !entry.url || !entry.t) return null;
      if (Date.now() - entry.t > STREAM_CACHE_TTL) {
        localStorage.removeItem(streamCacheKey(type, id, season, episode));
        return null;
      }
      return entry;
    } catch (e) { return null; }
  }

  function streamCacheSet(type, id, season, episode, url, source, direct) {
    try {
      localStorage.setItem(streamCacheKey(type, id, season, episode), JSON.stringify({
        url: url,
        source: source || 'TorBox',
        direct: !!direct,
        t: Date.now()
      }));
    } catch (e) {}
  }

  function streamCacheRemove(type, id, season, episode) {
    try { localStorage.removeItem(streamCacheKey(type, id, season, episode)); } catch (e) {}
  }

  function isBozoErrorMsg(err) {
    if (!err) return false;
    if (err.bozo) return true;
    var code = String(err.torboxError || err.code || '');
    var txt = String(err.error || err.message || '');
    return code.toUpperCase().indexOf('BOZO') !== -1 || txt.toUpperCase().indexOf('BOZO') !== -1 || txt.toUpperCase().indexOf('BAD FILE') !== -1;
  }

  function handleCustomPlayerFailure(err) {
    if (isBozoErrorMsg(err) && currentMedia && currentMedia.item) {
      var blockedId = currentMedia.item.id;
      blockItemNow(blockedId);
      if (blockedId) {
        var blockedCards = document.querySelectorAll('.card[data-id="' + blockedId + '"], .top-card[data-id="' + blockedId + '"]');
        for (var bi = 0; bi < blockedCards.length; bi++) {
          var bc = blockedCards[bi];
          if (bc && bc.parentNode) bc.parentNode.removeChild(bc);
        }
      }
      showPlayerError('This title is not available right now.');
      return;
    }
    if (currentMedia) {
      streamCacheRemove(currentMedia.type, currentMedia.item.id,
        seasonSelect ? seasonSelect.value || 1 : 1,
        episodeSelect ? episodeSelect.value || 1 : 1);
      clearSourceCache();
    }
    var msg = '';
    if (err && err.error) msg = err.error;
    else if (err && err.message) msg = err.message;
    if (!msg) msg = 'Stream could not be played. Please try again.';
    showPlayerError(msg);
  }

  function onPlaybackError() {
    if (currentPlaybackId !== null && currentMedia && currentMedia.type === 'tv' && nextEpisode()) return;
    handleCustomPlayerFailure();
  }

  function onPlaybackEnded() {
    saveProgress(true);
    if (currentMedia && currentMedia.type === 'tv') nextEpisode();
  }

  function onTimeUpdate() {
    var now = Date.now();
    if (now - lastProgressSave < PLAYBACK_SAVE_INTERVAL) return;
    lastProgressSave = now;
    saveProgress(false);
    var video = document.getElementById('hls-video');
    if (!video) return;
    if (currentMedia && currentMedia.type === 'tv' && isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration * 0.8) {
      prewarmNextEpisode();
    }
  }

  function attachPlaybackEvents() {
    var video = document.getElementById('hls-video');
    if (!video) return;
    video.addEventListener('ended', onPlaybackEnded);
    video.addEventListener('timeupdate', onTimeUpdate);
  }

  function detachPlaybackEvents() {
    var video = document.getElementById('hls-video');
    if (!video) return;
    video.removeEventListener('ended', onPlaybackEnded);
    video.removeEventListener('timeupdate', onTimeUpdate);
  }

  var PROGRESS_KEY = 'asfr_progress';
  var PROGRESS_MAX = 120;
  var PROGRESS_TTL = 7 * 24 * 60 * 60 * 1000;

  function progressKey(type, id, s, e) {
    return type + ':' + id + ':' + (s || 1) + ':' + (e || 1);
  }

  function progressGet(type, id, s, e) {
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return null;
      var map = JSON.parse(raw);
      var entry = map[progressKey(type, id, s, e)];
      if (!entry) return null;
      if (Date.now() - entry.t > PROGRESS_TTL) {
        delete map[progressKey(type, id, s, e)];
        persistProgress(map);
        return null;
      }
      return entry;
    } catch (err) { return null; }
  }

  function persistProgress(map) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(map)); } catch (err) {}
  }

  function removeProgress(type, id, s, e) {
    try {
      var map = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      delete map[progressKey(type, id, s, e)];
      persistProgress(map);
    } catch (err) {}
  }

  function saveProgress(final) {
    if (!currentMedia) return;
    var video = document.getElementById('hls-video');
    if (!video) return;
    var dur = video.duration;
    if (!isFinite(dur) || dur <= 0) return;
    var pos = video.currentTime;
    var pct = pos / dur;
    if (pct >= 0.98) {
      if (final) removeProgress(currentMedia.type, currentMedia.item.id, currentMedia.s || 1, currentMedia.e || 1);
      return;
    }
    if (pct < 0.02) return;
    try {
      var map = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      map[progressKey(currentMedia.type, currentMedia.item.id, currentMedia.s || 1, currentMedia.e || 1)] = {
        pos: pos,
        dur: dur,
        t: Date.now(),
        title: currentMedia.item.title || currentMedia.item.name || '',
        poster: currentMedia.item.poster_path || currentMedia.item.backdrop_path || ''
      };
      var keys = Object.keys(map);
      if (keys.length > PROGRESS_MAX) {
        keys.sort(function (a, b) { return map[a].t - map[b].t; });
        for (var i = 0; i < keys.length - PROGRESS_MAX; i++) delete map[keys[i]];
      }
      persistProgress(map);
    } catch (err) {}
  }

  function resumeFromCache(video) {
    if (!currentMedia || !video) return;
    var prog = progressGet(currentMedia.type, currentMedia.item.id, currentMedia.s || 1, currentMedia.e || 1);
    if (prog && prog.pos > 15 && prog.pos < (prog.dur || Infinity) * 0.96) {
      try { video.currentTime = prog.pos; } catch (err) {}
    }
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    if (m >= 60) {
      var h = Math.floor(m / 60);
      m = m % 60;
      return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function nextEpisode() {
    if (!currentMedia || currentMedia.type !== 'tv' || !episodeSelect || !seasonSelect) return false;
    var curEp = parseInt(episodeSelect.value, 10) || 0;
    var options = Array.prototype.slice.call(episodeSelect.options);
    var idx = -1;
    for (var i = 0; i < options.length; i++) {
      if (parseInt(options[i].value, 10) === curEp) { idx = i; break; }
    }
    if (idx >= 0 && idx < options.length - 1) {
      episodeSelect.value = options[idx + 1].value;
      episodeSelect.dispatchEvent(new Event('change'));
      return true;
    }
    var seasons = Array.prototype.slice.call(seasonSelect.options).map(function (o) { return parseInt(o.value, 10); }).sort(function (a, b) { return a - b; });
    var sIdx = seasons.indexOf(parseInt(seasonSelect.value, 10));
    if (sIdx >= 0 && sIdx < seasons.length - 1) {
      seasonSelect.value = seasons[sIdx + 1].toString();
      seasonSelect.dispatchEvent(new Event('change'));
      return true;
    }
    return false;
  }

  function prevEpisode() {
    if (!currentMedia || currentMedia.type !== 'tv' || !episodeSelect || !seasonSelect) return false;
    var curEp = parseInt(episodeSelect.value, 10) || 0;
    var options = Array.prototype.slice.call(episodeSelect.options);
    var idx = -1;
    for (var i = 0; i < options.length; i++) {
      if (parseInt(options[i].value, 10) === curEp) { idx = i; break; }
    }
    if (idx > 0) {
      episodeSelect.value = options[idx - 1].value;
      episodeSelect.dispatchEvent(new Event('change'));
      return true;
    }
    var seasons = Array.prototype.slice.call(seasonSelect.options).map(function (o) { return parseInt(o.value, 10); }).sort(function (a, b) { return a - b; });
    var sIdx = seasons.indexOf(parseInt(seasonSelect.value, 10));
    if (sIdx > 0) {
      seasonSelect.value = seasons[sIdx - 1].toString();
      seasonSelect.dispatchEvent(new Event('change'));
      return true;
    }
    return false;
  }

  function getNextEpisodeRef() {
    if (!currentMedia || currentMedia.type !== 'tv' || !episodeSelect || !seasonSelect) return null;
    var curEp = parseInt(episodeSelect.value, 10) || 0;
    var options = Array.prototype.slice.call(episodeSelect.options);
    var idx = -1;
    for (var i = 0; i < options.length; i++) {
      if (parseInt(options[i].value, 10) === curEp) { idx = i; break; }
    }
    if (idx >= 0 && idx < options.length - 1) {
      return { s: parseInt(seasonSelect.value, 10) || 1, e: parseInt(options[idx + 1].value, 10) };
    }
    var seasons = Array.prototype.slice.call(seasonSelect.options).map(function (o) { return parseInt(o.value, 10); }).sort(function (a, b) { return a - b; });
    var sIdx = seasons.indexOf(parseInt(seasonSelect.value, 10));
    if (sIdx >= 0 && sIdx < seasons.length - 1) {
      return { s: seasons[sIdx + 1], e: 1 };
    }
    return null;
  }

  function prewarmNextEpisode() {
    if (!currentMedia || currentMedia.type !== 'tv') return;
    if (prewarmInFlight) return;
    if (!currentMedia.item) return;
    var ref = getNextEpisodeRef();
    if (!ref) return;
    var pid = currentPlaybackId;
    if (nextPrefetchedFor === pid) return;
    if (streamCacheGet('tv', currentMedia.item.id, ref.s, ref.e)) { nextPrefetchedFor = pid; return; }
    nextPrefetchedFor = pid;
    prewarmInFlight = true;
    resolveHybridStream(currentMedia.item, 'tv', ref.s, ref.e, 0, true).then(function (data) {
      if (currentPlaybackId !== pid) return;
      if (data && (data.hlsUrl || data.directUrl)) {
        streamCacheSet('tv', currentMedia.item.id, ref.s, ref.e, data.hlsUrl || data.directUrl, data.source || 'TorBox', !!data.directUrl);
      }
    }).catch(function () {}).then(function () {
      prewarmInFlight = false;
    });
  }

  function updatePlayNextButton() {
    var btn = document.getElementById('player-next');
    if (!btn) return;
    if (!currentMedia || currentMedia.type !== 'tv') { btn.style.display = 'none'; return; }
    btn.style.display = getNextEpisodeRef() ? '' : 'none';
  }

  function clearSourceCache() {
    sourceCache.url = null;
    sourceCache.hlsUrl = null;
    sourceCache.directUrl = null;
    sourceCache.direct = false;
    sourceCache.ready = false;
    sourceCache.source = '';
    sourceCache.warm = false;
  }

  function browserScrapeStreams(imdbId, type, season, episode) {
    var path = type === 'tv'
      ? 'https://torrentio.strem.fun/stream/series/' + imdbId + ':' + season + ':' + episode + '.json'
      : 'https://torrentio.strem.fun/stream/movie/' + imdbId + '.json';
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 45000);
    return fetch(path, { signal: controller.signal }).then(function (r) {
      clearTimeout(timeout);
      if (!r.ok) throw new Error('scraper status ' + r.status);
      return r.json();
    }).then(function (data) {
      var out = [];
      var seen = {};
      (data.streams || []).forEach(function (s) {
        var h = String(s.infoHash || '').trim().toLowerCase();
        if (!/^[0-9a-f]{40}$/.test(h)) return;
        if (seen[h]) return;
        seen[h] = true;
        out.push({ hash: h, title: s.title || '' });
      });
      return out;
    }).catch(function (err) {
      clearTimeout(timeout);
      throw err;
    });
  }

  function fetchJson(url, options, contextLabel) {
    return fetch(url, options).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (err) {
          var snippet = (text || '').trim().slice(0, 120);
          throw new Error((contextLabel || 'Server') + ' returned non-JSON response' + (snippet ? ': ' + snippet : ''));
        }
        if (!r.ok) {
          throw data && data.error ? data : new Error((contextLabel || 'Server') + ' request failed with status ' + r.status);
        }
        return data;
      });
    });
  }

  function isRetryableStreamError(err) {
    var msg = '';
    if (err && typeof err === 'string') msg = err;
    else if (err && err.error) msg = err.error;
    else if (err && err.message) msg = err.message;
    msg = String(msg || '').toLowerCase();
    return msg.indexOf('timed out') !== -1 || msg.indexOf('retrying in the app') !== -1 || msg.indexOf('server error has occurred') !== -1;
  }

  function retryAfterDelay(fn, delayMs) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(fn());
      }, delayMs);
    });
  }

  function resolveHybridStream(item, type, sNum, eNum, retryCount, silent) {
    return new Promise(function (resolve, reject) {
      var timeoutRetries = retryCount || 0;
      var quiet = !!silent;
      var url = '/api/torbox-source?tmdbId=' + item.id + '&type=' + type;
      if (type === 'tv') url += '&season=' + sNum + '&episode=' + eNum;
      if (forceRefresh) url += '&refresh=1';

      function scrapeAndDownload(imdbId) {
        if (!quiet) showLoader(true, 'Searching torrent sources (first lookup can take up to ~45s)...');
        browserScrapeStreams(imdbId, type, sNum, eNum).then(function (streams) {
          if (!streams || !streams.length) throw new Error('no torrents found');
          return fetchJson('/api/torbox-source', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tmdbId: item.id,
              type: type,
              season: sNum,
              episode: eNum,
              imdbId: imdbId,
              streams: streams,
              download: true
            })
          }, 'TorBox stream create');
        }).then(function (data) {
          if (data && data.downloading && data.torrentId) {
            return pollTorrentStream(item, type, sNum, eNum, data.torrentId, data.torrentHash, data.torrentTitle, quiet);
          }
          if (!data || (!data.hlsUrl && !data.directUrl)) throw new Error('No cached torrent');
          return data;
        }).then(function (data) {
          resolve(data);
        }).catch(function (e2) {
          reject(e2);
        });
      }

      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 90000);

      fetchJson(url, { signal: controller.signal, cache: 'no-store' }, 'TorBox stream lookup').then(function (data) {
        clearTimeout(timeout);
        if (!data.hlsUrl && !data.directUrl) throw new Error('No stream URL');
        resolve(data);
      }).catch(function (err) {
        clearTimeout(timeout);
        if (isRetryableStreamError(err) && timeoutRetries < 1) {
          if (!quiet) showLoader(true, 'Stream is still preparing. Retrying...');
          retryAfterDelay(function () {
            return resolveHybridStream(item, type, sNum, eNum, timeoutRetries + 1, quiet).then(resolve, reject);
          }, 3000).catch(reject);
          return;
        }
        var imdbId = err && err.imdbId;
        if (!imdbId) { reject(err); return; }
        scrapeAndDownload(imdbId);
      });
    });
  }

  function pollTorrentStream(item, type, sNum, eNum, torrentId, torrentHash, torrentTitle, silent) {
    return new Promise(function (resolve, reject) {
      var quiet = !!silent;
      var curTorrentId = torrentId;
      var curHash = torrentHash || '';
      var curTitle = torrentTitle || '';

      function buildUrl() {
        var url = '/api/torbox-source?tmdbId=' + item.id + '&type=' + type;
        if (type === 'tv') url += '&season=' + sNum + '&episode=' + eNum;
        url += '&action=progress&torrentId=' + encodeURIComponent(curTorrentId);
        if (curHash) url += '&hash=' + encodeURIComponent(curHash);
        if (curTitle) url += '&title=' + encodeURIComponent(String(curTitle).slice(0, 150));
        return url;
      }

      var started = Date.now();
      var MAX_WAIT = 10 * 60 * 1000;
      var POLL_INTERVAL = 4000;
      var lastPct = 0;
      var failures = 0;

      function tick() {
        if (Date.now() - started > MAX_WAIT) {
          reject(new Error('Download is taking too long. Try again later.'));
          return;
        }
          if (!quiet) showLoader(true, 'Preparing stream... ' + lastPct + '%', lastPct);
        var controller = new AbortController();
        var t = setTimeout(function () { controller.abort(); }, 9000);
        fetchJson(buildUrl(), { signal: controller.signal, cache: 'no-store' }, 'TorBox progress poll').then(function (data) {
          clearTimeout(t);
          if (data && (data.hlsUrl || data.directUrl)) { resolve(data); return; }
          if (data && data.downloading && data.torrentId && String(data.torrentId) !== String(curTorrentId)) {
            curTorrentId = data.torrentId;
            curHash = data.torrentHash || '';
            curTitle = data.torrentTitle || '';
            lastPct = 0;
          }
          if (data && typeof data.progress === 'number') lastPct = Math.round(data.progress);
        if (!quiet) showLoader(true, 'Preparing stream... ' + lastPct + '%', lastPct);
          setTimeout(tick, POLL_INTERVAL);
        }).catch(function (err) {
          clearTimeout(t);
          failures++;
          if (isRetryableStreamError(err)) {
            if (!quiet) showLoader(true, 'Stream is still preparing. Retrying...');
            setTimeout(tick, POLL_INTERVAL);
            return;
          }
          if (Date.now() - started <= MAX_WAIT && failures < 4) {
            setTimeout(tick, POLL_INTERVAL);
          } else {
            reject(err);
          }
        });
      }
      tick();
    });
  }

  function preFetchSource(item, type, season, episode) {
    if (!item || !item.id) return Promise.reject(new Error('no item'));
    if (isFutureRelease(item)) return Promise.resolve();
    var sNum = season || 1;
    var eNum = episode || 1;
    var url = '/api/torbox-source?tmdbId=' + item.id + '&type=' + type;
    if (type === 'tv') url += '&season=' + sNum + '&episode=' + eNum;

    if (prefetchPromises[url]) return prefetchPromises[url];

    var cached = streamCacheGet(type, item.id, sNum, eNum);
    if (cached) {
      sourceCache.hlsUrl = cached.direct ? null : cached.url;
      sourceCache.directUrl = cached.direct ? cached.url : null;
      sourceCache.direct = !!cached.direct;
      sourceCache.source = cached.source || 'TorBox';
      sourceCache.url = url;
      sourceCache.ready = true;
      sourceCache.warm = true;
      return Promise.resolve();
    }

    prefetchInFlight[url] = true;
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 90000);
    var p = fetchJson(url, { signal: controller.signal, cache: 'no-store' }, 'TorBox prefetch').then(function (data) {
      if (!data.hlsUrl && !data.directUrl) throw new Error('No stream URL');
      sourceCache.hlsUrl = data.hlsUrl || null;
      sourceCache.directUrl = data.directUrl || null;
      sourceCache.direct = !!data.directUrl;
      sourceCache.source = data.source || 'TorBox';
      sourceCache.url = url;
      sourceCache.ready = true;
      sourceCache.warm = true;
      streamCacheSet(type, item.id, sNum, eNum, data.hlsUrl || data.directUrl, data.source || 'TorBox', !!data.directUrl);
    }).finally(function () {
      clearTimeout(timeout);
      delete prefetchInFlight[url];
      delete prefetchPromises[url];
    });
    prefetchPromises[url] = p;
    return p;
  }

  function scheduleHoverPrefetch(item, mediaType, cardEl) {
    if (!item || !item.id || !cardEl) return;
    if (cardEl._hoverTimer) {
      clearTimeout(cardEl._hoverTimer);
      cardEl._hoverTimer = null;
    }
    cardEl._hoverTimer = setTimeout(function () {
      cardEl._hoverTimer = null;
      var badge = cardEl.querySelector('.card-warm-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'card-warm-badge';
        badge.textContent = 'Preloading';
        cardEl.appendChild(badge);
      }
      cardEl.classList.add('card--warming');
      preFetchSource(item, mediaType).then(function () {
        cardEl.classList.remove('card--warming');
        badge.textContent = 'Ready';
        badge.classList.add('card-warm-badge--ready');
        setTimeout(function () { badge.remove(); }, 1200);
      }, function () {
        cardEl.classList.remove('card--warming');
        badge.remove();
      });
    }, 300);
  }

  function attemptCustomPlayer() {
    var requestId = ++currentStreamRequestId;
    return new Promise(function (resolve, reject) {
      if (!currentMedia) { reject(); return; }
      var item = currentMedia.item;
      var type = currentMedia.type;
      var sNum = seasonSelect ? seasonSelect.value || 1 : 1;
      var eNum = episodeSelect ? episodeSelect.value || 1 : 1;
      currentMedia.s = sNum;
      currentMedia.e = eNum;
      var url = '/api/torbox-source?tmdbId=' + item.id + '&type=' + type;
      if (type === 'tv') url += '&season=' + sNum + '&episode=' + eNum;
      if (forceRefresh) url += '&refresh=1';

      function runHybrid() {
        if (requestId !== currentStreamRequestId) return;
        showLoader(true, 'Loading stream...');
        resolveHybridStream(item, type, sNum, eNum).then(function (data) {
          if (requestId !== currentStreamRequestId) return;
          forceRefresh = false;
          sourceCache.hlsUrl = data.hlsUrl || null;
          sourceCache.directUrl = data.directUrl || null;
          sourceCache.direct = !!data.directUrl;
          sourceCache.source = data.source || 'TorBox';
          sourceCache.url = url;
          sourceCache.ready = true;
          sourceCache.warm = false;
          streamCacheSet(type, item.id, sNum, eNum, data.hlsUrl || data.directUrl, data.source || 'TorBox', !!data.directUrl);
          initCustomPlayer(data.hlsUrl || data.directUrl, data.source || 'TorBox', !!data.directUrl);
          resolve();
        }).catch(function (err) {
          if (requestId !== currentStreamRequestId) return;
          forceRefresh = false;
          reject(err);
        });
      }

      var pf = prefetchPromises[url];
      if (pf) {
        if (requestId !== currentStreamRequestId) return;
        showLoader(true, 'Loading stream...');
        pf.then(function () {
          if (requestId !== currentStreamRequestId) return;
          sourceCache.warm = true;
          if (sourceCache.ready && (sourceCache.hlsUrl || sourceCache.directUrl) && sourceCache.url === url) {
            initCustomPlayer(sourceCache.hlsUrl || sourceCache.directUrl, sourceCache.source, sourceCache.direct);
            resolve();
          } else {
            runHybrid();
          }
        }, function () {
          runHybrid();
        });
        return;
      }

      if (!forceRefresh && sourceCache.url === url && sourceCache.ready && (sourceCache.hlsUrl || sourceCache.directUrl)) {
        if (requestId !== currentStreamRequestId) return;
        initCustomPlayer(sourceCache.hlsUrl || sourceCache.directUrl, sourceCache.source, sourceCache.direct);
        resolve(); return;
      }

      var cached = !forceRefresh ? streamCacheGet(type, item.id, sNum, eNum) : null;
      if (cached && cached.url) {
        if (requestId !== currentStreamRequestId) return;
        sourceCache.hlsUrl = cached.direct ? null : cached.url;
        sourceCache.directUrl = cached.direct ? cached.url : null;
        sourceCache.direct = !!cached.direct;
        sourceCache.source = cached.source || 'TorBox';
        sourceCache.url = url;
        sourceCache.ready = true;
        sourceCache.warm = true;
        initCustomPlayer(cached.url, cached.source || 'TorBox', !!cached.direct);
        resolve(); return;
      }

      runHybrid();
    });
  }

  function openPlayer(item, mediaType) {
    if (isBlockedItem(item)) return;
    if (isFutureRelease(item)) {
      showPlayerError('Available on a future date upon official release');
      return;
    }
    currentMedia = { item: item, type: mediaType };
    currentPlaybackId = newPlaybackId();
    currentStreamRequestId = currentPlaybackId;
    playerTitle.textContent = item.title || item.name || '';
    var subtitleEl = document.getElementById('player-subtitle');
    if (subtitleEl) subtitleEl.textContent = mediaType === 'tv' ? 'Season 1 · Episode 1' : '';
    playerIframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    playerIframe.style.cssText = 'width:100%; height:100%; border:0; display:block;';

    stopVideoPlayback();
    document.getElementById('hls-video').style.display = 'none';
    playerIframe.src = 'about:blank';

    if (mediaType === 'tv') {
      tvControls.style.display = 'flex';
      setupTVControls(item.id);
      showLoader(true, 'Loading stream...');
    } else {
      tvControls.style.display = 'none';
      var sNum = 1;
      var eNum = 1;
      var warm = streamCacheGet(mediaType, item.id, sNum, eNum);
      if (warm && warm.url) {
        sourceCache.hlsUrl = warm.direct ? null : warm.url;
        sourceCache.directUrl = warm.direct ? warm.url : null;
        sourceCache.direct = !!warm.direct;
        sourceCache.source = warm.source || 'TorBox';
        sourceCache.url = '/api/torbox-source?tmdbId=' + item.id + '&type=movie';
        sourceCache.ready = true;
        sourceCache.warm = true;
        initCustomPlayer(warm.url, warm.source || 'TorBox', !!warm.direct);
      } else {
        showLoader(true, 'Loading stream...');
        attemptCustomPlayer().catch(function (err) {
          handleCustomPlayerFailure(err);
        });
      }
    }
    playerModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function showOverlay() {
    var overlay = document.getElementById('player-overlay');
    if (!overlay) return;
    overlay.classList.add('active');
    setTimeout(function () {
      overlay.classList.remove('active');
    }, 1500);
  }

  function closePlayer() {
    currentPlaybackId = null;
    currentStreamRequestId++;
    destroyCustomPlayer();
    saveProgress(true);
    renderContinueWatching();
    clearSourceCache();
    playerIframe.src = 'about:blank';
    playerModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function handlePlayerBackdropClick(e) {
    if (e.target === playerModal) {
      closePlayer();
    }
  }

  function setupTVControls(tvId) {
    seasonSelect.innerHTML = '<option value="">Loading...</option>';
    fetchTMDB('/tv/' + tvId).then(function (tvData) {
      seasonSelect.innerHTML = '';
      var seasons = (tvData.seasons || []).filter(function(s) { return s.season_number > 0; });
      seasons.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.season_number;
        opt.textContent = s.name || ('Season ' + s.season_number);
        seasonSelect.appendChild(opt);
      });
      if (seasons.length) {
        var sNum = (resumeTarget && resumeTarget.type === 'tv' && resumeTarget.s) ? resumeTarget.s : seasons[0].season_number;
        seasonSelect.value = sNum;
        updateEpisodes(tvId, sNum);
      }
    });
  }

  function updateEpisodes(tvId, seasonNum) {
    episodeSelect.innerHTML = '<option value="">Loading...</option>';
    fetchTMDB('/tv/' + tvId + '/season/' + seasonNum).then(function (seasonData) {
      episodeSelect.innerHTML = '';
      var episodes = seasonData.episodes || [];
      episodes.forEach(function (ep) {
        var opt = document.createElement('option');
        opt.value = ep.episode_number;
        opt.textContent = 'E' + ep.episode_number + ' - ' + ep.name;
        episodeSelect.appendChild(opt);
      });
      if (resumeTarget && resumeTarget.type === 'tv') {
        episodeSelect.value = resumeTarget.e;
        resumeTarget = null;
      }
      var subtitleEl = document.getElementById('player-subtitle');
      if (subtitleEl) {
        subtitleEl.textContent = 'Season ' + seasonNum + ' · Episode ' + (episodeSelect.value || 1);
      }
      currentPlaybackId = newPlaybackId();
      currentStreamRequestId = currentPlaybackId;
      attemptCustomPlayer().catch(function (err) {
        handleCustomPlayerFailure(err);
      });
    });
  }

  function toggleSearch() {
    searchBar.classList.toggle('active');
    if (searchBar.classList.contains('active')) searchInput.focus();
    else clearSearchResults();
  }

  function openSearchOverlay() {
    var overlay = document.getElementById('search-overlay');
    var input = document.getElementById('search-overlay-input');
    if (!overlay || !input) return;
    overlay.classList.remove('hidden');
    input.value = '';
    var results = document.getElementById('search-overlay-results');
    if (results) results.innerHTML = '';
    document.body.style.overflow = 'hidden';
    setTimeout(function () { input.focus(); }, 50);
  }

  function closeSearchOverlay() {
    var overlay = document.getElementById('search-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function handleOverlaySearch() {
    var input = document.getElementById('search-overlay-input');
    var results = document.getElementById('search-overlay-results');
    if (!input || !results) return;
    var query = input.value.trim();
    clearTimeout(searchOverlayTimeout);
    if (query.length < 2) {
      results.innerHTML = '';
      return;
    }
    searchOverlayTimeout = setTimeout(function () {
      fetchTMDB('/search/multi?query=' + encodeURIComponent(query) + '&include_adult=false').then(function (items) {
        var filtered = items.filter(function (r) { return r.media_type === 'movie' || r.media_type === 'tv'; });
        results.innerHTML = '';
        if (!filtered.length) {
          var empty = document.createElement('div');
          empty.className = 'search-empty';
          empty.textContent = 'No results found.';
          results.appendChild(empty);
          return;
        }
        var grid = document.createElement('div');
        grid.className = 'search-results-grid';
        for (var oi = 0; oi < filtered.length; oi++) {
          var oCard = createCard(filtered[oi], filtered[oi].media_type);
          if (oCard) grid.appendChild(oCard);
        }
        results.appendChild(grid);
      });
    }, 350);
  }

  function handleMobileNav(action) {
    if (action === 'home') {
      setFilter('all');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'search') {
      openSearchOverlay();
    } else if (action === 'library') {
      var cw = document.getElementById('continue-watching');
      if (cw) cw.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleSearch() {
    var query = searchInput.value.trim();
    if (query.length < 2) { clearSearchResults(); return; }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () {
      fetchTMDB('/search/multi?query=' + encodeURIComponent(query) + '&include_adult=false').then(function (results) {
        var filtered = results.filter(function (r) { return r.media_type === 'movie' || r.media_type === 'tv'; });
        renderSearchResults(query, filtered);
      });
    }, 400);
  }

  function renderSearchResults(query, items) {
    clearSearchResults();
    showAllRows(false);
    var section = document.createElement('div');
    section.className = 'search-row';
    section.id = 'search-results';
    var h2 = document.createElement('h2');
    h2.className = 'row-title';
    h2.textContent = 'Results for "' + query + '"';
    section.appendChild(h2);

    var grid = document.createElement('div');
    grid.className = 'search-results-grid';
    for (var si = 0; si < items.length; si++) {
      var sCard = createCard(items[si], items[si].media_type);
      if (sCard) grid.appendChild(sCard);
    }
    section.appendChild(grid);
    content.appendChild(section);
  }

  function clearSearchResults() {
    var existing = document.getElementById('search-results');
    if (existing) existing.remove();
    showAllRows(true);
  }

  function showAllRows(show) {
    var rows = content.querySelectorAll('.category-row');
    for (var i = 0; i < rows.length; i++) rows[i].style.display = show ? '' : 'none';
  }

  function setFilter(filter) {
    currentFilter = filter;
    for (var i = 0; i < navBtns.length; i++) {
      navBtns[i].classList.toggle('active', navBtns[i].getAttribute('data-filter') === filter);
    }
    var rows = content.querySelectorAll('.category-row');
    for (var j = 0; j < rows.length; j++) {
      var rowType = rows[j].getAttribute('data-type');
      rows[j].style.display = (filter === 'all' || rowType === filter) ? '' : 'none';
    }
  }

  function init() {
    loading.style.display = 'flex';
    ensureStreamCacheFresh();

    var langSelect = document.getElementById('lang-select');
    if (langSelect) {
      langSelect.value = currentLang;
      langSelect.addEventListener('change', function () {
        currentLang = this.value;
        localStorage.setItem('asfr_lang', currentLang);
        clearSearchResults();
        loadContent();
      });
    }

    loadContent();

    seasonSelect.addEventListener('change', function () { if (currentMedia) updateEpisodes(currentMedia.item.id, this.value); });
    episodeSelect.addEventListener('change', function () {
      if (currentMedia) {
        currentPlaybackId = newPlaybackId();
        currentStreamRequestId = currentPlaybackId;
        destroyCustomPlayer();
        showLoader(true, 'Loading stream...');
        playerIframe.src = 'about:blank';
        var subtitleEl = document.getElementById('player-subtitle');
        if (subtitleEl) subtitleEl.textContent = 'Season ' + (seasonSelect.value || 1) + ' · Episode ' + (this.value || 1);
        updatePlayNextButton();
        attemptCustomPlayer().catch(function (err) {
          handleCustomPlayerFailure(err);
        });
      }
    });
    playerClose.addEventListener('click', closePlayer);
    playerModal.addEventListener('click', handlePlayerBackdropClick);

    var settingsEl = document.getElementById('player-settings');
    if (settingsEl) {
      settingsEl.addEventListener('click', function (e) {
        var chip = e.target.closest('.setting-chip');
        if (!chip) return;
        var setting = chip.getAttribute('data-setting');
        var value = chip.getAttribute('data-value');
        var group = chip.closest('.setting-group');
        var chips = group ? group.querySelectorAll('.setting-chip') : [];
        for (var ci = 0; ci < chips.length; ci++) chips[ci].classList.remove('setting-chip--active');
        chip.classList.add('setting-chip--active');
        if (setting === 'quality') {
          if (hlsInstance && hlsInstance.levels && hlsInstance.levels.length) {
            hlsInstance.currentLevel = (value === 'default') ? -1 : parseInt(value, 10);
          }
        } else if (setting === 'speed') {
          var v = parseFloat(value);
          var video = document.getElementById('hls-video');
          if (video && isFinite(v)) video.playbackRate = v;
        } else if (setting === 'buffer') {
          if (hlsInstance) {
            var bs = parseInt(value, 10);
            try {
              hlsInstance.config.maxBufferLength = bs;
              hlsInstance.config.maxBufferSize = bs * 1000 * 1000;
            } catch (err) {}
          }
        } else if (setting === 'codec' && value === 'avc' && hlsInstance && hlsInstance.levels && hlsInstance.levels.length) {
          var avcIdx = -1;
          for (var ai = 0; ai < hlsInstance.levels.length; ai++) {
            if (hlsInstance.levels[ai].attrs && /avc/i.test(hlsInstance.levels[ai].attrs.CODECS || '')) { avcIdx = ai; break; }
          }
          if (avcIdx >= 0) hlsInstance.currentLevel = avcIdx;
        }
      });
    }

    var skipBack = document.getElementById('player-skip-back');
    var skipForward = document.getElementById('player-skip-forward');
    if (skipBack) skipBack.addEventListener('click', function () {
      var video = document.getElementById('hls-video');
      if (video && isFinite(video.currentTime)) video.currentTime = Math.max(0, video.currentTime - 10);
    });
    if (skipForward) skipForward.addEventListener('click', function () {
      var video = document.getElementById('hls-video');
      if (video && isFinite(video.currentTime)) video.currentTime = Math.min(video.duration || video.currentTime, video.currentTime + 10);
    });
    var playerNext = document.getElementById('player-next');
    if (playerNext) playerNext.addEventListener('click', function () {
      if (currentMedia && currentMedia.type === 'tv') nextEpisode();
    });

    initNetflixControls();

    searchToggle.addEventListener('click', toggleSearch);
    searchInput.addEventListener('input', handleSearch);
    if (searchClose) searchClose.addEventListener('click', toggleSearch);

    var mobileNavBtns = document.querySelectorAll('#mobile-nav .mobile-nav-btn');
    for (var mn = 0; mn < mobileNavBtns.length; mn++) {
      mobileNavBtns[mn].addEventListener('click', function () {
        var action = this.getAttribute('data-action');
        var btns = document.querySelectorAll('#mobile-nav .mobile-nav-btn');
        for (var k = 0; k < btns.length; k++) btns[k].classList.remove('active');
        if (action === 'home') this.classList.add('active');
        handleMobileNav(action);
      });
    }
    var overlayInput = document.getElementById('search-overlay-input');
    var overlayClose = document.getElementById('search-overlay-close');
    if (overlayInput) overlayInput.addEventListener('input', handleOverlaySearch);
    if (overlayClose) overlayClose.addEventListener('click', closeSearchOverlay);

    for (var i = 0; i < navBtns.length; i++) {
      navBtns[i].addEventListener('click', function () { setFilter(this.getAttribute('data-filter')); });
    }
    detailClose.addEventListener('click', closeDetail);

    // Show page events
    if (showBackBtn) {
      showBackBtn.addEventListener('click', function () {
        closeShowPage();
      });
    }
    if (seasonBtn) {
      seasonBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        seasonDropdown.classList.toggle('open');
      });
    }
    document.addEventListener('click', function (e) {
      if (seasonDropdown && !e.target.closest('.season-selector')) {
        seasonDropdown.classList.remove('open');
      }
    });

    // Hamburger menu toggle
    var hamburger = document.getElementById('hamburger');
    var navLinks = document.getElementById('nav-links');
    if (hamburger && navLinks) {
      hamburger.addEventListener('click', function () {
        hamburger.classList.toggle('open');
        navLinks.classList.toggle('mobile-open');
      });
      navLinks.querySelectorAll('.nav-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          hamburger.classList.remove('open');
          navLinks.classList.remove('mobile-open');
        });
      });
    }

    // Navbar scroll effect
    window.addEventListener('scroll', function () {
      var nav = document.querySelector('.navbar');
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
    });

    // Keyboard shortcuts
    window.asfr_prev_shortcut = function () {
      return function () {
        if (!playerModal.classList.contains('active')) return;
        prevEpisode();
      };
    };
    window.asfr_next_shortcut = function () {
      return function () {
        if (!playerModal.classList.contains('active')) return;
        nextEpisode();
      };
    };
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (playerModal.classList.contains('active')) {
          closePlayer();
          e.preventDefault();
        } else if (detailModal.classList.contains('active')) {
          closeDetail();
          e.preventDefault();
        } else if (showModal.classList.contains('active')) {
          closeShowPage();
          e.preventDefault();
        }
        return;
      }
      if (playerModal.classList.contains('active')) {
        var pk = (e.key || '').toLowerCase();
        if (pk === ' ' || pk === 'k') { e.preventDefault(); togglePlayPause(); return; }
        if (pk === 'arrowleft') { e.preventDefault(); skipBy(-10); return; }
        if (pk === 'arrowright') { e.preventDefault(); skipBy(10); return; }
        if (pk === 'arrowup') { e.preventDefault(); changeVolumeBy(0.1); return; }
        if (pk === 'arrowdown') { e.preventDefault(); changeVolumeBy(-0.1); return; }
        if (pk === 'm') { e.preventDefault(); toggleMute(); return; }
        if (pk === 'f') { e.preventDefault(); toggleFullscreen(); return; }
        if (pk === 'n') { e.preventDefault(); if (currentMedia && currentMedia.type === 'tv') nextEpisode(); return; }
        if (pk === 'p') { e.preventDefault(); if (currentMedia && currentMedia.type === 'tv') prevEpisode(); return; }
        if (pk >= '0' && pk <= '9') { e.preventDefault(); seekByPercent(parseInt(pk, 10) / 10); return; }
      }
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    });
  }

  function loadContent() {
    var existingRows = content.querySelectorAll('.category-row');
    for (var i = 0; i < existingRows.length; i++) existingRows[i].remove();

    loading.style.display = 'flex';
    Promise.all([
      fetchTMDB('/trending/movie/week'),
      fetchTMDB('/trending/tv/week'),
      fetchTMDB('/movie/popular'),
      fetchTMDB('/tv/popular'),
      fetchTMDB('/movie/top_rated'),
      fetchTMDB('/tv/top_rated')
    ]).then(function (results) {
      loading.style.display = 'none';
      initHero(results[0].slice(0, 8));

      var fragment = document.createDocumentFragment();
      fragment.appendChild(createCategoryRow('Trending Movies', results[0], 'movie', false));
      fragment.appendChild(createChannelsRow());
      fragment.appendChild(createCategoryRow('Top 10 TV Shows', results[5], 'tv', true));
      fragment.appendChild(createCategoryRow('Top 10 Movies', results[4], 'movie', true));
      fragment.appendChild(createCategoryRow('Popular Movies', results[2], 'movie', false));
      fragment.appendChild(createCategoryRow('Popular Shows', results[3], 'tv', false));
      content.appendChild(fragment);
      renderContinueWatching();
      setFilter(currentFilter);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  init();
})();
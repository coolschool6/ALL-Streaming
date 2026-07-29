(function () {
  'use strict';

  // ===== GOOGLE SHEETS PAYWALL SYSTEM =====
  // Keys stored in Google Sheet, accessed via Apps Script web app
  // localStorage caches the expiry for instant offline check

  var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxQRgoIOUUJaJP0WKFaFFs4y4UVyhMh853GJPyO1CO4TDfag9H8cduAS_05ffrxLaxz/exec';

  function checkPaywall() {
    var overlay = document.getElementById('paywall-overlay');
    var badge = document.getElementById('sub-badge');
    var daysLeftEl = document.getElementById('sub-days-left');
    if (!overlay) return;

    var expiryTime = localStorage.getItem('asfr_expiry_time');
    var now = Date.now();

    if (expiryTime && now < parseInt(expiryTime, 10)) {
      overlay.style.display = 'none';
      if (badge && daysLeftEl) {
        var timeLeftMs = parseInt(expiryTime, 10) - now;
        var daysLeft = Math.ceil(timeLeftMs / (1000 * 60 * 60 * 24));
        daysLeftEl.textContent = daysLeft;
        badge.style.display = 'flex';
      }
    } else {
      localStorage.removeItem('asfr_access_key');
      localStorage.removeItem('asfr_expiry_time');
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
                return { success: true, expiresAt: actData.expiresAt };
              }
              return { success: false, error: 'Activation failed' };
            });
        } else if (data.status === 'active') {
          localStorage.setItem('asfr_access_key', keyValue);
          localStorage.setItem('asfr_expiry_time', data.expiresAt.toString());
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
    if (lastCheck && (now - parseInt(lastCheck, 10)) < 86400000) return;

    fetch(SCRIPT_URL + '?action=verify&key=' + encodeURIComponent(savedKey))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status === 'expired' || data.status === 'invalid') {
          localStorage.removeItem('asfr_access_key');
          localStorage.removeItem('asfr_expiry_time');
          localStorage.removeItem('asfr_last_verify');
          checkPaywall();
        } else if (data.status === 'active') {
          localStorage.setItem('asfr_expiry_time', data.expiresAt.toString());
          localStorage.setItem('asfr_last_verify', now.toString());
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

  var SERVERS = [
    { name: 'Server 1 (2Embed - Default)', type: '2embed', movie: 'https://www.2embed.cc/embed/', tv: 'https://www.2embed.cc/embedtv/' },
    { name: 'Server 2 (AutoEmbed)', type: 'path', movie: 'https://player.autoembed.cc/embed/movie/', tv: 'https://player.autoembed.cc/embed/tv/' },
    { name: 'Server 3 (VidSrc.xyz)', type: 'query', movie: 'https://vidsrc.xyz/embed/movie?tmdb=', tv: 'https://vidsrc.xyz/embed/tv?tmdb=' },
    { name: 'Server 4 (VidSrc.me)', type: 'query', movie: 'https://vidsrc.me/embed/movie?tmdb=', tv: 'https://vidsrc.me/embed/tv?tmdb=' },
    { name: 'Server 5 (SmashyStream)', type: 'query', movie: 'https://embed.smashystream.com/playere.php?tmdb=', tv: 'https://embed.smashystream.com/playere.php?tmdb=' },
    { name: 'Server 6 (VidLink)', type: 'path', movie: 'https://vidlink.pro/movie/', tv: 'https://vidlink.pro/tv/' }
  ];

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

  var serverSelect = null;
  var heroItems = [];
  var heroIndex = 0;
  var heroInterval = null;
  var currentFilter = 'all';
  var searchTimeout = null;
  var currentMedia = null;
  var hlsInstance = null;
  var plyrInstance = null;
  var customActive = false;

  function initServerSelector() {
    if (document.getElementById('server-select')) {
      serverSelect = document.getElementById('server-select');
      return;
    }
    serverSelect = document.createElement('select');
    serverSelect.id = 'server-select';
    serverSelect.className = 'tv-select';

    SERVERS.forEach(function (s, idx) {
      var opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = s.name;
      serverSelect.appendChild(opt);
    });

    var header = playerModal.querySelector('.player-header');
    if (header) header.appendChild(serverSelect);

    serverSelect.addEventListener('change', function () {
      loadServer(parseInt(this.value, 10) || 0);
    });
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

  function initHero(items) {
    heroItems = items.slice(0, 8);
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
      combined.forEach(function (item) { grid.appendChild(createCard(item, item.media_type)); });
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
        track.appendChild(createTopCard(item, mediaType, i + 1));
      } else {
        track.appendChild(createCard(item, mediaType));
      }
    }
    section.appendChild(track);
    return section;
  }

  function createCard(item, mediaType) {
    var card = document.createElement('div');
    card.className = 'card';
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
    return card;
  }

  function createTopCard(item, mediaType, rank) {
    var card = document.createElement('div');
    card.className = 'top-card';
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
    card.appendChild(posterWrap);
    card.addEventListener('click', function () { openDetail(item, mediaType); });
    return card;
  }

  function openDetail(item, mediaType) {
    if (mediaType === 'tv') {
      openShowPage(item);
      return;
    }
    var bg = item.backdrop_path || item.poster_path;
    detailBackdrop.style.backgroundImage = bg ? 'url(' + imgURL(bg, 'original') + ')' : 'none';
    detailPoster.innerHTML = item.poster_path ? '<img src="' + imgURL(item.poster_path) + '" alt="">' : '';
    detailTitle.textContent = item.title || item.name || '';
    detailOverview.textContent = item.overview || '';
    detailWatch.onclick = function () { closeDetail(); openPlayer(item, mediaType); };
    detailModal.classList.add('active');
    document.body.style.overflow = 'hidden';
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

  function buildEmbedURL(server, mediaType, id, season, episode) {
    season = season || 1;
    episode = episode || 1;
    if (mediaType === 'movie') return server.movie + id;
    if (server.type === 'query') return server.tv + id + '&season=' + season + '&episode=' + episode;
    if (server.type === '2embed') return server.tv + id + '&s=' + season + '&e=' + episode;
    return server.tv + id + '/' + season + '/' + episode;
  }

  function initCustomPlayer(sourceUrl) {
    var video = document.getElementById('hls-video');
    var iframe = document.getElementById('player-iframe');
    if (!video || !iframe) return;

    destroyCustomPlayer();

    customActive = true;
    iframe.style.display = 'none';
    video.style.display = 'block';
    video.removeAttribute('src');

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      hlsInstance = new Hls();
      hlsInstance.loadSource(sourceUrl);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
        if (typeof Plyr !== 'undefined') {
          plyrInstance = new Plyr(video, {
            controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'fullscreen', 'settings'],
            settings: ['quality', 'speed'],
            speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] }
          });
        }
        video.play().catch(function () {});
      });
      hlsInstance.on(Hls.Events.ERROR, function (e, data) {
        if (data.fatal) {
          destroyCustomPlayer();
          loadServer(1);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = sourceUrl;
      if (typeof Plyr !== 'undefined') plyrInstance = new Plyr(video);
    } else {
      customActive = false;
      iframe.style.display = 'block';
      video.style.display = 'none';
    }
  }

  function destroyCustomPlayer() {
    customActive = false;
    if (hlsInstance) { try { hlsInstance.destroy(); } catch (e) {} hlsInstance = null; }
    if (plyrInstance) { try { plyrInstance.destroy(); } catch (e) {} plyrInstance = null; }
    var video = document.getElementById('hls-video');
    var iframe = document.getElementById('player-iframe');
    if (video) { video.style.display = 'none'; video.removeAttribute('src'); }
    if (iframe) { iframe.style.display = 'block'; }
  }

  function attemptCustomPlayer() {
    if (!currentMedia) return;
    var item = currentMedia.item;
    var type = currentMedia.type;
    var sNum = seasonSelect ? seasonSelect.value || 1 : 1;
    var eNum = episodeSelect ? episodeSelect.value || 1 : 1;
    var url = '/api/source?tmdbId=' + item.id + '&type=' + type;
    if (type === 'tv') url += '&season=' + sNum + '&episode=' + eNum;

    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Custom source not available');
      initCustomPlayer(url);
    }).catch(function () {});
  }

  function openPlayer(item, mediaType) {
    initServerSelector();
    currentMedia = { item: item, type: mediaType };
    playerTitle.textContent = item.title || item.name || '';
    playerIframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    playerIframe.style.cssText = 'width:100%; height:100%; border:0; display:block;';

    if (mediaType === 'tv') {
      tvControls.style.display = 'flex';
      setupTVControls(item.id);
    } else {
      tvControls.style.display = 'none';
      loadServer(0);
      attemptCustomPlayer();
    }
    playerModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function loadServer(serverIndex) {
    if (!currentMedia) return;
    if (serverIndex !== 0) destroyCustomPlayer();
    var item = currentMedia.item;
    var type = currentMedia.type;
    var sNum = seasonSelect.value || 1;
    var eNum = episodeSelect.value || 1;
    var server = SERVERS[serverIndex] || SERVERS[0];
    if (serverSelect) serverSelect.value = serverIndex.toString();
    playerIframe.src = buildEmbedURL(server, type, item.id, sNum, eNum);
    showOverlay();
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
    destroyCustomPlayer();
    playerIframe.src = 'about:blank';
    playerModal.classList.remove('active');
    document.body.style.overflow = '';
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
      if (seasons.length) updateEpisodes(tvId, seasons[0].season_number);
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
      loadServer(0);
      attemptCustomPlayer();
    });
  }

  function toggleSearch() {
    searchBar.classList.toggle('active');
    if (searchBar.classList.contains('active')) searchInput.focus();
    else clearSearchResults();
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
    items.forEach(function (item) { grid.appendChild(createCard(item, item.media_type)); });
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
        loadServer(serverSelect ? parseInt(serverSelect.value, 10) : 0);
        attemptCustomPlayer();
      }
    });
    playerClose.addEventListener('click', closePlayer);
    searchToggle.addEventListener('click', toggleSearch);
    searchInput.addEventListener('input', handleSearch);
    if (searchClose) searchClose.addEventListener('click', toggleSearch);

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
      setFilter(currentFilter);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  init();
})();
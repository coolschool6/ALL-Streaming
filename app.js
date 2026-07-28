(function () {
  'use strict';

  // ===== MANUAL KEY PAYWALL SYSTEM (SHARED JSON) =====
  var cachedKeys = {};

  function fetchKeys() {
    return fetch('keys.json?t=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load keys');
        return res.json();
      })
      .then(function (data) {
        cachedKeys = data || {};
      })
      .catch(function () {
        cachedKeys = {};
      });
  }

  function getActiveKeys() {
    return cachedKeys;
  }

  function checkPaywall() {
    var overlay = document.getElementById('paywall-overlay');
    var badge = document.getElementById('sub-badge');
    var daysLeftEl = document.getElementById('sub-days-left');
    if (!overlay) return;

    var savedKey = localStorage.getItem('asfr_access_key');
    var now = Date.now();
    var validKeys = getActiveKeys();

    var keyRecord = validKeys[savedKey];
    var masterExpiry = keyRecord ? (typeof keyRecord === 'object' ? keyRecord.expiry : keyRecord) : 0;

    var isKeyValid = savedKey && 
                     keyRecord && 
                     now < parseInt(masterExpiry, 10);

    if (isKeyValid) {
      overlay.style.display = 'none';
      if (badge && daysLeftEl) {
        var timeLeftMs = parseInt(masterExpiry, 10) - now;
        var daysLeft = Math.ceil(timeLeftMs / (1000 * 60 * 60 * 24));
        daysLeftEl.textContent = daysLeft;
        badge.style.display = 'flex';
      }
    } else {
      localStorage.removeItem('asfr_access_key');
      overlay.style.display = 'flex';
      if (badge) badge.style.display = 'none';
    }
  }

  function setupPaywallEvents() {
    var activateBtn = document.getElementById('btn-activate');
    var keyInput = document.getElementById('key-input');
    var errorMsg = document.getElementById('paywall-error');

    if (!activateBtn || !keyInput) return;

    activateBtn.addEventListener('click', function () {
      var enteredKey = keyInput.value.trim();
      var validKeys = getActiveKeys();
      
      if (validKeys[enteredKey]) {
        var record = validKeys[enteredKey];
        var expiry = typeof record === 'object' ? record.expiry : record;
        
        if (Date.now() > expiry) {
          errorMsg.textContent = 'This key has expired.';
          return;
        }

        localStorage.setItem('asfr_access_key', enteredKey);
        
        document.getElementById('paywall-overlay').style.display = 'none';
        alert('Access granted!');
        window.location.reload();
      } else {
        errorMsg.textContent = 'Invalid key. Contact WhatsApp to purchase a valid key.';
      }
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    fetchKeys().then(function () {
      checkPaywall();
      setupPaywallEvents();

      var logoutBtn = document.getElementById('btn-logout');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
          localStorage.removeItem('asfr_access_key');
          window.location.reload();
        });
      }
    });
  });


  // ===== STREAMING PLATFORM ENGINE =====
  var API_KEY = 'cd27a14dfc1752e04b474124a5af6d2b';
  var BASE = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/';

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

  window.open = function () { return { focus: function () {}, blur: function () {}, close: function () {} }; };

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
    return fetch(BASE + endpoint + sep + 'api_key=' + API_KEY)
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
    var src = item.poster_path || item.backdrop_path;
    img.src = src ? imgURL(src) : '';
    img.alt = item.title || item.name || '';
    poster.appendChild(img);
    card.appendChild(poster);

    var info = document.createElement('div');
    info.className = 'card-info';
    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = item.title || item.name || '';
    info.appendChild(name);
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
    var src = item.poster_path || item.backdrop_path;
    img.src = src ? imgURL(src) : '';
    posterWrap.appendChild(img);
    card.appendChild(posterWrap);
    card.addEventListener('click', function () { openDetail(item, mediaType); });
    return card;
  }

  function openDetail(item, mediaType) {
    var bg = item.backdrop_path || item.poster_path;
    detailBackdrop.style.backgroundImage = bg ? 'url(' + imgURL(bg, 'original') + ')' : 'none';
    detailPoster.innerHTML = item.poster_path ? '<img src="' + imgURL(item.poster_path) + '" alt="">' : '';
    detailTitle.textContent = item.title || item.name || '';
    detailOverview.textContent = item.overview || '';
    detailWatch.onclick = function () { closeDetail(); openPlayer(item, mediaType); };
    detailModal.classList.add('active');
    document.body.style.overflow = 'hidden';
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
    }
    playerModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function loadServer(serverIndex) {
    if (!currentMedia) return;
    var item = currentMedia.item;
    var type = currentMedia.type;
    var sNum = seasonSelect.value || 1;
    var eNum = episodeSelect.value || 1;
    var server = SERVERS[serverIndex] || SERVERS[0];
    if (serverSelect) serverSelect.value = serverIndex.toString();
    playerIframe.src = buildEmbedURL(server, type, item.id, sNum, eNum);
  }

  function closePlayer() {
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
    });

    seasonSelect.addEventListener('change', function () { if (currentMedia) updateEpisodes(currentMedia.item.id, this.value); });
    episodeSelect.addEventListener('change', function () { if (currentMedia) loadServer(serverSelect ? parseInt(serverSelect.value, 10) : 0); });
    playerClose.addEventListener('click', closePlayer);
    searchToggle.addEventListener('click', toggleSearch);
    searchInput.addEventListener('input', handleSearch);
    if (searchClose) searchClose.addEventListener('click', toggleSearch);

    for (var i = 0; i < navBtns.length; i++) {
      navBtns[i].addEventListener('click', function () { setFilter(this.getAttribute('data-filter')); });
    }
    detailClose.addEventListener('click', closeDetail);
  }

  init();
})();
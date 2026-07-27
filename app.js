(function () {
  'use strict';

  var API_KEY = 'cd27a14dfc1752e04b474124a5af6d2b';
  var BASE = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/';

  var SERVERS = [
    {
      name: 'Server 1 (2Embed - Default)',
      type: '2embed',
      movie: 'https://www.2embed.cc/embed/',
      tv: 'https://www.2embed.cc/embedtv/'
    },
    {
      name: 'Server 2 (AutoEmbed)',
      type: 'path',
      movie: 'https://player.autoembed.cc/embed/movie/',
      tv: 'https://player.autoembed.cc/embed/tv/'
    },
    {
      name: 'Server 3 (VidSrc.xyz)',
      type: 'query',
      movie: 'https://vidsrc.xyz/embed/movie?tmdb=',
      tv: 'https://vidsrc.xyz/embed/tv?tmdb='
    },
    {
      name: 'Server 4 (VidSrc.me)',
      type: 'query',
      movie: 'https://vidsrc.me/embed/movie?tmdb=',
      tv: 'https://vidsrc.me/embed/tv?tmdb='
    },
    {
      name: 'Server 5 (SmashyStream)',
      type: 'query',
      movie: 'https://embed.smashystream.com/playere.php?tmdb=',
      tv: 'https://embed.smashystream.com/playere.php?tmdb='
    },
    {
      name: 'Server 6 (VidLink)',
      type: 'path',
      movie: 'https://vidlink.pro/movie/',
      tv: 'https://vidlink.pro/tv/'
    }
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

  window.open = function () {
    return { focus: function () {}, blur: function () {}, close: function () {} };
  };

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

  /* ===== HERO ===== */
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

    var isUnreleased = item.release_date && new Date(item.release_date) > new Date();
    if (item.media_type === 'tv') {
      heroBadge.textContent = 'TV Show';
      heroBadge.style.display = 'inline-block';
    } else if (isUnreleased) {
      heroBadge.textContent = 'Coming Soon';
      heroBadge.style.display = 'inline-block';
    } else {
      heroBadge.textContent = '';
      heroBadge.style.display = 'none';
    }

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

  /* ===== CHANNELS ===== */
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
        img.loading = 'lazy';
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

    var region = 'US';
    var pMovies = fetchTMDB('/discover/movie?watch_region=' + region + '&with_watch_providers=' + channel.provider_id + '&sort_by=popularity.desc');
    var pTV = fetchTMDB('/discover/tv?watch_region=' + region + '&with_watch_providers=' + channel.provider_id + '&sort_by=popularity.desc');

    Promise.all([pMovies, pTV])
      .then(function (results) {
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

        combined.forEach(function (item) {
          grid.appendChild(createCard(item, item.media_type));
        });
      })
      .catch(function () {
        grid.innerHTML = '<div class="search-empty">Failed to load content.</div>';
      });

    window.scrollTo({ top: 300, behavior: 'smooth' });
  }

  /* ===== ROWS & CARDS ===== */
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
    img.setAttribute('data-loaded', 'false');
    img.onload = function () { this.setAttribute('data-loaded', 'true'); };
    img.onerror = function () { this.style.display = 'none'; };
    poster.appendChild(img);

    if (item.vote_average && item.vote_average > 0) {
      var rating = document.createElement('div');
      rating.className = 'card-rating';
      rating.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' + item.vote_average.toFixed(1);
      poster.appendChild(rating);
    }

    var overlay = document.createElement('div');
    overlay.className = 'card-overlay';
    var playBtn = document.createElement('div');
    playBtn.className = 'card-play';
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>';
    overlay.appendChild(playBtn);
    poster.appendChild(overlay);

    card.appendChild(poster);

    var info = document.createElement('div');
    info.className = 'card-info';
    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = item.title || item.name || '';
    info.appendChild(name);

    var yearEl = document.createElement('div');
    yearEl.className = 'card-year';
    var dateStr = item.release_date || item.first_air_date || '';
    yearEl.textContent = dateStr ? dateStr.substring(0, 4) : '';
    info.appendChild(yearEl);

    card.appendChild(info);

    card.addEventListener('click', function () {
      openDetail(item, mediaType);
    });

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
    img.alt = item.title || item.name || '';
    img.onerror = function () { this.style.display = 'none'; };
    posterWrap.appendChild(img);
    card.appendChild(posterWrap);

    card.addEventListener('click', function () {
      openDetail(item, mediaType);
    });

    return card;
  }

  /* ===== DETAIL MODAL ===== */
  function openDetail(item, mediaType) {
    var bg = item.backdrop_path || item.poster_path;
    detailBackdrop.style.backgroundImage = bg ? 'url(' + imgURL(bg, 'original') + ')' : 'none';

    var posterSrc = item.poster_path;
    detailPoster.innerHTML = posterSrc
      ? '<img src="' + imgURL(posterSrc) + '" alt="' + escapeHTML(item.title || item.name) + '">'
      : '';

    detailTitle.textContent = item.title || item.name || '';

    var metaHTML = '';
    var dateStr = item.release_date || item.first_air_date || '';
    if (dateStr) metaHTML += '<span class="badge">' + dateStr.substring(0, 4) + '</span>';
    if (item.vote_average && item.vote_average > 0) metaHTML += '<span class="badge rating-badge">&#9733; ' + item.vote_average.toFixed(1) + '</span>';
    metaHTML += '<span class="badge">' + (mediaType === 'tv' ? 'TV Show' : 'Movie') + '</span>';
    detailMeta.innerHTML = metaHTML;

    detailOverview.textContent = item.overview || 'No description available.';

    detailWatch.onclick = function () {
      closeDetail();
      openPlayer(item, mediaType);
    };

    detailModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    detailModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  /* ===== PLAYER ENGINE ===== */
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
    playerIframe.setAttribute('allowfullscreen', 'true');
    playerIframe.style.width = '100%';
    playerIframe.style.height = '100%';
    playerIframe.style.border = '0';
    playerIframe.style.display = 'block';

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
    seasonSelect.innerHTML = '<option value="">Loading seasons...</option>';
    episodeSelect.innerHTML = '<option value="">Select episode</option>';

    fetchTMDB('/tv/' + tvId)
      .then(function (tvData) {
        seasonSelect.innerHTML = '';
        var seasons = (tvData.seasons || []).filter(function(s) { return s.season_number > 0; });
        if (!seasons.length) {
          seasonSelect.innerHTML = '<option value="1">Season 1</option>';
          updateEpisodes(tvId, 1);
          return;
        }
        seasons.forEach(function (s) {
          var opt = document.createElement('option');
          opt.value = s.season_number;
          opt.textContent = s.name || ('Season ' + s.season_number);
          seasonSelect.appendChild(opt);
        });
        seasonSelect.value = seasons[0].season_number;
        updateEpisodes(tvId, seasons[0].season_number);
      })
      .catch(function () {
        seasonSelect.innerHTML = '<option value="1">Season 1</option>';
        updateEpisodes(tvId, 1);
      });
  }

  function updateEpisodes(tvId, seasonNum) {
    episodeSelect.innerHTML = '<option value="">Loading episodes...</option>';
    fetchTMDB('/tv/' + tvId + '/season/' + seasonNum)
      .then(function (seasonData) {
        episodeSelect.innerHTML = '';
        var episodes = seasonData.episodes || [];
        if (!episodes.length) {
          episodeSelect.innerHTML = '<option value="1">Episode 1</option>';
          loadServer(0);
          return;
        }
        episodes.forEach(function (ep) {
          var opt = document.createElement('option');
          opt.value = ep.episode_number;
          opt.textContent = 'E' + ep.episode_number + ' - ' + (ep.name || ('Episode ' + ep.episode_number));
          episodeSelect.appendChild(opt);
        });
        episodeSelect.value = 1;
        loadServer(0);
      })
      .catch(function () {
        episodeSelect.innerHTML = '<option value="1">Episode 1</option>';
        loadServer(0);
      });
  }

  /* ===== SEARCH ===== */
  function toggleSearch() {
    var isActive = searchBar.classList.contains('active');
    if (isActive) {
      searchBar.classList.remove('active');
      searchInput.value = '';
      clearSearchResults();
    } else {
      searchBar.classList.add('active');
      searchInput.focus();
    }
  }

  function handleSearch() {
    var query = searchInput.value.trim();
    if (query.length < 2) {
      clearSearchResults();
      return;
    }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () {
      fetchTMDB('/search/multi?query=' + encodeURIComponent(query) + '&include_adult=false')
        .then(function (results) {
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

    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = 'No results found.';
      section.appendChild(empty);
    } else {
      var grid = document.createElement('div');
      grid.className = 'search-results-grid';
      for (var i = 0; i < items.length; i++) {
        grid.appendChild(createCard(items[i], items[i].media_type));
      }
      section.appendChild(grid);
    }
    content.appendChild(section);
  }

  function clearSearchResults() {
    var existing = document.getElementById('search-results');
    if (existing) existing.remove();
    showAllRows(true);
  }

  function showAllRows(show) {
    var rows = content.querySelectorAll('.category-row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].style.display = show ? '' : 'none';
    }
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

  function handleScroll() {
    var navbar = document.querySelector('.navbar');
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  }

  /* ===== INIT ===== */
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
      var trendingMovies = results[0];
      var trendingTV = results[1];
      var popularMovies = results[2];
      var popularShows = results[3];
      var topMovies = results[4];
      var topShows = results[5];

      loading.style.display = 'none';
      initHero(trendingMovies.slice(0, 8));

      var rowsFragment = document.createDocumentFragment();
      rowsFragment.appendChild(createCategoryRow('Trending Movies', trendingMovies, 'movie', false));
      rowsFragment.appendChild(createChannelsRow());
      rowsFragment.appendChild(createCategoryRow('Top 10 TV Shows', topShows, 'tv', true));
      rowsFragment.appendChild(createCategoryRow('Top 10 Movies', topMovies, 'movie', true));
      rowsFragment.appendChild(createCategoryRow('Popular Movies', popularMovies, 'movie', false));
      rowsFragment.appendChild(createCategoryRow('Popular Shows', popularShows, 'tv', false));

      content.appendChild(rowsFragment);
      setFilter(currentFilter);
    }).catch(function () {
      loading.innerHTML = '<div class="search-empty">Failed to load content. Please refresh.</div>';
    });

    seasonSelect.addEventListener('change', function () {
      if (currentMedia && currentMedia.type === 'tv') updateEpisodes(currentMedia.item.id, this.value);
    });

    episodeSelect.addEventListener('change', function () {
      if (currentMedia && currentMedia.type === 'tv') {
        var currentServer = serverSelect ? parseInt(serverSelect.value, 10) : 0;
        loadServer(currentServer);
      }
    });

    playerClose.addEventListener('click', closePlayer);
    searchToggle.addEventListener('click', toggleSearch);
    searchInput.addEventListener('input', handleSearch);
    
    if (searchClose) {
      searchClose.addEventListener('click', function () {
        searchBar.classList.remove('active');
        searchInput.value = '';
        clearSearchResults();
      });
    }

    for (var i = 0; i < navBtns.length; i++) {
      navBtns[i].addEventListener('click', function () {
        setFilter(this.getAttribute('data-filter'));
      });
    }

    detailClose.addEventListener('click', closeDetail);
    detailModal.addEventListener('click', function (e) {
      if (e.target === detailModal) closeDetail();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (playerModal.classList.contains('active')) closePlayer();
        else if (detailModal.classList.contains('active')) closeDetail();
        else if (searchBar.classList.contains('active')) {
          searchBar.classList.remove('active');
          searchInput.value = '';
          clearSearchResults();
        }
      }
    });

    window.addEventListener('scroll', handleScroll);
  }

  init();
})();
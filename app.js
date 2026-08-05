(function () {
  'use strict';

  var API_KEY = 'cd27a14dfc1752e04b474124a5af6d2b';
  var BASE = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/';
  var VIDCORE = 'https://vidsrc.sbs/embed/';

  var content = document.getElementById('content');
  var loading = document.getElementById('loading');
  var heroBackdrop = document.getElementById('hero-backdrop');
  var heroTitle = document.getElementById('hero-title');
  var heroOverview = document.getElementById('hero-overview');
  var heroBadge = document.getElementById('hero-badge');
  var heroDots = document.getElementById('hero-dots');
  var btnWatch = document.getElementById('btn-watch');
  var btnInfo = document.getElementById('btn-info');
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
  var searchClose = document.getElementById('searchClose') || document.getElementById('search-close');
  var navBtns = document.querySelectorAll('.nav-btn');

  var heroItems = [];
  var heroIndex = 0;
  var heroInterval = null;
  var currentFilter = 'all';
  var searchTimeout = null;
  var gridAdCounter = 0;

  /* ===== ADS ===== */
  var HEADER_BREAKPOINT = 768;
  var headerResizeTimeout = null;

  function getHeaderAdType() {
    return window.innerWidth >= HEADER_BREAKPOINT ? 'banner728x90' : 'banner300x250';
  }

  function renderHeaderAd() {
    var type = getHeaderAdType();
    var slot = document.getElementById('ad-header-banner');
    if (!slot || slot.getAttribute('data-header-type') === type) return;
    slot.setAttribute('data-header-type', type);
    if (typeof window.refreshAdSlot === 'function' && slot.getAttribute('data-ad-loaded')) {
      window.refreshAdSlot('ad-header-banner', type);
    } else if (typeof window.renderAdSlot === 'function') {
      window.renderAdSlot('ad-header-banner', type);
    }
  }

  function onHeaderResize() {
    clearTimeout(headerResizeTimeout);
    headerResizeTimeout = setTimeout(renderHeaderAd, 150);
  }

  function initAds() {
    if (typeof window.renderAdSlots !== 'function') return;
    renderHeaderAd();
    window.renderAdSlots([
      { id: 'ad-home-sponsored', type: 'banner300x250' },
      { id: 'ad-footer-banner', type: 'banner728x90' }
    ]);
    if (typeof window.startAdAutoRefresh === 'function') {
      window.startAdAutoRefresh('ad-header-banner', getHeaderAdType, 150);
      window.startAdAutoRefresh('ad-home-sponsored', 'banner300x250', 150);
    }
    window.addEventListener('resize', onHeaderResize);
  }

  function initNativeAd() {
    if (typeof window.renderAdSlot !== 'function') return;
    window.renderAdSlot(ADS_CONFIG.nativeBanner.containerId, 'nativeBanner');
  }

  function initGridAds() {
    var gridAds = content.querySelectorAll('[data-grid-ad-type]');
    if (typeof window.IntersectionObserver !== 'function') {
      for (var i = 0; i < gridAds.length; i++) {
        window.renderAdSlot(gridAds[i].id, gridAds[i].getAttribute('data-grid-ad-type'));
      }
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].isIntersecting) {
          var el = entries[j].target;
          observer.unobserve(el);
          window.renderAdSlot(el.id, el.getAttribute('data-grid-ad-type'));
        }
      }
    }, { rootMargin: '200px' });
    for (var k = 0; k < gridAds.length; k++) {
      observer.observe(gridAds[k]);
    }
  }

  function createGridAdSlot() {
    var slot = document.createElement('div');
    gridAdCounter++;
    slot.id = 'ad-grid-slot-' + gridAdCounter;
    slot.className = 'ad-slot ad-rectangle in-grid-ad';
    slot.setAttribute('data-grid-ad-type', 'banner300x250');
    return slot;
  }

  function fetchTMDB(endpoint) {
    var sep = endpoint.indexOf('?') === -1 ? '?' : '&';
    return fetch(BASE + endpoint + sep + 'api_key=' + API_KEY)
      .then(function (res) {
        if (!res.ok) throw new Error('TMDB error');
        return res.json();
      })
      .then(function (data) {
        return data.results || [];
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

    btnWatch.onclick = function () {
      openPlayer(item, item.media_type || 'movie');
    };
    btnInfo.onclick = function () {
      openDetail(item, item.media_type || 'movie');
    };
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

  /* ===== CHANNELS & APPS ===== */
  var CHANNELS = [
    { name: 'Netflix', logo: 'logos/netflix.png', url: 'https://www.netflix.com' },
    { name: 'Prime Video', logo: 'logos/primevideo.png', url: 'https://www.primevideo.com' },
    { name: 'Disney+', logo: 'logos/disney.png', url: 'https://www.disneyplus.com' },
    { name: 'Hulu', logo: 'logos/hulu.png', url: 'https://www.hulu.com' },
    { name: 'Max', logo: 'logos/hbomax.png', url: 'https://www.max.com' },
    { name: 'Apple TV+', logo: 'logos/appletv.png', url: 'https://tv.apple.com' },
    { name: 'Paramount+', logo: 'logos/paramount.png', url: 'https://www.paramountplus.com' },
    { name: 'Peacock', logo: 'logos/peacock.png', url: 'https://www.peacocktv.com' },
    { name: 'Crunchyroll', logo: 'logos/crunchyroll.png', url: 'https://www.crunchyroll.com' },
    { name: 'AMC+', logo: 'logos/amc.png', url: 'https://www.amcplus.com' }
  ];

  function createChannelsRow() {
    var section = document.createElement('div');
    section.className = 'category-row';
    section.setAttribute('data-type', 'all');
    section.id = 'channels-row';

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
      var ch = CHANNELS[i];
      var card = document.createElement('a');
      card.className = 'channel-card';
      card.href = ch.url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';

      var logoWrap = document.createElement('div');
      logoWrap.className = 'channel-logo';

      var img = document.createElement('img');
      img.src = ch.logo;
      img.alt = ch.name;
      img.loading = 'lazy';
      logoWrap.appendChild(img);

      card.appendChild(logoWrap);
      track.appendChild(card);
    }

    section.appendChild(track);
    return section;
  }

  /* ===== ROWS ===== */
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
      if (i > 0 && i % 8 === 0) {
        track.appendChild(createGridAdSlot());
      }
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
      openPlayer(item, mediaType);
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
      openPlayer(item, mediaType);
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
    if (dateStr) {
      metaHTML += '<span class="badge">' + dateStr.substring(0, 4) + '</span>';
    }
    if (item.vote_average && item.vote_average > 0) {
      metaHTML += '<span class="badge rating-badge">&#9733; ' + item.vote_average.toFixed(1) + '</span>';
    }
    if (mediaType === 'tv') {
      metaHTML += '<span class="badge">TV Show</span>';
    } else {
      metaHTML += '<span class="badge">Movie</span>';
    }
    detailMeta.innerHTML = metaHTML;

    detailOverview.textContent = item.overview || 'No description available.';

    detailWatch.onclick = function () {
      closeDetail();
      openPlayer(item, mediaType);
    };

    detailModal.classList.add('active');
    document.body.style.overflow = 'hidden';

    initNativeAd();
    if (typeof window.refreshVisibleAds === 'function') {
      window.refreshVisibleAds();
    }
  }

  function closeDetail() {
    detailModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  /* ===== PLAYER ===== */
  function openPlayer(item, mediaType) {
    var url;
    if (mediaType === 'tv') {
      url = VIDCORE + 'tv/' + item.id + '/1/1';
    } else {
      url = VIDCORE + 'movie/' + item.id + '?autoPlay=true';
    }
    window.location.href = url;
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
          var filtered = results.filter(function (r) {
            return r.media_type === 'movie' || r.media_type === 'tv';
          });
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

  /* ===== NAV FILTER ===== */
  function setFilter(filter) {
    currentFilter = filter;

    for (var i = 0; i < navBtns.length; i++) {
      navBtns[i].classList.toggle('active', navBtns[i].getAttribute('data-filter') === filter);
    }

    var rows = content.querySelectorAll('.category-row');
    for (var j = 0; j < rows.length; j++) {
      var rowType = rows[j].getAttribute('data-type');
      if (filter === 'all') {
        rows[j].style.display = '';
      } else {
        rows[j].style.display = rowType === filter ? '' : 'none';
      }
    }
  }

  /* ===== NAVBAR SCROLL ===== */
  function handleScroll() {
    var navbar = document.querySelector('.navbar');
    if (window.scrollY > 60) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }

  /* ===== INIT ===== */
  function init() {
    loading.style.display = 'flex';
    initAds();

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

      var row1 = createCategoryRow('Trending Movies', trendingMovies, 'movie', false);
      rowsFragment.appendChild(row1);

      rowsFragment.appendChild(createChannelsRow());

      var row5 = createCategoryRow('Top 10 TV Shows', topShows, 'tv', true);
      rowsFragment.appendChild(row5);

      var row6 = createCategoryRow('Top 10 Movies', topMovies, 'movie', true);
      rowsFragment.appendChild(row6);

      var row3 = createCategoryRow('Popular Movies', popularMovies, 'movie', false);
      rowsFragment.appendChild(row3);

      var row4 = createCategoryRow('Popular Shows', popularShows, 'tv', false);
      rowsFragment.appendChild(row4);

      content.appendChild(rowsFragment);

      initGridAds();
      setFilter(currentFilter);
    }).catch(function (err) {
      loading.innerHTML = '<div class="search-empty">Failed to load content. Please refresh the page.</div>';
    });

    searchToggle.addEventListener('click', toggleSearch);
    searchInput.addEventListener('input', handleSearch);
    searchClose.addEventListener('click', function () {
      searchBar.classList.remove('active');
      searchInput.value = '';
      clearSearchResults();
    });

    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchBar.classList.remove('active');
        searchInput.value = '';
        clearSearchResults();
      }
    });

    for (var i = 0; i < navBtns.length; i++) {
      navBtns[i].addEventListener('click', function () {
        setFilter(this.getAttribute('data-filter'));
      });
    }

    detailClose.addEventListener('click', closeDetail);

    detailModal.addEventListener('click', function (e) {
      if (e.target === detailModal || e.target.classList.contains('detail-overlay')) closeDetail();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (detailModal.classList.contains('active')) closeDetail();
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

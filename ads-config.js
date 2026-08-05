(function () {
  'use strict';

  var ADS_CONFIG = {
    banner728x90: {
      atOptions: {
        key: '020da7493103ccf9087f1c6a4bf3964c',
        format: 'iframe',
        height: 90,
        width: 728,
        params: {}
      },
      script: 'https://www.highperformanceformat.com/020da7493103ccf9087f1c6a4bf3964c/invoke.js'
    },
    banner300x250: {
      atOptions: {
        key: '1a04fc1649f03a179bf7d134f95f1ebc',
        format: 'iframe',
        height: 250,
        width: 300,
        params: {}
      },
      script: 'https://www.highperformanceformat.com/1a04fc1649f03a179bf7d134f95f1ebc/invoke.js'
    },
    nativeBanner: {
      containerId: 'container-ebb59bc2da2e92679b6730e9d4f48378',
      script: 'https://pl30688595.effectivecpmnetwork.com/ebb59bc2da2e92679b6730e9d4f48378/invoke.js'
    },
    socialBar: {
      script: 'https://pl30688665.effectivecpmnetwork.com/28/1a/d5/281ad526ce91edeae8f3d39ae180b212.js'
    }
  };

  var adQueue = [];
  var adQueueBusy = false;
  var refreshSlots = [];
  var refreshTimers = [];
  var visibilityPaused = false;

  function appendWrittenNodes(slot, html) {
    var template = document.createElement('template');
    template.innerHTML = html;
    var content = template.content;
    var scripts = Array.prototype.slice.call(content.querySelectorAll('script'));
    for (var i = 0; i < scripts.length; i++) {
      scripts[i].parentNode.removeChild(scripts[i]);
    }
    while (content.firstChild) {
      slot.appendChild(content.firstChild);
    }
    for (var j = 0; j < scripts.length; j++) {
      var exec = document.createElement('script');
      if (scripts[j].src) {
        exec.src = scripts[j].src;
      } else {
        exec.textContent = scripts[j].textContent;
      }
      slot.appendChild(exec);
    }
  }

  function runBanner(slot, cfg, done) {
    var shimmedWrite = function (html) {
      appendWrittenNodes(slot, html);
    };
    var origWrite = document.write;
    var origWriteLn = document.writeln;
    document.write = shimmedWrite;
    document.writeln = shimmedWrite;

    var restore = function () {
      document.write = origWrite;
      document.writeln = origWriteLn;
      if (typeof done === 'function') done();
    };

    try {
      var setOptions = document.createElement('script');
      setOptions.type = 'text/javascript';
      setOptions.textContent = 'window.atOptions = ' + JSON.stringify(cfg.atOptions) + ';';
      slot.appendChild(setOptions);

      var loader = document.createElement('script');
      loader.type = 'text/javascript';
      loader.src = cfg.script;
      loader.onload = restore;
      loader.onerror = restore;
      slot.appendChild(loader);
    } catch (err) {
      restore();
    }
  }

  function processQueue() {
    if (adQueueBusy || adQueue.length === 0) return;
    adQueueBusy = true;
    var job = adQueue.shift();
    runBanner(job.slot, job.cfg, function () {
      adQueueBusy = false;
      processQueue();
      if (typeof job.done === 'function') job.done();
    });
  }

  function renderAdSlot(containerId, adType, done) {
    var slot = document.getElementById(containerId);
    var cfg = ADS_CONFIG[adType];
    if (!slot || !cfg || slot.getAttribute('data-ad-loaded')) {
      if (typeof done === 'function') done();
      return;
    }
    slot.setAttribute('data-ad-loaded', 'true');
    slot.innerHTML = '';

    if (adType === 'nativeBanner') {
      var native = document.createElement('script');
      native.type = 'text/javascript';
      native.async = true;
      native.src = cfg.script;
      slot.appendChild(native);
      if (typeof done === 'function') done();
      return;
    }

    adQueue.push({ slot: slot, cfg: cfg, done: done });
    processQueue();
  }

  function renderAdSlots(slots) {
    var i = 0;
    function next() {
      if (i >= slots.length) return;
      var item = slots[i++];
      renderAdSlot(item.id, item.type, next);
    }
    next();
  }

  function refreshAdSlot(containerId, adType, done) {
    var slot = document.getElementById(containerId);
    if (!slot) {
      if (typeof done === 'function') done();
      return;
    }
    if (window.console && console.log) {
      console.log('[ads] refreshing slot: ' + containerId + ' (' + adType + ')');
    }
    slot.removeAttribute('data-ad-loaded');
    renderAdSlot(containerId, adType, done);
  }

  function resolveType(type) {
    return typeof type === 'function' ? type() : type;
  }

  function isSlotInViewport(slot) {
    var r = slot.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }

  function restartAdRefresh() {
    refreshTimers.length = 0;
    if (visibilityPaused) return;
    for (var i = 0; i < refreshSlots.length; i++) {
      (function (cfg) {
        var timer = setInterval(function () {
          var slot = document.getElementById(cfg.id);
          if (!slot || !isSlotInViewport(slot)) return;
          refreshAdSlot(cfg.id, resolveType(cfg.type));
        }, cfg.interval * 1000);
        refreshTimers.push(timer);
      })(refreshSlots[i]);
    }
  }

  function startAdAutoRefresh(containerId, adType, intervalSeconds) {
    for (var i = 0; i < refreshSlots.length; i++) {
      if (refreshSlots[i].id === containerId) return;
    }
    refreshSlots.push({ id: containerId, type: adType, interval: intervalSeconds });
    restartAdRefresh();
  }

  function stopAdAutoRefresh(containerId) {
    var remaining = [];
    for (var i = 0; i < refreshSlots.length; i++) {
      if (refreshSlots[i].id !== containerId) {
        remaining.push(refreshSlots[i]);
      }
    }
    refreshSlots = remaining;
    restartAdRefresh();
  }

  function refreshVisibleAds() {
    for (var i = 0; i < refreshSlots.length; i++) {
      var cfg = refreshSlots[i];
      var slot = document.getElementById(cfg.id);
      if (slot && isSlotInViewport(slot)) {
        refreshAdSlot(cfg.id, resolveType(cfg.type));
      }
    }
  }

  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        visibilityPaused = true;
        refreshTimers.length = 0;
      } else {
        visibilityPaused = false;
        refreshVisibleAds();
        restartAdRefresh();
      }
    });
  }

  window.ADS_CONFIG = ADS_CONFIG;
  window.renderAdSlot = renderAdSlot;
  window.renderAdSlots = renderAdSlots;
  window.refreshAdSlot = refreshAdSlot;
  window.startAdAutoRefresh = startAdAutoRefresh;
  window.stopAdAutoRefresh = stopAdAutoRefresh;
  window.refreshVisibleAds = refreshVisibleAds;
  window.adRefreshTimers = refreshTimers;
})();

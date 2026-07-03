// memory-manager.js
// Owns page-card iframe lifetime, off-screen hibernation, and domain white list.

(function initializeMemoryManager() {
  const OFFSCREEN_DELAY_MS = 30000;
  const PRELOAD_MARGIN_PX = 300;
  const configuredDomains = Array.isArray(window.__FREE_CANVAS_MEMORY_WHITE_LIST__)
    ? window.__FREE_CANVAS_MEMORY_WHITE_LIST__
    : [];

  function normalizeDomain(value) {
    if (typeof value !== "string") return "";

    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "";

    try {
      const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
      return new URL(candidate).hostname.replace(/^\.+|\.+$/g, "");
    } catch (error) {
      return "";
    }
  }

  const whiteList = new Set(configuredDomains.map(normalizeDomain).filter(Boolean));

  function getCardUrl(card) {
    return card.currentUrl || card.url || "";
  }

  function getUrlHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (error) {
      return "";
    }
  }

  function isCardWhiteListed(card) {
    let hostname = getUrlHostname(getCardUrl(card));
    if (!hostname) return false;

    // Walk hostname suffixes and use O(1) Set lookups. This avoids scanning the
    // complete white list whenever an observed card changes state.
    while (hostname) {
      if (whiteList.has(hostname)) return true;
      const dotIndex = hostname.indexOf(".");
      if (dotIndex === -1) break;
      hostname = hostname.slice(dotIndex + 1);
    }
    return false;
  }

  function isCardFocused(card) {
    return typeof focusedCard !== "undefined" && focusedCard === card;
  }

  function ensureMemoryState(card) {
    if (!card.memoryState) {
      card.memoryState = {
        phase: "idle",
        nearViewport: true,
        sleepTimer: 0
      };
    }
    return card.memoryState;
  }

  function clearSleepTimer(card) {
    const memory = ensureMemoryState(card);
    if (memory.sleepTimer) {
      clearTimeout(memory.sleepTimer);
      memory.sleepTimer = 0;
    }
    if (memory.phase === "pending-sleep") {
      memory.phase = card.iframeEl ? "active" : (card.isHibernated ? "sleeping" : "idle");
    }
  }

  function getPlaceholder(card) {
    return card.element.querySelector(".iframe-sleep-placeholder");
  }

  function showPlaceholder(card, icon, message) {
    const wrapper = card.element.querySelector(".iframe-wrapper");
    if (!wrapper) return;

    let placeholder = getPlaceholder(card);
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.className = "iframe-sleep-placeholder";
      placeholder.innerHTML = `
        <div class="sleep-inner">
          <span class="sleep-icon"></span>
          <span class="sleep-text"></span>
        </div>
      `;
      wrapper.appendChild(placeholder);
    }

    placeholder.querySelector(".sleep-icon").textContent = icon;
    placeholder.querySelector(".sleep-text").textContent = message;
  }

  function removePlaceholder(card) {
    const placeholder = getPlaceholder(card);
    if (placeholder) placeholder.remove();
  }

  function removeIframeNode(card) {
    const iframe = card.iframeEl || card.element.querySelector(".page-iframe");
    card.iframeEl = null;
    if (iframe) iframe.remove();
  }

  function applyIframeRenderingStyles(iframe) {
    // Styling the iframe element cannot change fonts inside a cross-origin
    // document. Avoid forced 3D/image-rendering hints here: they cache the
    // whole page as a texture and make fractional canvas zoom look softer.
    iframe.style.display = "block";
  }

  function mountPageCardIframe(card, url, options = {}) {
    if (!card || card.type !== "page" || !url) return null;

    clearSleepTimer(card);
    removeIframeNode(card);

    const wrapper = card.element.querySelector(".iframe-wrapper");
    if (!wrapper) return null;

    const memory = ensureMemoryState(card);
    const iframe = document.createElement("iframe");
    iframe.className = "page-iframe";
    iframe.referrerPolicy = "no-referrer";
    applyIframeRenderingStyles(iframe);

    card.url = url;
    card.currentUrl = url;
    card.iframeEl = iframe;
    card.contentKind = "iframe";
    card.isHibernated = false;
    memory.phase = "waking";
    card.element.classList.add("has-iframe");

    const isWake = options.reason === "wake";
    showPlaceholder(
      card,
      isWake ? "↻" : "🌐",
      isWake ? "正在重新载入已释放的网页…" : "正在载入网页…"
    );

    iframe.addEventListener("load", () => {
      if (card.iframeEl !== iframe) return;
      memory.phase = "active";
      card.isHibernated = false;
      card.element.classList.remove("memory-sleeping");
      removePlaceholder(card);

      if (!memory.nearViewport) queuePageCardSleep(card);
    });

    iframe.src = url;
    wrapper.insertBefore(iframe, wrapper.firstChild);
    return iframe;
  }

  function destroyPageCardIframe(card, options = {}) {
    if (!card || card.type !== "page") return;

    clearSleepTimer(card);
    removeIframeNode(card);

    const memory = ensureMemoryState(card);
    memory.phase = options.hibernating ? "sleeping" : "idle";
    card.isHibernated = Boolean(options.hibernating);

    if (options.hibernating) {
      card.element.classList.add("memory-sleeping");
      showPlaceholder(card, "◌", "网页已离屏，内存已释放");
    } else {
      card.element.classList.remove("memory-sleeping");
      removePlaceholder(card);
    }
  }

  function hibernatePageCard(card) {
    if (!card.iframeEl || isCardFocused(card) || isCardWhiteListed(card)) return false;

    destroyPageCardIframe(card, { hibernating: true });
    console.log(`[Memory Manager] Released iframe ${card.id}: ${getCardUrl(card)}`);
    return true;
  }

  function wakePageCardIframe(card) {
    if (!card || card.type !== "page") return null;
    if (card.contentKind !== "iframe") return null;

    clearSleepTimer(card);
    if (card.iframeEl) return card.iframeEl;

    const url = getCardUrl(card);
    if (!url) return null;

    console.log(`[Memory Manager] Reloading iframe ${card.id}: ${url}`);
    return mountPageCardIframe(card, url, { reason: "wake" });
  }

  function queuePageCardSleep(card) {
    if (!card || card.type !== "page" || !card.iframeEl) return;
    if (isCardFocused(card) || isCardWhiteListed(card)) {
      clearSleepTimer(card);
      return;
    }

    const memory = ensureMemoryState(card);
    if (memory.nearViewport || memory.sleepTimer) return;

    memory.phase = "pending-sleep";
    memory.sleepTimer = setTimeout(() => {
      memory.sleepTimer = 0;
      if (memory.nearViewport || isCardFocused(card) || isCardWhiteListed(card)) {
        memory.phase = card.iframeEl ? "active" : "idle";
        return;
      }
      hibernatePageCard(card);
    }, OFFSCREEN_DELAY_MS);
  }

  function reevaluatePageCardMemory(card) {
    if (!card || card.type !== "page") return;

    const memory = ensureMemoryState(card);
    if (memory.nearViewport || isCardFocused(card) || isCardWhiteListed(card)) {
      clearSleepTimer(card);
      if (memory.nearViewport && card.isHibernated) wakePageCardIframe(card);
      return;
    }
    queuePageCardSleep(card);
  }

  const viewportElement = document.getElementById("viewport");
  const pageObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const cardId = Number(entry.target.dataset.id);
      const card = cardsList.find(item => item.id === cardId && item.type === "page");
      if (!card) return;

      const memory = ensureMemoryState(card);
      memory.nearViewport = entry.isIntersecting;

      if (entry.isIntersecting) {
        clearSleepTimer(card);
        if (card.isHibernated) wakePageCardIframe(card);
      } else {
        queuePageCardSleep(card);
      }
    });
  }, {
    root: viewportElement,
    rootMargin: `${PRELOAD_MARGIN_PX}px`,
    threshold: 0
  });

  function registerPageCardMemory(card) {
    if (!card || card.type !== "page") return;
    ensureMemoryState(card);
    pageObserver.observe(card.element);
  }

  function unregisterPageCardMemory(card) {
    if (!card || card.type !== "page") return;
    clearSleepTimer(card);
    pageObserver.unobserve(card.element);
  }

  window.addEventListener("message", event => {
    if (!event.data || event.data.source !== "SPACE_PAGE_NAVIGATED") return;
    if (typeof event.data.url !== "string" || !event.data.url) return;

    const card = cardsList.find(item =>
      item.type === "page" &&
      item.iframeEl &&
      item.iframeEl.contentWindow === event.source
    );
    if (!card) return;

    card.currentUrl = event.data.url;
    card.url = event.data.url;
    reevaluatePageCardMemory(card);
  });

  window.memoryManager = {
    whiteList,
    isCardWhiteListed,
    registerPageCardMemory,
    unregisterPageCardMemory,
    mountPageCardIframe,
    destroyPageCardIframe,
    wakePageCardIframe,
    reevaluatePageCardMemory
  };

  window.registerPageCardMemory = registerPageCardMemory;
  window.unregisterPageCardMemory = unregisterPageCardMemory;
  window.mountPageCardIframe = mountPageCardIframe;
  window.destroyPageCardIframe = destroyPageCardIframe;
  window.wakePageCardIframe = wakePageCardIframe;
  window.reevaluatePageCardMemory = reevaluatePageCardMemory;
})();

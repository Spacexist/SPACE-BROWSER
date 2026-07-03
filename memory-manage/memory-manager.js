// memory-manager.js
// Owns page-card iframe lifetime, off-screen hibernation, and domain white list.

(function initializeMemoryManager() {
  const OFFSCREEN_DELAY_MS = 30000;
  const PRELOAD_MARGIN_PX = 600;
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

  // --- SPACE MEMORY REGISTRY & CONSOLE UI ---

  let consoleEl = null;

  function renderMemoryConsoleContent() {
    if (!consoleEl) return;

    const stats = window.SPACE_MEM_REGISTRY.getStats();
    const list = cardsList.filter(c => c.type === "page");
    const whitelist = window.SPACE_MEM_REGISTRY.getWhitelist();

    let tableRows = "";
    if (list.length === 0) {
      tableRows = `<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.4); padding: 20px;">当前画布没有网页卡片</td></tr>`;
    } else {
      list.forEach(c => {
        const isHibernated = c.isHibernated;
        const statusBadge = isHibernated
          ? `<span class="mem-status-badge sleeping">已休眠</span>`
          : `<span class="mem-status-badge active">活跃中</span>`;
        const actionBtn = isHibernated
          ? `<button class="mem-btn" onclick="window.SPACE_MEM_REGISTRY.wakeCard(${c.id}); window.SPACE_MEM_REGISTRY.updateConsoleUI();">唤醒</button>`
          : `<button class="mem-btn danger" onclick="window.SPACE_MEM_REGISTRY.suspendCard(${c.id}); window.SPACE_MEM_REGISTRY.updateConsoleUI();">挂起</button>`;
        const urlDisplay = c.url ? (c.url.length > 32 ? c.url.slice(0, 32) + "..." : c.url) : "未载入";
        const isWhitelisted = isCardWhiteListed(c) ? "⭐️ 白名单" : "普通";
        
        tableRows += `
          <tr>
            <td>ID: ${c.id}</td>
            <td title="${c.url || ""}">${urlDisplay}</td>
            <td>${statusBadge}</td>
            <td>${isWhitelisted}</td>
            <td style="text-align: right;">${actionBtn}</td>
          </tr>
        `;
      });
    }

    let whitelistTags = "";
    if (whitelist.length === 0) {
      whitelistTags = `<span style="font-size: 11px; color: rgba(255,255,255,0.3);">无白名单域名</span>`;
    } else {
      whitelist.forEach(domain => {
        whitelistTags += `<span class="mem-whitelist-tag">${domain}</span>`;
      });
    }

    consoleEl.innerHTML = `
      <div class="mem-con-header">
        <h3>🧠 内存管理器控制台 (Memory Console)</h3>
        <button class="mem-con-close" onclick="window.SPACE_MEM_REGISTRY.closeConsoleUI()">×</button>
      </div>
      <div class="mem-con-body">
        <div class="mem-stats-row">
          <div class="mem-stat-card">
            <div class="mem-stat-val">${stats.total}</div>
            <div class="mem-stat-label">总网页数</div>
          </div>
          <div class="mem-stat-card">
            <div class="mem-stat-val" style="color: #4ade80;">${stats.active}</div>
            <div class="mem-stat-label">活跃卡片</div>
          </div>
          <div class="mem-stat-card">
            <div class="mem-stat-val" style="color: #eab308;">${stats.sleeping}</div>
            <div class="mem-stat-label">休眠卡片</div>
          </div>
        </div>

        <div class="mem-table-container">
          <table class="mem-table">
            <thead>
              <tr>
                <th>卡片 ID</th>
                <th>当前网址</th>
                <th>运行状态</th>
                <th>类别</th>
                <th style="text-align: right;">手动操作</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>

        <div class="mem-whitelist-section">
          <div class="mem-whitelist-title">⭐️ 内存挂起域名白名单</div>
          <div class="mem-whitelist-tags">
            ${whitelistTags}
          </div>
          <div class="mem-whitelist-input-row">
            <input type="text" class="mem-whitelist-input" placeholder="输入要加入白名单的域名 (如 github.com)">
            <button class="mem-btn" onclick="window.SPACE_MEM_REGISTRY.addWhitelistFromUI()">添加</button>
          </div>
        </div>
      </div>
    `;
  }

  function toggleMemoryConsoleUI() {
    if (consoleEl) {
      consoleEl.remove();
      consoleEl = null;
      return;
    }

    consoleEl = document.createElement("div");
    consoleEl.id = "space-memory-console-ui";
    
    if (!document.getElementById("space-memory-console-styles")) {
      const styles = document.createElement("style");
      styles.id = "space-memory-console-styles";
      styles.textContent = `
        #space-memory-console-ui {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 680px;
          max-width: 90vw;
          max-height: 80vh;
          background: rgba(20, 20, 20, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 24px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), inset 0 0 20px rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          color: #e2e8f0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          z-index: 99999;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: consoleFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes consoleFadeIn {
          from { opacity: 0; transform: translate(-50%, -46%) scale(0.96); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        .mem-con-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.02);
        }
        .mem-con-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #ffffff;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .mem-con-close {
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.5);
          font-size: 20px;
          cursor: pointer;
          transition: color 0.15s;
        }
        .mem-con-close:hover {
          color: #ff5568;
        }
        .mem-con-body {
          padding: 20px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .mem-stats-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .mem-stat-card {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
        }
        .mem-stat-val {
          font-size: 22px;
          font-weight: bold;
          color: #4ade80;
          margin-bottom: 4px;
        }
        .mem-stat-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .mem-table-container {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          overflow: hidden;
          background: rgba(0, 0, 0, 0.2);
        }
        .mem-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          text-align: left;
        }
        .mem-table th, .mem-table td {
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .mem-table th {
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 255, 255, 0.7);
          font-weight: 600;
        }
        .mem-table tr:last-child td {
          border-bottom: none;
        }
        .mem-status-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 20px;
          font-size: 10px;
          font-weight: 600;
        }
        .mem-status-badge.active {
          background: rgba(74, 222, 128, 0.15);
          color: #4ade80;
        }
        .mem-status-badge.sleeping {
          background: rgba(234, 179, 8, 0.15);
          color: #eab308;
        }
        .mem-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #ffffff;
          padding: 4px 8px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 11px;
          transition: all 0.15s;
          outline: none;
        }
        .mem-btn:hover {
          background: rgba(255, 255, 255, 0.18);
        }
        .mem-btn.danger:hover {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border-color: rgba(239, 68, 68, 0.3);
        }
        .mem-whitelist-section {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          padding: 14px;
        }
        .mem-whitelist-title {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 8px;
          color: #ffffff;
        }
        .mem-whitelist-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }
        .mem-whitelist-tag {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          padding: 2px 8px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.8);
        }
        .mem-whitelist-input-row {
          display: flex;
          gap: 8px;
        }
        .mem-whitelist-input {
          flex: 1;
          background: #111;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: #ffffff;
          font-size: 12px;
          padding: 6px 10px;
          outline: none;
        }
        .mem-whitelist-input:focus {
          border-color: rgba(255, 255, 255, 0.25);
        }
      `;
      document.head.appendChild(styles);
    }

    renderMemoryConsoleContent();
    document.body.appendChild(consoleEl);
  }

  window.SPACE_MEM_REGISTRY = {
    getStats: () => {
      const total = cardsList.filter(c => c.type === "page").length;
      const active = cardsList.filter(c => c.type === "page" && c.iframeEl).length;
      const sleeping = cardsList.filter(c => c.type === "page" && c.isHibernated).length;
      return { total, active, sleeping };
    },
    getCardState: (cardId) => {
      const card = cardsList.find(c => c.id === cardId);
      if (!card || card.type !== "page") return null;
      return {
        id: card.id,
        url: card.url,
        currentUrl: card.currentUrl,
        isHibernated: card.isHibernated,
        phase: card.memoryState ? card.memoryState.phase : "unknown",
        nearViewport: card.memoryState ? card.memoryState.nearViewport : false,
        isWhitelisted: isCardWhiteListed(card)
      };
    },
    wakeCard: (cardId) => {
      const card = cardsList.find(c => c.id === cardId);
      if (!card || card.type !== "page") return false;
      wakePageCardIframe(card);
      return true;
    },
    suspendCard: (cardId) => {
      const card = cardsList.find(c => c.id === cardId);
      if (!card || card.type !== "page") return false;
      hibernatePageCard(card);
      return true;
    },
    getWhitelist: () => Array.from(whiteList),
    addToWhitelist: (domain) => {
      const norm = normalizeDomain(domain);
      if (norm) {
        whiteList.add(norm);
        cardsList.forEach(c => {
          if (c.type === "page") reevaluatePageCardMemory(c);
        });
      }
    },
    updateConsoleUI: () => {
      renderMemoryConsoleContent();
    },
    closeConsoleUI: () => {
      if (consoleEl) {
        consoleEl.remove();
        consoleEl = null;
      }
    },
    addWhitelistFromUI: () => {
      const input = consoleEl.querySelector(".mem-whitelist-input");
      if (input && input.value.trim()) {
        window.SPACE_MEM_REGISTRY.addToWhitelist(input.value.trim());
        input.value = "";
        renderMemoryConsoleContent();
      }
    }
  };

  // Listen for the secret cheat code `//**//**` to toggle console UI
  let keyBuffer = "";
  const CHEAT_CODE = "//**//**";

  window.addEventListener("keydown", event => {
    if (event.key.length === 1) {
      keyBuffer += event.key;
      if (keyBuffer.length > CHEAT_CODE.length) {
        keyBuffer = keyBuffer.slice(-CHEAT_CODE.length);
      }
      if (keyBuffer === CHEAT_CODE) {
        keyBuffer = ""; // Reset
        toggleMemoryConsoleUI();
      }
    }
  });
})();

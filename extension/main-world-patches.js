// main-world-patches.js
// Runs in the webpage's MAIN world context to monkeypatch APIs natively.
// This bypasses strict Content Security Policy (CSP) blocks that prevent inline script injection.

(function() {
  // A. Monkeypatch window.open to redirect popups internally unless they specify window features (like OAuth popups)
  const originalOpen = window.open;
  window.open = function(url, target, features) {
    if (!url) return null;
    
    // Heuristic: If features are specified (like width, height), it is likely an auth/login popup.
    // Let it open natively so that third-party cookie/login flows work correctly in a top-level context.
    if (features && features.trim().length > 0) {
      try {
        return originalOpen.apply(this, arguments);
      } catch(e) {
        // Fallback to internal redirect if blocked
      }
    }
    
    if (!target || target === '_blank') {
      window.location.href = url;
      return window;
    }
    try {
      return originalOpen.apply(this, arguments);
    } catch(e) {
      window.location.href = url;
      return window;
    }
  };

  // B. Bypass frame-busting scripts by redefining window.top and window.parent.
  // Only return window.self if the parent is cross-origin (avoids breaking same-origin sub-iframes).
  try {
    Object.defineProperty(window, 'top', {
      get: function() {
        try {
          if (window.self.location.href && window.top.location.href) {
            return window.top;
          }
        } catch(e) {
          // Cross-origin top window (e.g. our file:/// canvas)
        }
        return window.self;
      },
      configurable: true
    });

    Object.defineProperty(window, 'parent', {
      get: function() {
        try {
          if (window.self.location.href && window.parent.location.href) {
            return window.parent;
          }
        } catch(e) {
          // Cross-origin parent
        }
        return window.self;
      },
      configurable: true
    });
  } catch (err) {
    console.warn("SPACE-BROWSER: Failed to define top/parent properties:", err);
  }

  // C. Intercept history pushState / replaceState for SPA routing updates
  try {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    function notifyNavChange() {
      setTimeout(() => {
        window.postMessage({ source: "SPACE_INTERNAL_NAV", url: window.location.href }, "*");
      }, 50);
    }
    
    history.pushState = function() {
      originalPushState.apply(this, arguments);
      notifyNavChange();
    };
    
    history.replaceState = function() {
      originalReplaceState.apply(this, arguments);
      notifyNavChange();
    };
  } catch(err) {
    console.warn("SPACE-BROWSER: Failed to patch pushState/replaceState:", err);
  }
})();

(function() {
  // Helper to send navigation info to the parent Canvas window
  function reportNavigation() {
    try {
      window.parent.postMessage({
        source: "SPACE_PAGE_NAVIGATED",
        url: window.location.href
      }, "*");
    } catch (e) {
      // Ignore security errors
    }

    try {
      chrome.runtime.sendMessage({
        action: "register_domain",
        url: window.location.href
      });
    } catch (e) {
      // Ignore extension context invalidated errors
    }
  }

  // 1. Listen for page load events
  if (document.readyState === "complete" || document.readyState === "interactive") {
    reportNavigation();
  } else {
    document.addEventListener("DOMContentLoaded", reportNavigation);
    window.addEventListener("load", reportNavigation);
  }

  // 2. Intercept standard clicks on links and force them to stay in the same frame
  document.addEventListener('click', function(event) {
    const anchor = event.target.closest('a');
    if (anchor && anchor.href) {
      if (anchor.target === '_blank') {
        anchor.target = '_self';
      }
    }
  }, true);

  // 3. Intercept form submissions and force target to _self
  document.addEventListener('submit', function(event) {
    const form = event.target.closest('form');
    if (form) {
      if (form.target === '_blank') {
        form.target = '_self';
      }
    }
  }, true);

  // 4. Listen for navigation controls from the Canvas parent window
  window.addEventListener("message", function(event) {
    if (event.data && event.data.source === "SPACE_PAGE_CONTROL") {
      const { action } = event.data;
      if (action === "back") {
        window.history.back();
      } else if (action === "refresh") {
        window.location.reload();
      }
    } else if (event.data && event.data.source === "SPACE_INTERNAL_NAV") {
      // Handle SPA navigation reported from the main world
      reportNavigation();
    }
  });

  // 5. Inject JS patches into the page's main world context
  try {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        // A. Monkeypatch window.open to redirect popups internally
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
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (err) {
    console.error('SPACE-BROWSER: Failed to inject main world patches:', err);
  }
})();

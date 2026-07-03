(function() {
  // 1. Intercept standard clicks on links and force them to stay in the same frame
  document.addEventListener('click', function(event) {
    const anchor = event.target.closest('a');
    if (anchor && anchor.href) {
      if (anchor.target === '_blank') {
        anchor.target = '_self';
      }
    }
  }, true);

  // 2. Intercept form submissions and force target to _self
  document.addEventListener('submit', function(event) {
    const form = event.target.closest('form');
    if (form) {
      if (form.target === '_blank') {
        form.target = '_self';
      }
    }
  }, true);

  // 3. Inject JS patches into the page's main world context
  try {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        // A. Monkeypatch window.open to redirect popups internally
        const originalOpen = window.open;
        window.open = function(url, target, features) {
          if (!url) return null;
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
        // Only return window.self if the parent is cross-origin (avoids breaking same-origin sub-frames).
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
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (err) {
    console.error('SPACE-BROWSER: Failed to inject main world patches:', err);
  }
})();

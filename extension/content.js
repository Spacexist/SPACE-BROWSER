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

  // 3. Monkeypatch window.open inside the page's main world context to direct popups internally
  try {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
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
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (err) {
    console.error('Failed to inject window.open proxy:', err);
  }
})();

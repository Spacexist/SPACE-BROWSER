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

  // 4. Escape belongs to the outer Canvas while a page card is focused.
  // Consume both halves of the keystroke in the earliest capture phase so the
  // embedded site cannot also close a modal, leave fullscreen, or handle keyup.
  function isEscapeKey(event) {
    return event.key === "Escape" || event.code === "Escape" || event.keyCode === 27;
  }

  function isEmbeddedFrame() {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }

  function captureEscape(event) {
    if (!isEmbeddedFrame() || !isEscapeKey(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (event.type !== "keydown" || event.repeat) return;

    try {
      window.parent.postMessage({ source: "SPACE_ESCAPE_PRESSED" }, "*");
    } catch (e) {
      console.error("[Content Script] Failed to post SPACE_ESCAPE_PRESSED:", e);
    }
  }

  window.addEventListener("keydown", captureEscape, true);
  window.addEventListener("keyup", captureEscape, true);

  // 5. Listen for navigation controls from the Canvas parent window
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
    } else if (event.data && event.data.source === "SPACE_ESCAPE_PRESSED") {
      // Forward the escape message up (for nested frames support)
      if (!isEmbeddedFrame()) return;
      try {
        window.parent.postMessage({ source: "SPACE_ESCAPE_PRESSED" }, "*");
      } catch (e) {
        // Ignore
      }
    }
  });

})();

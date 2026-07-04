(function() {
  let heldTargetInfo = null;

  function isFormControl(target) {
    return Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function resolveTargetAtPoint(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY) ||
      document.body ||
      document.documentElement;
    return target ? {
      target,
      client: { x: clientX, y: clientY }
    } : null;
  }

  function resolveClickableElement(target) {
    if (!target || typeof target.closest !== "function") return target;
    return target.closest([
      "[data-focus-control]",
      "button",
      "a[href]",
      "label",
      "summary",
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="checkbox"]',
      'input[type="radio"]'
    ].join(", ")) || target;
  }

  function dispatchMouse(targetInfo, type, options = {}) {
    if (!targetInfo || !targetInfo.target) return false;
    targetInfo.target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: targetInfo.client.x,
      clientY: targetInfo.client.y,
      button: Number(options.button) || 0,
      buttons: type === "mouseup" || type === "click" ? 0 : 1
    }));
    return true;
  }

  function focusEditableTarget(targetInfo) {
    if (!targetInfo || !targetInfo.target) return false;
    const target = targetInfo.target;

    if (isFormControl(target)) {
      if (typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
      return true;
    }

    if (!target.isContentEditable) return false;
    if (typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }

    try {
      if (typeof document.caretPositionFromPoint === "function") {
        const caret = document.caretPositionFromPoint(targetInfo.client.x, targetInfo.client.y);
        if (caret && window.getSelection) {
          const range = document.createRange();
          range.setStart(caret.offsetNode, caret.offset);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
      }

      if (typeof document.caretRangeFromPoint === "function") {
        const range = document.caretRangeFromPoint(targetInfo.client.x, targetInfo.client.y);
        if (range && window.getSelection) {
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
      }
    } catch (e) {
      return true;
    }

    return true;
  }

  function performSemanticClick(targetInfo) {
    if (!targetInfo || !targetInfo.target) return false;
    if (focusEditableTarget(targetInfo)) return true;

    const clickable = resolveClickableElement(targetInfo.target);
    if (clickable && typeof clickable.click === "function") {
      clickable.click();
      return true;
    }

    return dispatchMouse({
      ...targetInfo,
      target: clickable || targetInfo.target
    }, "click");
  }

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
      } else if (action === "agent_click") {
        const targetInfo = resolveTargetAtPoint(
          Number(event.data.clientX),
          Number(event.data.clientY)
        );
        if (targetInfo) {
          dispatchMouse(targetInfo, "mousedown", event.data);
          dispatchMouse(targetInfo, "mouseup", event.data);
          performSemanticClick(targetInfo);
        }
      } else if (action === "agent_hold") {
        const targetInfo = resolveTargetAtPoint(
          Number(event.data.clientX),
          Number(event.data.clientY)
        );
        if (targetInfo) {
          dispatchMouse(targetInfo, "mousedown", event.data);
          focusEditableTarget(targetInfo);
          heldTargetInfo = targetInfo;
        }
      } else if (action === "agent_release") {
        if (heldTargetInfo) {
          dispatchMouse(heldTargetInfo, "mouseup", event.data);
          heldTargetInfo = null;
        }
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

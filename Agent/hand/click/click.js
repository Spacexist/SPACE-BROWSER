// Agent/hand/click/click.js
// Click action module. Converts AI-friendly point descriptions into DOM clicks.

(function initializeAgentHandClick() {
  function normalizePoint(payload = {}, context = {}) {
    if (!payload || typeof payload !== "object") return null;
    if (context.normalizeActionPointPayload) {
      const normalized = context.normalizeActionPointPayload(payload, {
        fallbackSpace: "screen",
        physicalKey: "p",
        screenKey: "s",
        clientKey: "c"
      });
      if (normalized) return normalized;
    }

    return null;
  }

  function dispatchMouse(targetInfo, type, options = {}) {
    if (!targetInfo || !targetInfo.target || !targetInfo.client) return false;

    targetInfo.target.dispatchEvent(new targetInfo.windowRef.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: targetInfo.windowRef,
      clientX: targetInfo.client.x,
      clientY: targetInfo.client.y,
      button: Number(options.button) || 0,
      buttons: type === "mouseup" || type === "click" ? 0 : 1
    }));
    return true;
  }

  function resolveTargetInfo(client) {
    const rootTarget = document.elementFromPoint(client.x, client.y);
    if (!rootTarget) return null;

    if (rootTarget.tagName === "IFRAME") {
      const rect = rootTarget.getBoundingClientRect();
      const innerClient = {
        x: client.x - rect.left,
        y: client.y - rect.top
      };

      try {
        const documentRef = rootTarget.contentDocument;
        const windowRef = rootTarget.contentWindow;
        const target = documentRef &&
          (documentRef.elementFromPoint(innerClient.x, innerClient.y) ||
            documentRef.body ||
            documentRef.documentElement);
        if (target && windowRef) {
          return {
            kind: "iframe",
            iframe: rootTarget,
            target,
            client: innerClient,
            windowRef,
            documentRef
          };
        }
      } catch (error) {
        return {
          kind: "iframe-cross-origin",
          iframe: rootTarget,
          target: rootTarget,
          client,
          windowRef: window,
          documentRef: document
        };
      }
    }

    return {
      kind: "document",
      target: rootTarget,
      client,
      windowRef: window,
      documentRef: document
    };
  }

  function sendIframeControl(targetInfo, action, options = {}) {
    if (!targetInfo || !targetInfo.iframe || !targetInfo.client) return false;
    try {
      targetInfo.iframe.contentWindow.postMessage({
        source: "SPACE_PAGE_CONTROL",
        action,
        clientX: targetInfo.client.x,
        clientY: targetInfo.client.y,
        button: Number(options.button) || 0
      }, "*");
      return true;
    } catch (error) {
      return false;
    }
  }

  function isFormControl(target) {
    return Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function focusEditableTarget(targetInfo) {
    if (!targetInfo || !targetInfo.target) return false;

    const target = targetInfo.target;
    if (targetInfo.kind === "iframe-cross-origin") {
      if (typeof target.focus === "function") target.focus();
      return true;
    }

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

    const doc = targetInfo.documentRef;
    const win = targetInfo.windowRef;
    const point = targetInfo.client;

    try {
      if (typeof doc.caretPositionFromPoint === "function") {
        const caret = doc.caretPositionFromPoint(point.x, point.y);
        if (caret && win.getSelection) {
          const range = doc.createRange();
          range.setStart(caret.offsetNode, caret.offset);
          range.collapse(true);
          const selection = win.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
      }

      if (typeof doc.caretRangeFromPoint === "function") {
        const range = doc.caretRangeFromPoint(point.x, point.y);
        if (range && win.getSelection) {
          const selection = win.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
      }
    } catch (error) {
      return true;
    }

    return true;
  }

  function resolveClickableElement(target) {
    if (!target || typeof target.closest !== "function") return target;

    return target.closest([
      ".card-close",
      ".page-btn",
      ".page-nav-btn",
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

  function performSemanticClick(targetInfo, options = {}) {
    if (!targetInfo || !targetInfo.target) return false;

    if (targetInfo.kind === "iframe-cross-origin") {
      return sendIframeControl(targetInfo, "agent_click", options);
    }

    if (focusEditableTarget(targetInfo)) {
      return true;
    }

    const clickable = resolveClickableElement(targetInfo.target);
    if (clickable && typeof clickable.click === "function" && clickable !== targetInfo.target) {
      clickable.click();
      return true;
    }

    if (clickable && typeof clickable.click === "function" && (
      clickable.tagName === "BUTTON" ||
      clickable.tagName === "A" ||
      clickable.tagName === "LABEL" ||
      clickable.tagName === "SUMMARY" ||
      clickable.classList.contains("card-close") ||
      clickable.classList.contains("page-btn") ||
      clickable.classList.contains("page-nav-btn") ||
      clickable.hasAttribute("data-focus-control") ||
      clickable.tagName === "INPUT"
    )) {
      clickable.click();
      return true;
    }

    return dispatchMouse({
      ...targetInfo,
      target: clickable || targetInfo.target
    }, "click", options);
  }

  async function run(payload = {}, options = {}, context = {}) {
    let point = normalizePoint(payload, context);
    const mergedOptions = context.mergeActionOptions
      ? context.mergeActionOptions(payload.move || payload.cursor, options)
      : { ...(payload.move || payload.cursor || {}), ...(options || {}) };
    const clickOptions = context.getClickOptions
      ? context.getClickOptions(mergedOptions)
      : mergedOptions;
    const cursor = context.getCursor ? context.getCursor() : null;
    const card = !point && context.resolveCard ? context.resolveCard(payload) : null;
    const cardTarget = !point && card && context.getCardActionClientPoint
      ? context.getCardActionClientPoint(card, "click")
      : null;
    if (!point && cardTarget && cardTarget.client) {
      point = {
        space: "client",
        x: cardTarget.client.x,
        y: cardTarget.client.y
      };
    }
    let cursorState = null;

    if (point) {
      if (point.space === "client") {
        if (!context.moveCursorTo) throw new Error("Hand context missing moveCursorTo()");
        cursorState = await context.moveCursorTo(point.x, point.y, clickOptions);
      } else {
        if (!context.moveTo) throw new Error("Hand context missing moveTo()");
        cursorState = await context.moveTo(point, clickOptions);
      }
    } else {
      cursorState = cursor && typeof cursor.get === "function"
        ? cursor.get()
        : null;
    }

    const client = cursorState && cursorState.points
      ? cursorState.points.client
      : (point && context.resolveClientPoint ? context.resolveClientPoint(point) : null);
    if (!client) {
      throw new Error("Click requires a cursor position or point");
    }

    const targetInfo = resolveTargetInfo(client);
    if (cursor && typeof cursor.press === "function") cursor.press();
    if (targetInfo && targetInfo.kind === "iframe-cross-origin") {
      sendIframeControl(targetInfo, "agent_hold", clickOptions);
    } else {
      dispatchMouse(targetInfo, "mousedown", clickOptions);
      focusEditableTarget(targetInfo);
    }
    if (context.sleep) {
      await context.sleep(Number(clickOptions.holdMs) || 40);
    }
    if (targetInfo && targetInfo.kind === "iframe-cross-origin") {
      sendIframeControl(targetInfo, "agent_release", clickOptions);
    } else {
      dispatchMouse(targetInfo, "mouseup", clickOptions);
    }
    const clicked = performSemanticClick(targetInfo, clickOptions);
    if (cursor && typeof cursor.release === "function") cursor.release();

    return {
      ok: Boolean(clicked && targetInfo && targetInfo.target),
      point,
      client,
      target: targetInfo ? targetInfo.target : null,
      card: card || null,
      cursor: cursorState,
      detail: targetInfo && targetInfo.target
        ? `clicked ${targetInfo.target.tagName.toLowerCase()} at ${Math.round(client.x)}, ${Math.round(client.y)}`
        : `no target at ${Math.round(client.x)}, ${Math.round(client.y)}`
    };
  }

  window.AgentHandClick = {
    run,
    normalizePoint
  };
})();

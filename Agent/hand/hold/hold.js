// Agent/hand/hold/hold.js
// Hold action module. Presses at the current cursor position and keeps it down.

(function initializeAgentHandHold() {
  let pressedState = null;

  function normalizePoint(payload = {}, context = {}) {
    if (!payload || typeof payload !== "object") return null;
    if (!context.normalizeActionPointPayload) return null;

    return context.normalizeActionPointPayload(payload, {
      fallbackSpace: payload.space || "screen",
      physicalKey: "p",
      screenKey: "s",
      clientKey: "c"
    });
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

  function resolveHoldDuration(payload = {}, options = {}, clickOptions = {}) {
    const candidates = [
      payload.holdDuration,
      payload.holdMs,
      options.holdDuration,
      options.holdMs,
      payload.duration,
      options.duration,
      clickOptions.holdMs
    ];

    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value >= 0) {
        return value;
      }
    }

    return 40;
  }

  async function run(payload = {}, options = {}, context = {}) {
    const mergedOptions = context.mergeActionOptions
      ? context.mergeActionOptions(payload.move || payload.cursor, options)
      : { ...(payload.move || payload.cursor || {}), ...(options || {}) };
    const holdOptions = context.getClickOptions
      ? context.getClickOptions(mergedOptions)
      : mergedOptions;
    let point = normalizePoint(payload, context);
    const card = !point && context.resolveCard ? context.resolveCard(payload) : null;
    const cardTarget = !point && card && context.getCardActionClientPoint
      ? context.getCardActionClientPoint(card, "hold")
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
        cursorState = await context.moveCursorTo(point.x, point.y, holdOptions);
      } else {
        if (!context.moveTo) throw new Error("Hand context missing moveTo()");
        cursorState = await context.moveTo(point, holdOptions);
      }
    } else {
      const cursor = context.getCursor ? context.getCursor() : null;
      cursorState = cursor && typeof cursor.get === "function"
        ? cursor.get()
        : null;
    }

    const cursor = context.getCursor ? context.getCursor() : null;
    const client = cursorState && cursorState.points
      ? cursorState.points.client
      : null;
    if (!client) {
      throw new Error("Hold requires a cursor position or point");
    }

    const targetInfo = resolveTargetInfo(client);
    if (cursor && typeof cursor.press === "function") cursor.press();

    if (holdOptions.dispatch !== false) {
      if (targetInfo && targetInfo.kind === "iframe-cross-origin") {
        sendIframeControl(targetInfo, "agent_hold", holdOptions);
      } else {
        dispatchMouse(targetInfo, "mousedown", holdOptions);
        focusEditableTarget(targetInfo);
      }
    }

    pressedState = {
      targetInfo,
      holdOptions
    };

    const duration = resolveHoldDuration(payload, options, holdOptions);
    if (context.sleep && duration > 0) {
      await context.sleep(duration);
    }

    return {
      ok: Boolean(targetInfo && targetInfo.target),
      pressed: true,
      point: point || (cursorState && cursorState.points ? cursorState.points.screen : null),
      client,
      target: targetInfo ? targetInfo.target : null,
      card: card || null,
      cursor: cursor && typeof cursor.get === "function" ? cursor.get() : cursorState,
      detail: targetInfo && targetInfo.target
        ? `held ${targetInfo.target.tagName.toLowerCase()} at ${Math.round(client.x)}, ${Math.round(client.y)}`
        : `held cursor at ${Math.round(client.x)}, ${Math.round(client.y)}`
    };
  }

  function release(context = {}, options = {}) {
    const active = pressedState;
    pressedState = null;

    if (!active || !active.targetInfo) {
      return {
        ok: true,
        released: true,
        detail: options.detail || "released cursor"
      };
    }

    const releaseOptions = {
      ...(active.holdOptions || {}),
      ...(options || {})
    };
    if (active.targetInfo.kind === "iframe-cross-origin") {
      sendIframeControl(active.targetInfo, "agent_release", releaseOptions);
    } else {
      dispatchMouse(active.targetInfo, "mouseup", releaseOptions);
    }

    return {
      ok: true,
      released: true,
      target: active.targetInfo.target,
      detail: options.detail || "released hold target"
    };
  }

  window.AgentHandHold = {
    run,
    release,
    getPressedState: () => pressedState
  };
})();

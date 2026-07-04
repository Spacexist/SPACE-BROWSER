// Agent/hand.js
// Physical actions only. Information chooses targets; Hand mutates UI state.

(function initializeAgentHand() {
  const DEFAULT_CONFIG = {
    move: {
      duration: 520,
      steps: 28,
      margin: 96,
      follow: true,
      followDuration: 260
    },
    click: {
      holdMs: 40
    },
    drag: {
      holdMs: 70,
      duration: 760,
      steps: 34,
      follow: true,
      margin: 96
    },
    zoom: {
      duration: 220,
      factor: 1.3,
      min: 0.04,
      max: 8
    },
    scroll: {
      deltaY: 480
    },
    runner: {
      backend: "dom"
    }
  };

  let handConfig = cloneConfig(DEFAULT_CONFIG);
  let configReady = loadConfig();

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function cloneConfig(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeConfig(base, next) {
    const merged = cloneConfig(base);
    if (!next || typeof next !== "object") return merged;

    Object.keys(next).forEach(key => {
      const value = next[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        merged[key] = mergeConfig(merged[key] || {}, value);
      } else if (value !== undefined) {
        merged[key] = value;
      }
    });

    return merged;
  }

  function pickDefined(options = {}) {
    const clean = {};
    Object.keys(options).forEach(key => {
      if (options[key] !== undefined && options[key] !== null && options[key] !== "") {
        clean[key] = options[key];
      }
    });
    return clean;
  }

  function normalizeSpaceName(space, fallback = "screen") {
    const value = String(space || fallback).trim().toLowerCase();
    if (value === "p") return "physical";
    if (value === "s") return "screen";
    if (value === "c") return "client";
    if (value === "physical" || value === "screen" || value === "client") return value;
    return fallback;
  }

  function normalizeXYPoint(point, space) {
    if (!point || typeof point !== "object") return null;

    const x = Number(point.x !== undefined ? point.x : point.clientX);
    const y = Number(point.y !== undefined ? point.y : point.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`${space} point requires finite x and y`);
    }

    return { space, x, y };
  }

  function normalizeActionPointPayload(payload = {}, options = {}) {
    const source = payload && typeof payload === "object" ? payload : {};
    const fallbackSpace = normalizeSpaceName(options.fallbackSpace || source.space || "screen");
    const physicalKey = options.physicalKey || "p";
    const screenKey = options.screenKey || "s";
    const clientKey = options.clientKey || "c";
    const physicalPoint = source[physicalKey] || source.physical;
    const screenPoint = source[screenKey] || source.screen;
    const clientPoint = source[clientKey] || source.client;

    if (source.point && typeof source.point === "object") {
      return normalizeActionPointPayload(source.point, options);
    }

    if (source.x !== undefined || source.y !== undefined ||
        source.clientX !== undefined || source.clientY !== undefined) {
      return normalizeXYPoint(source, normalizeSpaceName(source.space, fallbackSpace));
    }

    const explicitSpace = source.space ? normalizeSpaceName(source.space, fallbackSpace) : "";
    if ((explicitSpace === "physical" || (!explicitSpace && physicalPoint))) {
      const normalized = normalizeXYPoint(physicalPoint, "physical");
      if (normalized) return normalized;
    }
    if ((explicitSpace === "screen" || (!explicitSpace && screenPoint))) {
      const normalized = normalizeXYPoint(screenPoint, "screen");
      if (normalized) return normalized;
    }
    if ((explicitSpace === "client" || (!explicitSpace && clientPoint))) {
      const normalized = normalizeXYPoint(clientPoint, "client");
      if (normalized) return normalized;
    }

    if (physicalPoint) return normalizeXYPoint(physicalPoint, "physical");
    if (screenPoint) return normalizeXYPoint(screenPoint, "screen");
    if (clientPoint) return normalizeXYPoint(clientPoint, "client");
    return null;
  }

  function normalizeCardReference(payload) {
    if (payload === undefined || payload === null) return null;
    if (typeof payload !== "object" || payload.element) return payload;

    if (payload.card !== undefined) return payload.card;
    if (payload.cardId !== undefined && payload.cardId !== "") return { id: Number(payload.cardId) };
    if (payload.CardID !== undefined && payload.CardID !== "") return { id: Number(payload.CardID) };
    if (payload.id !== undefined && payload.id !== "") return { id: Number(payload.id) };
    if (payload.ID !== undefined && payload.ID !== "") return { id: Number(payload.ID) };
    return payload;
  }

  function mergeActionOptions(cursorOptions = {}, options = {}) {
    return {
      ...pickDefined(cursorOptions || {}),
      ...pickDefined(options || {})
    };
  }

  function getConfigUrl() {
    const script = document.currentScript;
    const baseUrl = script && script.src ? script.src : window.location.href;
    return new URL("hand/config.json", baseUrl).toString();
  }

  function isFileProtocolConfigUrl(configUrl) {
    try {
      return new URL(configUrl).protocol === "file:";
    } catch (error) {
      return false;
    }
  }

  async function loadConfig() {
    const configUrl = getConfigUrl();
    try {
      if (isFileProtocolConfigUrl(configUrl)) {
        handConfig = cloneConfig(DEFAULT_CONFIG);
      } else {
        const response = await fetch(configUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const fileConfig = await response.json();
        handConfig = mergeConfig(DEFAULT_CONFIG, fileConfig);
      }
    } catch (error) {
      handConfig = cloneConfig(DEFAULT_CONFIG);
    }

    if (window.AgentRunner && typeof AgentRunner.setConfig === "function") {
      AgentRunner.setConfig(handConfig.runner || {});
    }

    window.dispatchEvent(new CustomEvent("agent-hand-config-ready", {
      detail: getConfig()
    }));
    return getConfig();
  }

  function getConfig() {
    return cloneConfig(handConfig);
  }

  function setConfig(nextConfig) {
    handConfig = mergeConfig(handConfig, nextConfig);
    if (nextConfig && nextConfig.runner && window.AgentRunner &&
        typeof AgentRunner.setConfig === "function") {
      AgentRunner.setConfig(nextConfig.runner);
    }
    window.dispatchEvent(new CustomEvent("agent-hand-config-ready", {
      detail: getConfig()
    }));
    return getConfig();
  }

  function getMoveOptions(options = {}) {
    return {
      ...(handConfig.move || handConfig.cursor || {}),
      ...pickDefined(options)
    };
  }

  function getCursorOptions(options = {}) {
    return getMoveOptions(options);
  }

  function getClickOptions(options = {}) {
    return {
      ...getMoveOptions(options),
      ...(handConfig.click || {}),
      ...pickDefined(options)
    };
  }

  function getDragOptions(options = {}) {
    return {
      ...getMoveOptions(options),
      ...(handConfig.drag || {}),
      ...pickDefined(options)
    };
  }

  function getZoomOptions(options = {}) {
    return {
      ...(handConfig.zoom || {}),
      ...pickDefined(options)
    };
  }

  function getCursor() {
    return window.AgentMove ||
      window.AgentVisualMove ||
      window.AgentCursor ||
      window.AgentVisualCursor ||
      null;
  }

  function getRunner() {
    return window.AgentRunner || null;
  }

  function getCurrentCursorState() {
    const cursor = getCursor();
    return cursor && typeof cursor.get === "function"
      ? cursor.get()
      : null;
  }

  function getRunnerOptions(options = {}) {
    return {
      ...(handConfig.runner || {}),
      ...pickDefined(options)
    };
  }

  function getBackendName(options = {}) {
    return String(
      options.backend ||
      (handConfig.runner && handConfig.runner.backend) ||
      "dom"
    ).trim().toLowerCase();
  }

  function shouldUseRunnerBackend(options = {}) {
    return false;
  }

  function describeCard(card) {
    return window.AgentInformation && typeof AgentInformation.describeCard === "function"
      ? AgentInformation.describeCard(card)
      : card;
  }

  function resolveClientPoint(point) {
    if (!point || typeof point !== "object") {
      throw new Error("Point must be an object");
    }

    const space = point.space || (
      point.clientX !== undefined || point.clientY !== undefined
        ? "client"
        : "screen"
    );
    const x = Number(point.x !== undefined ? point.x : point.clientX);
    const y = Number(point.y !== undefined ? point.y : point.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Point requires finite x and y");
    }

    if (space === "client") {
      return { x, y };
    }
    if (space === "screen") {
      return screenToClient(x, y);
    }
    if (space === "physical") {
      return worldToClient(x, y);
    }

    throw new Error('Point space must be "client", "screen", or "physical"');
  }

  function resolveWorldPoint(point) {
    if (!point || typeof point !== "object") {
      throw new Error("World target requires a point object");
    }

    const space = point.space || "physical";
    const x = Number(point.x !== undefined ? point.x : point.clientX);
    const y = Number(point.y !== undefined ? point.y : point.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("World point requires finite x and y");
    }

    if (space === "physical") {
      return { x, y };
    }
    if (space === "screen") {
      return screenToWorld(x, y);
    }
    if (space === "client") {
      return clientToWorld(x, y);
    }

    throw new Error('World point space must be "client", "screen", or "physical"');
  }

  function getCardCenterWorld(card) {
    const geometry = typeof getCardWorldGeometry === "function"
      ? getCardWorldGeometry(card)
      : null;
    if (!geometry) return null;

    return {
      x: geometry.centerX,
      y: geometry.centerY,
      width: geometry.width,
      height: geometry.height
    };
  }

  function getElementClientCenter(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") return null;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  function getCardActionClientPoint(card, action = "click") {
    if (!card || !card.element) return null;

    let target = null;
    if (action === "drag") {
      target = card.type === "page"
        ? (card.element.querySelector(".page-drag-handle-wrapper") || card.element)
        : card.element;
    } else if (card.type === "note") {
      target = card.element.querySelector("p[data-focus-editable]") ||
        card.element.querySelector("[data-focus-editable]");
    } else if (card.type === "page") {
      target = card.iframeEl ||
        card.element.querySelector(".page-iframe") ||
        card.element.querySelector(".page-input") ||
        card.element.querySelector(".iframe-empty") ||
        card.element.querySelector(".iframe-wrapper");
    } else if (card.type === "excel") {
      target = card.element.querySelector(".excel-table-container") || card.element;
    } else if (card.type === "image") {
      target = card.element.querySelector(".image-wrapper") ||
        card.element.querySelector(".card-image") ||
        card.element;
    }

    const client = getElementClientCenter(target || card.element);
    if (client) {
      return {
        action,
        client,
        target: target || card.element
      };
    }

    const center = getCardCenterWorld(card);
    if (!center) return null;
    return {
      action,
      client: worldToClient(center.x, center.y),
      target: card.element
    };
  }

  function resolveCard(target) {
    if (!target) {
      return typeof focusedCard !== "undefined" ? focusedCard : null;
    }

    if (target.element) return target;
    if (typeof target === "number" || /^\d+$/.test(String(target))) {
      return window.AgentInformation ? AgentInformation.findCardById(Number(target)) : null;
    }
    if (typeof target === "string") {
      return window.AgentInformation ? AgentInformation.findCardByText(target) : null;
    }

    if (target.id !== undefined && window.AgentInformation) {
      const byId = AgentInformation.findCardById(target.id);
      if (byId) return byId;
    }

    if (target.text && window.AgentInformation) {
      const byText = AgentInformation.findCardByText(target.text);
      if (byText) return byText;
    }

    if (target.focused || target.current) {
      return typeof focusedCard !== "undefined" ? focusedCard : null;
    }

    if (window.AgentInformation) {
      const point = normalizeActionPointPayload(target, {
        fallbackSpace: target.space || "screen",
        physicalKey: "p",
        screenKey: "s",
        clientKey: "c"
      });
      if (point) {
        const client = resolveClientPoint(point);
        return AgentInformation.findCardAtClientPoint(client.x, client.y);
      }
    }

    return null;
  }

  function resolveActionClientTarget(payload = {}, action = "click") {
    const point = normalizeActionPointPayload(payload, {
      fallbackSpace: payload.space || "screen",
      physicalKey: "p",
      screenKey: "s",
      clientKey: "c"
    });

    if (point) {
      return {
        point,
        client: resolveClientPoint(point),
        card: null
      };
    }

    const card = resolveCard(payload);
    if (card) {
      const target = getCardActionClientPoint(card, action);
      if (target && target.client) {
        return {
          point: {
            space: "client",
            x: target.client.x,
            y: target.client.y
          },
          client: target.client,
          card,
          target
        };
      }
    }

    const cursorState = getCurrentCursorState();
    if (cursorState && cursorState.points && cursorState.points.client) {
      return {
        point: null,
        client: cursorState.points.client,
        card: null
      };
    }

    return null;
  }

  function setCardPosition(card, x, y) {
    if (!card || !card.element) return false;

    card.x = x;
    card.y = y;
    card.element.style.left = `${x}px`;
    card.element.style.top = `${y}px`;
    if (typeof scheduleCardCoordinateDebug === "function") {
      scheduleCardCoordinateDebug();
    }
    return true;
  }

  function setCardDragState(card, active) {
    if (!card || !card.element) return;

    card.element.classList.toggle("dragging", active);
    if (typeof viewport !== "undefined" && viewport) {
      viewport.classList.toggle("dragging-card", active);
    }
    if (typeof setPageIframeInteractionShield === "function") {
      setPageIframeInteractionShield(active);
    }
    if (active && typeof bringToFront === "function") {
      bringToFront(card.element);
    }
  }

  function measureClientDistance(a, b) {
    if (!a || !b) return Infinity;
    const dx = Number(a.x) - Number(b.x);
    const dy = Number(a.y) - Number(b.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return Infinity;
    return Math.hypot(dx, dy);
  }

  async function alignCursorToResolvedTarget(resolved, action, options = {}) {
    if (!resolved || !resolved.client) {
      throw new Error(`${action} requires a cursor position, point, or card target`);
    }

    let cursorState = null;

    if (resolved.point) {
      if (resolved.point.space === "client") {
        cursorState = await moveCursorTo(resolved.client.x, resolved.client.y, options);
      } else {
        cursorState = await moveTo(resolved.point, options);
      }
    } else {
      cursorState = await moveCursorTo(resolved.client.x, resolved.client.y, options);
    }

    let finalClient = cursorState && cursorState.points ? cursorState.points.client : resolved.client;
    let refreshed = resolved;

    if (resolved.card) {
      const latestCard = resolveCard(resolved.card);
      const latestTarget = latestCard ? getCardActionClientPoint(latestCard, action) : null;
      if (latestTarget && latestTarget.client) {
        const drift = measureClientDistance(finalClient, latestTarget.client);
        refreshed = {
          point: {
            space: "client",
            x: latestTarget.client.x,
            y: latestTarget.client.y
          },
          client: latestTarget.client,
          card: latestCard,
          target: latestTarget
        };
        if (drift > 8) {
          cursorState = await moveCursorTo(latestTarget.client.x, latestTarget.client.y, options);
          finalClient = cursorState && cursorState.points ? cursorState.points.client : latestTarget.client;
        } else {
          finalClient = latestTarget.client;
        }
      }
    }

    return {
      resolved: refreshed,
      client: finalClient || refreshed.client,
      cursorState
    };
  }

  async function moveCursorTo(clientX, clientY, options = {}) {
    const cursor = getCursor();
    if (!cursor) return { clientX, clientY };
    const moveOptions = getMoveOptions(options);

    if (!shouldUseRunnerBackend(moveOptions)) {
      return cursor._moveToClient(clientX, clientY, moveOptions);
    }

    await ensureRunnerReady(moveOptions);
    const movePump = createRunnerMovePump(moveOptions);
    const userOnProgress = moveOptions.onProgress;
    const state = await cursor._moveToClient(clientX, clientY, {
      ...moveOptions,
      onProgress: (progress, cursorState) => {
        movePump.push(cursorState);
        if (typeof userOnProgress === "function") {
          userOnProgress(progress, cursorState);
        }
      }
    });
    const runner = await movePump.finish(state);
    return {
      ...state,
      runner
    };
  }

  async function ensureRunnerReady(options = {}) {
    if (!shouldUseRunnerBackend(options)) return null;
    const runner = getRunner();
    if (!runner) return null;

    const runnerOptions = getRunnerOptions(options);
    if (typeof runner.setConfig === "function") {
      runner.setConfig({
        backend: "cdp",
        endpoint: runnerOptions.endpoint || runnerOptions.runnerEndpoint,
        session: {
          ...(runnerOptions.session || {}),
          debugUrl: runnerOptions.debugUrl ||
            (runnerOptions.session && runnerOptions.session.debugUrl)
        }
      });
    }

    if (typeof runner.ensureReady === "function") {
      return runner.ensureReady({
        debugUrl: runnerOptions.debugUrl ||
          (runnerOptions.session && runnerOptions.session.debugUrl),
        session: {
          ...(runnerOptions.session || {})
        }
      });
    }

    if (typeof runner.connect === "function") {
      return runner.connect({
        debugUrl: runnerOptions.debugUrl ||
          (runnerOptions.session && runnerOptions.session.debugUrl),
        session: {
          ...(runnerOptions.session || {})
        }
      });
    }

    return null;
  }

  async function executeRunnerAction(action, payload = {}, options = {}) {
    if (!shouldUseRunnerBackend(options)) {
      return {
        ok: true,
        backend: "dom",
        skipped: true,
        action
      };
    }

    const runner = getRunner();
    if (!runner || typeof runner.execute !== "function") {
      throw new Error("AgentRunner is not loaded");
    }

    await ensureRunnerReady(options);
    return runner.execute(action, payload, options);
  }

  function createRunnerMovePump(options = {}) {
    let queue = [];
    let pumping = false;
    let lastRunner = null;
    let pumpError = null;

    async function pump() {
      if (pumping || pumpError) return;
      pumping = true;

      try {
        while (queue.length) {
          const point = queue[queue.length - 1];
          queue = [];
          lastRunner = await executeRunnerAction("move", {
            x: point.x,
            y: point.y,
            button: options.button
          }, options);
        }
      } catch (error) {
        pumpError = error;
        queue = [];
      } finally {
        pumping = false;
        if (!pumpError && queue.length) {
          await pump();
        }
      }
    }

    function push(state) {
      if (pumpError || !state || !state.points || !state.points.client) return;
      queue.push({
        x: state.points.client.x,
        y: state.points.client.y
      });
      void pump();
    }

    async function finish(finalState) {
      push(finalState);
      while (pumping || queue.length) {
        await sleep(0);
      }
      if (pumpError) throw pumpError;
      return lastRunner;
    }

    return {
      push,
      finish
    };
  }

  function normalizeMovePoint(point) {
    if (!point || typeof point !== "object") {
      throw new Error("Move requires a point object");
    }

    const normalized = normalizeActionPointPayload(point, {
      fallbackSpace: point.space || "screen",
      physicalKey: "p",
      screenKey: "s",
      clientKey: "c"
    });

    if (normalized) {
      if (normalized.space === "client") {
        const screen = clientToScreen(normalized.x, normalized.y);
        return {
          space: "screen",
          x: screen.x,
          y: screen.y
        };
      }
      return normalized;
    }

    if (
      (point.space === "screen" || point.space === "physical") &&
      Number.isFinite(Number(point.x)) &&
      Number.isFinite(Number(point.y))
    ) {
      return {
        space: point.space,
        x: Number(point.x),
        y: Number(point.y)
      };
    }

    throw new Error("Move payload requires space + p/s, or direct x/y");
  }

  function shouldFollowOffscreenScreenPoint(point, options = {}) {
    if (!point || point.space !== "screen" || options.follow === false) {
      return false;
    }

    if (typeof getViewportBounds !== "function" || typeof screenToWorld !== "function") {
      return false;
    }

    const bounds = getViewportBounds();
    return point.x < 0 ||
      point.y < 0 ||
      point.x > bounds.width ||
      point.y > bounds.height;
  }

  function prepareMovePoint(point, options = {}) {
    const normalized = normalizeMovePoint(point);
    if (!shouldFollowOffscreenScreenPoint(normalized, options)) {
      return normalized;
    }

    const world = screenToWorld(normalized.x, normalized.y);
    return {
      space: "physical",
      x: world.x,
      y: world.y
    };
  }

  async function move(point, options = {}) {
    const cursor = getCursor();
    if (!cursor || typeof cursor.moveTo !== "function") {
      throw new Error("AgentCursor is not loaded");
    }

    const moveOptions = getMoveOptions(options);
    const preparedPoint = prepareMovePoint(point, moveOptions);

    if (!shouldUseRunnerBackend(moveOptions)) {
      return cursor.moveTo(preparedPoint, moveOptions);
    }

    await ensureRunnerReady(moveOptions);
    const movePump = createRunnerMovePump(moveOptions);
    const userOnProgress = moveOptions.onProgress;
    const state = await cursor.moveTo(preparedPoint, {
      ...moveOptions,
      onProgress: (progress, cursorState) => {
        movePump.push(cursorState);
        if (typeof userOnProgress === "function") {
          userOnProgress(progress, cursorState);
        }
      }
    });
    const runner = await movePump.finish(state);
    return {
      ...state,
      runner
    };
  }

  async function moveTo(point, options = {}) {
    return move(point, options);
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

  async function hold(payloadOrDuration = {}, options = {}, fallbackOptions = {}) {
    const payload = typeof payloadOrDuration === "number"
      ? { holdMs: payloadOrDuration }
      : (payloadOrDuration || {});
    const holdOptions = typeof payloadOrDuration === "number"
      ? (options || {})
      : (typeof options === "number"
      ? { holdMs: options, ...(fallbackOptions || {}) }
      : (options || {}));

    const mergedOptions = mergeActionOptions(payload.move || payload.cursor, holdOptions);
    const clickOptions = getClickOptions(mergedOptions);

    if (shouldUseRunnerBackend(clickOptions)) {
      const resolved = resolveActionClientTarget(payload, "hold");
      const aligned = await alignCursorToResolvedTarget(resolved, "hold", clickOptions);
      const duration = resolveHoldDuration(payload, holdOptions, clickOptions);
      const runner = await executeRunnerAction("hold", {
        x: aligned.client.x,
        y: aligned.client.y,
        holdMs: duration,
        button: clickOptions.button
      }, clickOptions);

      const cursor = getCursor();
      if (cursor && typeof cursor.press === "function") cursor.press();
      if (duration > 0) await sleep(duration);

      return {
        ok: true,
        pressed: true,
        point: aligned.resolved.point ||
          (aligned.cursorState && aligned.cursorState.points ? aligned.cursorState.points.screen : null),
        client: aligned.client,
        card: aligned.resolved.card || null,
        cursor: getCurrentCursorState() || aligned.cursorState,
        runner,
        detail: runner && runner.detail ? runner.detail : "hold complete"
      };
    }

    if (window.AgentHandHold) {
      return AgentHandHold.run(payload, holdOptions, getContext());
    }
    const point = normalizeActionPointPayload(payload, {
      fallbackSpace: payload.space || "screen",
      physicalKey: "p",
      screenKey: "s",
      clientKey: "c"
    });
    const cursor = getCursor();
    let cursorState = null;

    if (point) {
      cursorState = point.space === "client"
        ? await moveCursorTo(point.x, point.y, clickOptions)
        : await moveTo(point, clickOptions);
    } else {
      cursorState = getCurrentCursorState();
    }

    const duration = resolveHoldDuration(payload, holdOptions, clickOptions);
    if (cursor && typeof cursor.press === "function") cursor.press();
    if (duration > 0) await sleep(duration);

    return {
      ok: Boolean(cursor || cursorState),
      pressed: true,
      point: point || (cursorState && cursorState.points ? cursorState.points.screen : null),
      client: cursorState && cursorState.points ? cursorState.points.client : null,
      cursor: getCurrentCursorState() || cursorState,
      detail: "hold complete"
    };
  }

  function release(options = {}) {
    if (shouldUseRunnerBackend(options)) {
      const state = getCurrentCursorState();
      const client = state && state.points ? state.points.client : null;
      const cursor = getCursor();
      if (cursor && typeof cursor.release === "function") {
        cursor.release();
      }

      const runnerPromise = executeRunnerAction("release", {
        x: client ? client.x : undefined,
        y: client ? client.y : undefined,
        button: options.button
      }, options);

      return runnerPromise.then(runner => ({
        ok: true,
        released: true,
        cursor: getCurrentCursorState() || state,
        runner,
        detail: runner && runner.detail ? runner.detail : (options.detail || "released cursor")
      }));
    }

    if (window.AgentHandHold && typeof AgentHandHold.release === "function") {
      const result = AgentHandHold.release(getContext(), options);
      const cursor = getCursor();
      if (cursor && typeof cursor.release === "function") {
        cursor.release();
      }
      return result;
    }

    const cursor = getCursor();
    if (cursor && typeof cursor.release === "function") {
      cursor.release();
    }

    const state = getCurrentCursorState();
    return {
      ok: true,
      released: true,
      cursor: state,
      detail: options.detail || "released cursor"
    };
  }

  async function click(clientX, clientY, options = {}) {
    const payload = clientX && typeof clientX === "object"
      ? clientX
      : { space: "client", x: clientX, y: clientY };
    const clickOptions = clientX && typeof clientX === "object"
      ? clientY || {}
      : options;

    const mergedOptions = mergeActionOptions(payload.move || payload.cursor, clickOptions);
    const resolvedClickOptions = getClickOptions(mergedOptions);

    if (shouldUseRunnerBackend(resolvedClickOptions)) {
      const resolved = resolveActionClientTarget(payload, "click");
      const aligned = await alignCursorToResolvedTarget(resolved, "click", resolvedClickOptions);
      const runner = await executeRunnerAction("click", {
        x: aligned.client.x,
        y: aligned.client.y,
        holdMs: Number(resolvedClickOptions.holdMs) || 40,
        button: resolvedClickOptions.button
      }, resolvedClickOptions);

      const cursor = getCursor();
      if (cursor && typeof cursor.press === "function") cursor.press();
      await sleep(Number(resolvedClickOptions.holdMs) || 40);
      if (cursor && typeof cursor.release === "function") cursor.release();

      return {
        ok: true,
        card: aligned.resolved.card || null,
        client: aligned.client,
        cursor: getCurrentCursorState() || aligned.cursorState,
        runner,
        detail: runner && runner.detail
          ? runner.detail
          : `clicked at ${Math.round(aligned.client.x)}, ${Math.round(aligned.client.y)}`
      };
    }

    if (window.AgentHandClick) {
      return AgentHandClick.run(payload, resolvedClickOptions, getContext());
    }

    const point = payload.point || payload;
    const cursorState = point.space === "client"
      ? await moveCursorTo(point.x, point.y, resolvedClickOptions)
      : await moveTo(point, resolvedClickOptions);
    const client = cursorState && cursorState.points
      ? cursorState.points.client
      : { x: Number(point.x), y: Number(point.y) };
    const cursor = getCursor();
    if (cursor) cursor.press();
    await sleep(Number(resolvedClickOptions.holdMs) || 40);
    if (cursor) cursor.release();

    const target = document.elementFromPoint(client.x, client.y);
    if (target) {
      target.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: client.x,
        clientY: client.y
      }));
    }
    return { ok: Boolean(target), target, client, cursor: cursorState };
  }

  async function mClick(payload = {}, options = {}) {
    const point = payload && payload.point ? payload.point : payload;
    const mergedOptions = mergeActionOptions(payload.move || payload.cursor, options);
    const hasPoint = point && typeof point === "object" && (
      point.x !== undefined || point.y !== undefined ||
      point.p || point.s || point.c ||
      point.physical || point.screen || point.client
    );

    if (hasPoint) {
      if (point.space === "client") {
        await moveCursorTo(Number(point.x !== undefined ? point.x : point.clientX),
          Number(point.y !== undefined ? point.y : point.clientY),
          mergedOptions);
      } else {
        await moveTo(point, mergedOptions);
      }
      return click({}, mergedOptions);
    }

    const card = resolveCard(payload);
    if (card) {
      const result = await click(payload, mergedOptions);
      return {
        ...result,
        card: describeCard(card),
        detail: result.ok ? `m_click card #${card.id}` : result.detail
      };
    }

    return click(payload, mergedOptions);
  }

  async function hClick(payload = {}, options = {}) {
    const mergedOptions = mergeActionOptions(payload.move || payload.cursor, options);
    const startPoint = normalizeActionPointPayload(payload, {
      fallbackSpace: payload.space || "screen",
      physicalKey: "start_p",
      screenKey: "start_s",
      clientKey: "start_c"
    });
    const targetPoint = normalizeActionPointPayload(payload, {
      fallbackSpace: payload.space || "screen",
      physicalKey: "target_p",
      screenKey: "target_s",
      clientKey: "target_c"
    }) || normalizeActionPointPayload(payload, {
      fallbackSpace: payload.space || "screen",
      physicalKey: "p",
      screenKey: "s",
      clientKey: "c"
    });

    await hold({
      ...(startPoint || {}),
      holdMs: payload.holdMs,
      holdDuration: payload.holdDuration,
      dispatch: payload.dispatch
    }, mergedOptions);

    try {
      if (targetPoint) {
        return await moveTo(targetPoint, mergedOptions);
      }
      return getCurrentCursorState();
    } finally {
      if (payload.release !== false) {
        await release(mergedOptions);
      }
    }
  }

  async function drag(cardOrPayload, targetOrOptions, options = {}) {
    const payload = cardOrPayload && typeof cardOrPayload === "object" &&
      (cardOrPayload.to || cardOrPayload.target || cardOrPayload.card || cardOrPayload.id !== undefined)
      ? cardOrPayload
      : {
        card: cardOrPayload,
        to: targetOrOptions,
        options
      };
    const dragOptions = payload.options || options || {};

    if (shouldUseRunnerBackend(dragOptions)) {
      const cardRef = normalizeCardReference(payload);
      const card = resolveCard(cardRef);
      if (!card) {
        return { ok: false, detail: "card not found" };
      }

      const dragSpace = normalizeSpaceName(payload.space, "physical");
      const startPoint = normalizeActionPointPayload(payload, {
        fallbackSpace: dragSpace,
        physicalKey: "start_p",
        screenKey: "start_s",
        clientKey: "start_c"
      });
      const targetPoint = normalizeActionPointPayload(payload, {
        fallbackSpace: dragSpace,
        physicalKey: "target_p",
        screenKey: "target_s",
        clientKey: "target_c"
      }) || normalizeActionPointPayload(payload.to || payload.target || payload.point || {}, {
        fallbackSpace: dragSpace,
        physicalKey: "p",
        screenKey: "s",
        clientKey: "c"
      });

      if (!targetPoint) {
        return { ok: false, detail: "drag target point is missing" };
      }

      const defaultStart = getCardActionClientPoint(card, "drag");
      const fromClient = startPoint
        ? resolveClientPoint(startPoint)
        : (defaultStart ? defaultStart.client : null);
      const toClient = resolveClientPoint(targetPoint);
      if (!fromClient || !toClient) {
        return { ok: false, detail: "drag points could not be resolved" };
      }

      await moveCursorTo(fromClient.x, fromClient.y, dragOptions);
      const cursor = getCursor();
      if (cursor && typeof cursor.press === "function") cursor.press();

      try {
        const runner = await executeRunnerAction("drag", {
          from: fromClient,
          to: toClient,
          steps: dragOptions.steps,
          duration: dragOptions.duration,
          button: dragOptions.button
        }, dragOptions);

        if (cursor && typeof cursor.set === "function") {
          cursor.set({
            clientX: toClient.x,
            clientY: toClient.y,
            visible: true,
            pressed: false
          });
        }

        return {
          ok: true,
          card: describeCard(card),
          runner,
          fromClient,
          toClient,
          detail: runner && runner.detail
            ? runner.detail
            : `dragged card #${card.id}`
        };
      } finally {
        if (cursor && typeof cursor.release === "function") cursor.release();
      }
    }

    if (window.AgentHandDrag) {
      return AgentHandDrag.run(payload, dragOptions, getContext());
    }

    throw new Error("AgentHandDrag is not loaded");
  }

  async function closeCard(target, options = {}) {
    if (window.AgentHandClose) {
      return AgentHandClose.run(target, options, getContext());
    }

    const card = resolveCard(target);
    if (!card || typeof removeCard !== "function") return { ok: false, detail: "card not found" };
    removeCard(card);
    return { ok: true, card: describeCard(card) };
  }

  async function zoom(spec = {}, options = {}) {
    if (window.AgentHandZoom) {
      return AgentHandZoom.run(spec, options, getContext());
    }

    throw new Error("AgentHandZoom is not loaded");
  }

  async function ctrl(target, options = {}) {
    const card = resolveCard(target);
    if (!card || typeof enterCardFocus !== "function") {
      return { ok: false, detail: "card not found" };
    }

    const ok = enterCardFocus(card);
    return {
      ok: Boolean(ok),
      card: describeCard(card),
      detail: ok ? `focused card #${card.id}` : `focus failed for #${card.id}`
    };
  }

  async function focusCard(cardOrDescription, options = {}) {
    if (window.AgentHandFocus) {
      return AgentHandFocus.run(cardOrDescription, options, getContext());
    }

    return ctrl(cardOrDescription, options);
  }

  function scroll(deltaY, clientX = window.innerWidth / 2, clientY = window.innerHeight / 2) {
    const scrollDeltaY = Number.isFinite(Number(deltaY))
      ? Number(deltaY)
      : Number(handConfig.scroll && handConfig.scroll.deltaY) || 480;

    if (shouldUseRunnerBackend()) {
      return executeRunnerAction("scroll", {
        x: clientX,
        y: clientY,
        deltaX: 0,
        deltaY: scrollDeltaY
      }, handConfig.runner || {}).then(runner => ({
        ok: true,
        deltaY: scrollDeltaY,
        client: { x: clientX, y: clientY },
        runner
      }));
    }

    const target = document.elementFromPoint(clientX, clientY) || window;
    target.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      deltaY: scrollDeltaY
    }));
    return { ok: true, deltaY: scrollDeltaY, client: { x: clientX, y: clientY } };
  }

  function getContext() {
    return {
      sleep,
      pickDefined,
      normalizeSpaceName,
      normalizeActionPointPayload,
      normalizeCardReference,
      mergeActionOptions,
      getConfig,
      setConfig,
      getMoveOptions,
      getCursorOptions,
      getClickOptions,
      getDragOptions,
      getZoomOptions,
      getCursor,
      getCurrentCursorState,
      getRunner,
      getRunnerOptions,
      getBackendName,
      shouldUseRunnerBackend,
      executeRunnerAction,
      move,
      moveTo,
      moveCursorTo,
      hold,
      release,
      mClick,
      hClick,
      ctrl,
      resolveCard,
      describeCard,
      resolveClientPoint,
      resolveWorldPoint,
      getCardCenterWorld,
      getCardActionClientPoint,
      setCardPosition,
      setCardDragState
    };
  }

  async function run(actionOrCommand, payload = {}, options = {}) {
    if (!window.AgentHandGeneral) {
      throw new Error("AgentHandGeneral is not loaded");
    }
    return AgentHandGeneral.run(actionOrCommand, payload, options);
  }

  function registerActions() {
    if (!window.AgentHandGeneral) return;

    AgentHandGeneral.register("moveTo", (payload, options) => {
      const point = payload.point || payload;
      return moveTo(point, options);
    }, {
      description: "Move visible cursor to a screen or physical point",
      payload: "{ space: 'screen'|'physical', x, y }"
    });
    AgentHandGeneral.register("move", (payload, options) => {
      const point = payload.point || payload;
      return move(point, options);
    }, {
      description: "Move visible pointer to a screen or physical point",
      payload: "{ move, space, p, s }"
    });
    AgentHandGeneral.register("hold", (payload, options) => hold(payload, options), {
      description: "Press and hold at the current cursor or an optional point",
      payload: "{ holdMs?, space?, p?, s?, c? }"
    });
    AgentHandGeneral.register("release", (payload, options) => release({
      ...(payload || {}),
      ...(options || {})
    }), {
      description: "Release the current held cursor state",
      payload: "{}"
    });

    AgentHandGeneral.register("click", (payload, options) => click(payload, options), {
      description: "Click at the current cursor, or move first if a point is provided",
      payload: "{ move?, space?, p?, s?, c? }"
    });
    AgentHandGeneral.register("m_click", (payload, options) => mClick(payload, options), {
      description: "Move, then click",
      payload: "{ move, space, p, s, c }"
    });
    AgentHandGeneral.register("h_click", (payload, options) => hClick(payload, options), {
      description: "Hold, then move while pressed",
      payload: "{ move, holdMs?, start_p?, start_s?, target_p?, target_s? }"
    });
    AgentHandGeneral.register("ctrl", (payload, options) => ctrl(payload, options), {
      description: "Enter focus control for a card",
      payload: "{ cardId }"
    });

    AgentHandGeneral.register("drag", (payload, options) => drag(payload, options), {
      description: "Drag a card from start_p/start_s to target_p/target_s",
      payload: "{ move, cardId, space, start_p, start_s, target_p, target_s }"
    });

    AgentHandGeneral.register("close", (payload, options) => closeCard(payload, options), {
      description: "Close a card",
      payload: "{ move, cardId }"
    });
    AgentHandGeneral.register("closeCard", (payload, options) => closeCard(payload, options), {
      description: "Close a card",
      payload: "{ move, cardId }"
    });

    AgentHandGeneral.register("zoom", (payload, options) => zoom(payload, options), {
      description: "Zoom the canvas view",
      payload: "{ direction|'in'|'out', factor?, zoom?, point? }"
    });

    AgentHandGeneral.register("focus", (payload, options) => focusCard(payload, options), {
      description: "Focus a card",
      payload: "{ move, cardId, space, p, s }"
    });
    AgentHandGeneral.register("focusCard", (payload, options) => focusCard(payload, options), {
      description: "Focus a card",
      payload: "{ move, cardId, space, p, s }"
    });

    AgentHandGeneral.register("scroll", (payload = {}) => {
      return scroll(payload.deltaY, payload.clientX, payload.clientY);
    }, {
      description: "Dispatch wheel scroll at a client point",
      payload: "{ deltaY, clientX?, clientY? }"
    });
  }

  const api = {
    ready: () => configReady,
    getConfig,
    setConfig,
    getMoveOptions,
    getCursorOptions,
    getClickOptions,
    getDragOptions,
    getZoomOptions,
    getRunnerOptions,
    getBackendName,
    run,
    act: run,
    move,
    moveTo,
    moveCursorTo,
    hold,
    release,
    click,
    mClick,
    hClick,
    drag,
    ctrl,
    close: closeCard,
    zoom,
    focus: focusCard,
    focusCard,
    scroll,
    resolveCard
  };

  window.AgentHand = api;
  registerActions();
})();

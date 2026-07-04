// Agent/hand/cursor/visual-cursor.js
// Renders the Agent hand as a visible cursor for debugging physical actions.

(function initializeAgentVisualCursor() {
  const DEFAULT_REAL_DURATION = 520;
  const DEFAULT_REAL_STEPS = 28;

  let cursorEl = null;
  let cursorState = {
    clientX: 0,
    clientY: 0,
    visible: false,
    pressed: false
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function ensureCursor() {
    if (cursorEl) return cursorEl;

    cursorEl = document.createElement("div");
    cursorEl.className = "agent-visual-cursor";
    cursorEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(cursorEl);
    return cursorEl;
  }

  function renderCursor() {
    const element = ensureCursor();
    element.classList.toggle("is-visible", cursorState.visible);
    element.classList.toggle("is-pressed", cursorState.pressed);
    element.style.transform =
      `translate3d(${Math.round(cursorState.clientX)}px, ${Math.round(cursorState.clientY)}px, 0)`;
  }

  function setCursorState(nextState) {
    cursorState = { ...cursorState, ...nextState };
    renderCursor();
    return getCursorState();
  }

  function getCursorPoints(clientX = cursorState.clientX, clientY = cursorState.clientY) {
    const screen = typeof clientToScreen === "function"
      ? clientToScreen(clientX, clientY)
      : { x: clientX, y: clientY };
    const physical = typeof clientToWorld === "function"
      ? clientToWorld(clientX, clientY)
      : { x: clientX, y: clientY };

    return {
      client: { x: clientX, y: clientY },
      screen,
      physical
    };
  }

  function getCursorState() {
    return {
      ...cursorState,
      points: getCursorPoints()
    };
  }

  function resolveCursorPoint(point) {
    if (!point || typeof point !== "object") {
      throw new Error("Cursor point must be an object: { space, x, y }");
    }

    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Cursor point requires finite x and y numbers");
    }

    if (point.space === "screen") {
      if (typeof screenToClient !== "function") {
        throw new Error("screenToClient() is not loaded");
      }
      const client = screenToClient(x, y);
      return {
        space: "screen",
        x,
        y,
        clientX: client.x,
        clientY: client.y
      };
    }

    if (point.space === "physical") {
      if (typeof worldToClient !== "function") {
        throw new Error("worldToClient() is not loaded");
      }
      const client = worldToClient(x, y);
      return {
        space: "physical",
        x,
        y,
        clientX: client.x,
        clientY: client.y
      };
    }

    throw new Error('Cursor point space must be "screen" or "physical"');
  }

  function easeInOutCubic(t) {
    return window.AgentMovementRule
      ? AgentMovementRule.easeInOutCubic(t)
      : (t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2);
  }

  function getCorrectionDistance(distance, options = {}) {
    if (Number.isFinite(Number(options.correctionDistance))) {
      return Math.min(distance, Math.max(0, Number(options.correctionDistance)));
    }

    if (distance < 60) return Math.min(distance * 0.24, 8);
    if (distance < 180) return 8;
    if (distance < 520) return 10;
    return 14;
  }

  function getRealCurveDirection(startX, startY, endX, endY) {
    const dx = endX - startX;
    const dy = endY - startY;
    return (dx * 0.73 + dy * 0.41) >= 0 ? 1 : -1;
  }

  function notifyProgress(options, progress, state = getCursorState()) {
    if (typeof options.onProgress === "function") {
      options.onProgress(progress, state);
    }
  }

  async function moveRealToClient(clientX, clientY, options = {}) {
    const start = getCursorState();
    const startX = Number.isFinite(start.clientX) ? start.clientX : clientX;
    const startY = Number.isFinite(start.clientY) ? start.clientY : clientY;
    const dx = clientX - startX;
    const dy = clientY - startY;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.5) {
      const state = setCursorState({
        clientX,
        clientY,
        visible: options.visible !== false
      });
      notifyProgress(options, 1, state);
      return state;
    }

    const duration = Math.max(0, Number.isFinite(Number(options.duration))
      ? Number(options.duration)
      : DEFAULT_REAL_DURATION);
    const steps = Math.max(1, Math.round(Number.isFinite(Number(options.steps))
      ? Number(options.steps)
      : DEFAULT_REAL_STEPS));

    if (duration <= 0 || steps === 1) {
      const state = setCursorState({
        clientX,
        clientY,
        visible: options.visible !== false
      });
      notifyProgress(options, 1, state);
      return state;
    }

    const defaultReactionPause = Math.min(90, Math.max(18, duration * 0.12));
    const reactionPause = Math.max(0, Number.isFinite(Number(options.reactionPause))
      ? Number(options.reactionPause)
      : defaultReactionPause);
    const defaultCorrectionPause = Math.min(70, Math.max(12, duration * 0.1));
    const correctionPause = Math.max(0, Number.isFinite(Number(options.correctionPause))
      ? Number(options.correctionPause)
      : defaultCorrectionPause);
    const moveDuration = Math.max(0, duration - reactionPause - correctionPause);
    const mainDuration = moveDuration * 0.78;
    const correctionDuration = moveDuration - mainDuration;
    const mainSteps = Math.max(1, Math.min(steps - 1, Math.round(steps * 0.78)));
    const correctionSteps = steps - mainSteps;
    const correctionDistance = getCorrectionDistance(distance, options);
    const unitX = dx / distance;
    const unitY = dy / distance;
    const preTarget = {
      x: clientX - unitX * correctionDistance,
      y: clientY - unitY * correctionDistance
    };
    const path = window.AgentMovementRule
      ? AgentMovementRule.createBezierPath(
        { x: startX, y: startY },
        preTarget,
        {
          curveDirection: getRealCurveDirection(startX, startY, clientX, clientY),
          curve: Math.min(90, Math.max(18, distance * 0.12))
        }
      )
      : null;

    setCursorState({ visible: options.visible !== false });
    if (reactionPause) await sleep(reactionPause);

    let progressStep = 0;
    for (let step = 1; step <= mainSteps; step += 1) {
      const t = easeInOutCubic(step / mainSteps);
      const nextPoint = path
        ? path.pointAt(t)
        : {
          x: startX + (preTarget.x - startX) * t,
          y: startY + (preTarget.y - startY) * t
        };
      const state = setCursorState({ clientX: nextPoint.x, clientY: nextPoint.y });
      progressStep += 1;
      notifyProgress(options, progressStep / steps, state);
      if (mainDuration) await sleep(mainDuration / mainSteps);
    }

    if (correctionPause) await sleep(correctionPause);

    for (let step = 1; step <= correctionSteps; step += 1) {
      const t = easeInOutCubic(step / correctionSteps);
      const state = setCursorState({
        clientX: preTarget.x + (clientX - preTarget.x) * t,
        clientY: preTarget.y + (clientY - preTarget.y) * t
      });
      progressStep += 1;
      notifyProgress(options, progressStep / steps, state);
      if (correctionDuration) await sleep(correctionDuration / correctionSteps);
    }

    const state = setCursorState({ clientX, clientY });
    notifyProgress(options, 1, state);
    return state;
  }

  async function moveToClient(clientX, clientY, options = {}) {
    return moveRealToClient(clientX, clientY, options);
  }

  async function moveTo(point, options = {}) {
    const shouldFollow = point && point.space === "physical" &&
      options.follow !== false &&
      window.AgentMovementRule;
    const followPlan = shouldFollow
      ? AgentMovementRule.createPhysicalFollowPlan(point, {
        margin: options.margin
      })
      : { followed: false, reason: "disabled" };
    const resolved = followPlan.followed
      ? {
        space: "physical",
        x: Number(point.x),
        y: Number(point.y),
        clientX: screenToClient(followPlan.anchor.x, followPlan.anchor.y).x,
        clientY: screenToClient(followPlan.anchor.x, followPlan.anchor.y).y
      }
      : resolveCursorPoint(point);
    let follow = followPlan;

    if (followPlan.followed && typeof interruptFocusViewTransition === "function") {
      interruptFocusViewTransition();
    }

    const progressOptions = followPlan.followed
      ? {
        ...options,
        onProgress: (progress, state) => {
          follow = AgentMovementRule.applyPhysicalFollowPlan(followPlan, progress, {
            updateGrid: progress >= 1
          });
          notifyProgress(options, progress, state);
        }
      }
      : options;
    const state = await moveToClient(resolved.clientX, resolved.clientY, progressOptions);

    return {
      ...state,
      target: resolved,
      follow
    };
  }

  const api = {
    set: setCursorState,
    get: getCursorState,
    resolve: resolveCursorPoint,
    move: moveTo,
    moveTo,
    _moveToClient: moveToClient,
    show: () => setCursorState({ visible: true }),
    hide: () => setCursorState({ visible: false }),
    press: () => setCursorState({ pressed: true, visible: true }),
    release: () => setCursorState({ pressed: false })
  };

  window.AgentCursor = api;
  window.AgentVisualCursor = api;
  window.AgentMove = api;
  window.AgentVisualMove = api;
})();

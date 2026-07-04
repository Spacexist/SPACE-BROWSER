// test/cursor-target-dot.js
// Manual target dot for testing cursor movement toward a canvas point.

(function initializeCursorTargetDot() {
  let dotEl = null;
  let labelEl = null;
  let target = null;
  let armed = false;
  let frame = 0;
  let draggingPointerId = null;

  function ensureDot() {
    if (dotEl) return dotEl;

    dotEl = document.createElement("div");
    dotEl.className = "agent-target-dot";
    dotEl.hidden = true;
    viewport.appendChild(dotEl);

    labelEl = document.createElement("div");
    labelEl.className = "agent-target-dot-label";
    labelEl.hidden = true;
    viewport.appendChild(labelEl);

    dotEl.addEventListener("pointerdown", event => {
      if (!target) return;
      draggingPointerId = event.pointerId;
      dotEl.classList.add("is-dragging");
      if (typeof dotEl.setPointerCapture === "function") {
        dotEl.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
    });

    dotEl.addEventListener("pointermove", event => {
      if (draggingPointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      setFromClient(event.clientX, event.clientY, { detailName: "target moved" });
    });

    function stopDrag(event) {
      if (draggingPointerId !== event.pointerId) return;
      draggingPointerId = null;
      dotEl.classList.remove("is-dragging");
      if (typeof dotEl.releasePointerCapture === "function") {
        try {
          dotEl.releasePointerCapture(event.pointerId);
        } catch (error) {
          // Ignore stale capture releases.
        }
      }
      event.preventDefault();
      event.stopPropagation();
    }

    dotEl.addEventListener("pointerup", stopDrag);
    dotEl.addEventListener("pointercancel", stopDrag);

    return dotEl;
  }

  function formatCoordinate(value) {
    if (!Number.isFinite(value)) return "-";
    return Math.abs(value) >= 1000
      ? Math.round(value).toString()
      : value.toFixed(1);
  }

  function renderDot() {
    frame = 0;
    if (!target) return;

    const dot = ensureDot();
    const screen = worldToScreen(target.physical.x, target.physical.y);
    target.screen = screen;
    target.client = screenToClient(screen.x, screen.y);
    dot.hidden = false;
    dot.style.transform =
      `translate3d(${Math.round(screen.x)}px, ${Math.round(screen.y)}px, 0)`;

    if (labelEl) {
      labelEl.hidden = false;
      labelEl.textContent =
        `DOT  P ${formatCoordinate(target.physical.x)}, ${formatCoordinate(target.physical.y)}  ·  ` +
        `S ${formatCoordinate(target.screen.x)}, ${formatCoordinate(target.screen.y)}`;
      const viewportRect = viewport.getBoundingClientRect();
      const labelX = Math.min(
        Math.max(8, screen.x + 18),
        Math.max(8, viewportRect.width - labelEl.offsetWidth - 8)
      );
      const labelY = Math.min(
        Math.max(8, screen.y - labelEl.offsetHeight - 12),
        Math.max(8, viewportRect.height - labelEl.offsetHeight - 8)
      );
      labelEl.style.transform =
        `translate3d(${Math.round(labelX)}px, ${Math.round(labelY)}px, 0)`;
    }

    scheduleRender();
  }

  function scheduleRender() {
    if (!target || frame) return;
    frame = requestAnimationFrame(renderDot);
  }

  function disarm() {
    armed = false;
    viewport.classList.remove("agent-target-dot-armed");
  }

  function setFromClient(clientX, clientY, options = {}) {
    const physical = clientToWorld(clientX, clientY);
    const screen = clientToScreen(clientX, clientY);
    target = {
      physical,
      screen,
      client: { x: clientX, y: clientY }
    };
    ensureDot();
    renderDot();
    disarm();
    window.dispatchEvent(new CustomEvent("space-test-target-dot-set", {
      detail: {
        ...getTarget(),
        name: options.detailName || "target placed"
      }
    }));
    return getTarget();
  }

  function arm() {
    armed = true;
    viewport.classList.add("agent-target-dot-armed");
    return { armed };
  }

  function clear() {
    target = null;
    disarm();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    draggingPointerId = null;
    if (dotEl) {
      dotEl.hidden = true;
      dotEl.classList.remove("is-dragging");
    }
    if (labelEl) labelEl.hidden = true;
  }

  function getTarget() {
    if (!target) return null;
    return {
      physical: { ...target.physical },
      screen: { ...target.screen },
      client: { ...target.client },
      armed
    };
  }

  async function run(options = {}) {
    if (!target) {
      throw new Error("Set a target dot first");
    }
    if (!window.AgentHand) {
      throw new Error("AgentHand is not loaded");
    }

    const state = await AgentHand.moveTo({
      space: "physical",
      x: target.physical.x,
      y: target.physical.y
    }, options);
    renderDot();
    return {
      ok: true,
      target: getTarget(),
      cursor: state,
      detail:
        `dot P ${Math.round(target.physical.x)}, ${Math.round(target.physical.y)} | ` +
        `S ${Math.round(state.points.screen.x)}, ${Math.round(state.points.screen.y)} | ` +
        `follow ${state.follow && state.follow.followed ? "yes" : "no"}`
    };
  }

  viewport.addEventListener("pointerdown", event => {
    if (!armed) return;
    if (event.target.closest(".agent-test-panel")) return;
    if (event.target.closest(".agent-target-dot")) return;

    event.preventDefault();
    event.stopPropagation();
    setFromClient(event.clientX, event.clientY);
  }, true);

  window.addEventListener("resize", scheduleRender);

  if (!window.SpaceTest) {
    window.SpaceTest = {};
  }

  window.SpaceTest.cursorTarget = {
    arm,
    clear,
    get: getTarget,
    isArmed: () => armed,
    run,
    setFromClient
  };
})();

// test/agent-test-panel.js
// On-page controls for manual Hand action tests.

(function initializeAgentTestPanel() {
  let panel = null;
  let rowsEl = null;
  let statusEl = null;
  let handConfigSeeded = false;

  function ensurePanel() {
    if (panel) return panel;

    panel = document.createElement("section");
    panel.className = "agent-test-panel is-collapsed";
    panel.innerHTML = `
      <button class="agent-test-toggle" type="button" aria-expanded="false">TEST</button>
      <div class="agent-test-body">
        <div class="agent-test-header">
          <strong>Agent Test</strong>
          <span class="agent-test-status">idle</span>
        </div>
        <div class="agent-test-actions">
          <button type="button" data-agent-action="move">Move</button>
          <button type="button" data-agent-action="m_click">M Click</button>
          <button type="button" data-agent-action="drag">Drag</button>
          <button type="button" data-agent-action="close">Close</button>
          <button type="button" data-agent-action="zoom-in">Zoom +</button>
          <button type="button" data-agent-action="zoom-out">Zoom -</button>
          <button type="button" data-agent-action="focus">Focus</button>
        </div>
        <div class="agent-target-actions">
          <button type="button" data-agent-target="set">Set Dot</button>
          <button type="button" data-agent-target="clear">Clear Dot</button>
        </div>
        <form class="agent-move-form" data-agent-move-form>
          <label>
            <span>card id</span>
            <input name="cardId" type="number" step="1" min="1" placeholder="focused / first">
          </label>
          <label>
            <span>space</span>
            <select name="space">
              <option value="screen">screen</option>
              <option value="physical">physical</option>
            </select>
          </label>
          <label>
            <span>follow</span>
            <select name="follow">
              <option value="true">on</option>
              <option value="false">off</option>
            </select>
          </label>
          <label>
            <span>x</span>
            <input name="x" type="number" step="1" value="500">
          </label>
          <label>
            <span>y</span>
            <input name="y" type="number" step="1" value="300">
          </label>
          <label>
            <span>duration</span>
            <input name="duration" type="number" step="20" min="0" value="520">
          </label>
          <label>
            <span>steps</span>
            <input name="steps" type="number" step="1" min="1" value="28">
          </label>
          <label>
            <span>zoom factor</span>
            <input name="factor" type="number" step="0.1" min="1" value="1.3">
          </label>
          <label>
            <span>zoom duration</span>
            <input name="zoomDuration" type="number" step="20" min="0" value="220">
          </label>
        </form>
        <div class="agent-test-rows" aria-live="polite"></div>
      </div>
    `;
    document.body.appendChild(panel);

    rowsEl = panel.querySelector(".agent-test-rows");
    statusEl = panel.querySelector(".agent-test-status");

    panel.querySelector(".agent-test-toggle").addEventListener("click", () => {
      const collapsed = panel.classList.toggle("is-collapsed");
      panel.querySelector(".agent-test-toggle")
        .setAttribute("aria-expanded", String(!collapsed));
    });

    panel.addEventListener("click", event => {
      const button = event.target.closest("[data-agent-action]");
      if (!button) return;
      runAction(button.dataset.agentAction);
    });

    panel.addEventListener("click", event => {
      const button = event.target.closest("[data-agent-target]");
      if (!button) return;
      runTargetAction(button.dataset.agentTarget);
    });
    window.addEventListener("space-test-target-dot-set", event => {
      setFormPointFromTarget(event.detail);
      const target = event.detail;
      const name = target && target.name ? target.name : "target dot";
      const detail = target
        ? `P ${Math.round(target.physical.x)}, ${Math.round(target.physical.y)} | ` +
          `S ${Math.round(target.screen.x)}, ${Math.round(target.screen.y)}`
        : "target placed";
      showSingleResult(name, true, detail);
    });

    window.addEventListener("agent-hand-config-ready", applyHandConfigToForm);
    applyHandConfigToForm();
    enableCoordinatesByDefault();

    return panel;
  }

  function setStatus(text, state = "") {
    ensurePanel();
    statusEl.textContent = text;
    statusEl.dataset.state = state;
  }

  function renderRows(results) {
    ensurePanel();
    rowsEl.innerHTML = "";

    results.forEach(result => {
      const row = document.createElement("div");
      row.className = `agent-test-row ${result.ok ? "is-pass" : "is-fail"}`;
      row.innerHTML = `
        <span>${result.ok ? "PASS" : "FAIL"}</span>
        <strong>${result.name}</strong>
        <small>${result.detail || ""}</small>
      `;
      rowsEl.appendChild(row);
    });
  }

  function showSingleResult(name, ok, detail = "") {
    renderRows([{ name, ok, detail }]);
    setStatus(ok ? "pass" : "fail", ok ? "pass" : "fail");
  }

  function enableCoordinatesByDefault() {
    if (!window.getCoordinateDebugState || !window.setCoordinateDebugEnabled) return;
    const state = getCoordinateDebugState();
    if (!state || !state.enabled) {
      setCoordinateDebugEnabled(true);
    }
  }

  function getFormDataObject() {
    const formData = new FormData(panel.querySelector("[data-agent-move-form]"));
    return {
      cardId: formData.get("cardId"),
      space: formData.get("space"),
      follow: formData.get("follow"),
      x: formData.get("x"),
      y: formData.get("y"),
      duration: formData.get("duration"),
      steps: formData.get("steps"),
      factor: formData.get("factor"),
      zoomDuration: formData.get("zoomDuration")
    };
  }

  function applyHandConfigToForm() {
    const form = panel && panel.querySelector("[data-agent-move-form]");
    if (!form || handConfigSeeded || !window.AgentHand || typeof AgentHand.getConfig !== "function") return;

    const config = AgentHand.getConfig();
    const move = config.move || config.cursor || {};
    const zoom = config.zoom || {};

    if (Number.isFinite(Number(move.duration))) {
      form.elements.duration.value = move.duration;
    }
    if (Number.isFinite(Number(move.steps))) {
      form.elements.steps.value = move.steps;
    }
    if (typeof move.follow === "boolean") {
      form.elements.follow.value = move.follow ? "true" : "false";
    }
    if (Number.isFinite(Number(zoom.factor))) {
      form.elements.factor.value = zoom.factor;
    }
    if (Number.isFinite(Number(zoom.duration))) {
      form.elements.zoomDuration.value = zoom.duration;
    }

    handConfigSeeded = true;
  }

  function setFormPointFromTarget(target) {
    if (!target) return;

    const form = panel.querySelector("[data-agent-move-form]");
    const space = form.elements.space.value;
    const point = space === "physical" ? target.physical : target.screen;
    form.elements.x.value = Math.round(point.x);
    form.elements.y.value = Math.round(point.y);
  }

  function armTargetDot() {
    if (!window.SpaceTest || !SpaceTest.cursorTarget) {
      showSingleResult("target dot", false, "SpaceTest.cursorTarget is not loaded");
      return;
    }

    SpaceTest.cursorTarget.arm();
    setStatus("set dot", "running");
    renderRows([{
      name: "target dot",
      ok: true,
      detail: "click the canvas to place target"
    }]);
  }

  function clearTargetDot() {
    if (!window.SpaceTest || !SpaceTest.cursorTarget) {
      showSingleResult("target dot clear", false, "SpaceTest.cursorTarget is not loaded");
      return;
    }

    SpaceTest.cursorTarget.clear();
    showSingleResult("target dot clear", true, "cleared");
  }

  async function runTargetAction(action) {
    try {
      if (action === "set") {
        armTargetDot();
      } else if (action === "clear") {
        clearTargetDot();
      }
    } catch (error) {
      showSingleResult(`target ${action}`, false, error && error.message ? error.message : String(error));
    }
  }

  async function runAction(action) {
    try {
      setStatus("running", "running");
      if (!window.SpaceTest || !SpaceTest.handAction) {
        showSingleResult(action, false, "SpaceTest.handAction is not loaded");
        return;
      }

      const params = getFormDataObject();
      let result = null;

      if (action === "move") {
        result = await SpaceTest.handAction.move(params);
      } else if (action === "m_click") {
        result = await (SpaceTest.handAction.m_click || SpaceTest.handAction.click)(params);
      } else if (action === "drag") {
        result = await SpaceTest.handAction.drag(params);
      } else if (action === "focus") {
        result = await SpaceTest.handAction.focus(params);
      } else if (action === "close") {
        result = await SpaceTest.handAction.close(params);
      } else if (action === "zoom-in") {
        result = await SpaceTest.handAction.zoom({ ...params, direction: "in" });
      } else if (action === "zoom-out") {
        result = await SpaceTest.handAction.zoom({ ...params, direction: "out" });
      }

      if (!result) {
        showSingleResult(action, false, "No result");
        return;
      }

      showSingleResult(action, result.ok, result.detail);
    } catch (error) {
      showSingleResult(action, false, error && error.message ? error.message : String(error));
    }
  }

  window.AgentTestPanel = {
    open: () => {
      ensurePanel();
      panel.classList.remove("is-collapsed");
      panel.querySelector(".agent-test-toggle").setAttribute("aria-expanded", "true");
    },
    close: () => {
      ensurePanel();
      panel.classList.add("is-collapsed");
      panel.querySelector(".agent-test-toggle").setAttribute("aria-expanded", "false");
    }
  };

  ensurePanel();
})();

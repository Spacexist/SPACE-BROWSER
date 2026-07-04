// test/coordinate-debug.js
// Manual coordinate test mode. Type //**//** to toggle.

(function initializeCardCoordinateDebug() {
  function ensureDebugLayer() {
    let layer = document.getElementById("coordinate-debug-layer");
    if (layer) return layer;

    layer = document.createElement("div");
    layer.className = "coordinate-debug-layer";
    layer.id = "coordinate-debug-layer";
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = `
      <div class="coordinate-debug-status">2D COORD TEST</div>
      <div class="mouse-coordinate-label" id="mouse-coordinate-label"></div>
    `;
    viewport.appendChild(layer);
    return layer;
  }

  const debugLayer = ensureDebugLayer();
  const mouseLabel = document.getElementById("mouse-coordinate-label");
  const debugSequence = "//**//**";
  const cardLabels = new Map();
  const iframeSensors = new Map();

  let keyBuffer = "";
  let enabled = false;
  let frame = 0;
  let pointerClientX = 0;
  let pointerClientY = 0;

  if (!debugLayer || !mouseLabel) return;

  function formatCoordinate(value) {
    if (!Number.isFinite(value)) return "-";
    return Math.abs(value) >= 1000
      ? Math.round(value).toString()
      : value.toFixed(1);
  }

  function removeLabels() {
    cardLabels.forEach(label => label.remove());
    cardLabels.clear();
  }

  function updatePointerFromEvent(event) {
    pointerClientX = event.clientX;
    pointerClientY = event.clientY;
    scheduleCardCoordinateDebug();
  }

  function removeIframeSensors() {
    iframeSensors.forEach(sensor => sensor.remove());
    iframeSensors.clear();
  }

  function getIframeSensor(card) {
    if (iframeSensors.has(card.id)) return iframeSensors.get(card.id);

    const wrapper = card.element.querySelector(".iframe-wrapper");
    if (!wrapper) return null;

    const sensor = document.createElement("div");
    sensor.className = "coordinate-debug-iframe-sensor";
    sensor.dataset.cardId = card.id;
    sensor.addEventListener("mousemove", updatePointerFromEvent);
    sensor.addEventListener("mouseenter", updatePointerFromEvent);
    sensor.addEventListener("mouseup", updatePointerFromEvent);
    sensor.addEventListener("click", updatePointerFromEvent);
    wrapper.appendChild(sensor);
    iframeSensors.set(card.id, sensor);
    return sensor;
  }

  function syncIframeSensors(visibleIds) {
    const captureIframePointer = Boolean(
      window.SpaceTest &&
      SpaceTest.cursorTarget &&
      typeof SpaceTest.cursorTarget.isArmed === "function" &&
      SpaceTest.cursorTarget.isArmed()
    );

    if (!captureIframePointer) {
      removeIframeSensors();
      return;
    }

    cardsList.forEach(card => {
      if (!card || card.type !== "page" || !card.element || !card.element.isConnected) return;
      if (!card.element.classList.contains("has-iframe")) return;
      getIframeSensor(card);
    });

    iframeSensors.forEach((sensor, cardId) => {
      if (visibleIds.has(cardId)) return;
      sensor.remove();
      iframeSensors.delete(cardId);
    });
  }

  function getLabel(card) {
    let label = cardLabels.get(card.id);
    if (label) return label;

    label = document.createElement("div");
    label.className = "card-coordinate-label";
    label.dataset.cardId = card.id;
    debugLayer.appendChild(label);
    cardLabels.set(card.id, label);
    return label;
  }

  function render() {
    frame = 0;
    if (!enabled || !debugLayer || !mouseLabel) return;

    const viewportRect = viewport.getBoundingClientRect();
    const visibleIds = new Set();

    cardsList.forEach(card => {
      if (!card || !card.element || !card.element.isConnected) return;

      const geometry = getCardWorldGeometry(card);
      if (!geometry) return;

      visibleIds.add(card.id);
      const label = getLabel(card);
      const cardRect = card.element.getBoundingClientRect();
      const screenX = cardRect.left - viewportRect.left;
      const screenY = cardRect.top - viewportRect.top;
      const onScreen = cardRect.right >= viewportRect.left &&
        cardRect.left <= viewportRect.right &&
        cardRect.bottom >= viewportRect.top &&
        cardRect.top <= viewportRect.bottom;

      label.hidden = !onScreen;
      if (!onScreen) return;

      label.textContent =
        `#${card.id} ${card.type.toUpperCase()}  ` +
        `P ${formatCoordinate(geometry.x)}, ${formatCoordinate(geometry.y)}  ·  ` +
        `S ${formatCoordinate(screenX)}, ${formatCoordinate(screenY)}`;
      const labelX = Math.max(6, screenX + 10);
      const labelY = Math.max(6, cardRect.bottom - viewportRect.top - label.offsetHeight - 9);
      label.style.transform =
        `translate3d(${Math.round(labelX)}px, ${Math.round(labelY)}px, 0)`;
    });

    syncIframeSensors(visibleIds);

    cardLabels.forEach((label, cardId) => {
      if (visibleIds.has(cardId)) return;
      label.remove();
      cardLabels.delete(cardId);
    });

    const pointerScreenX = pointerClientX - viewportRect.left;
    const pointerScreenY = pointerClientY - viewportRect.top;
    const pointerWorld = clientToWorld(pointerClientX, pointerClientY);
    mouseLabel.textContent =
      `MOUSE  P ${formatCoordinate(pointerWorld.x)}, ${formatCoordinate(pointerWorld.y)}  ·  ` +
      `S ${formatCoordinate(pointerScreenX)}, ${formatCoordinate(pointerScreenY)}`;

    const mouseX = Math.min(
      Math.max(8, pointerScreenX + 14),
      Math.max(8, viewportRect.width - mouseLabel.offsetWidth - 8)
    );
    const mouseY = Math.min(
      Math.max(8, pointerScreenY + 16),
      Math.max(8, viewportRect.height - mouseLabel.offsetHeight - 8)
    );
    mouseLabel.style.transform =
      `translate3d(${Math.round(mouseX)}px, ${Math.round(mouseY)}px, 0)`;

    const motionActive = Boolean(
      panning || activeDragCard || activeResizeCard || viewAnimation ||
      viewCompositorAnimation || wheelFrame || pointerMoveFrame
    );
    if (motionActive) scheduleCardCoordinateDebug();
  }

  scheduleCardCoordinateDebug = function scheduleCoordinateDebug() {
    if (!enabled || frame) return;
    frame = requestAnimationFrame(render);
  };

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    debugLayer.hidden = !enabled;
    debugLayer.setAttribute("aria-hidden", String(!enabled));

    if (!enabled) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      removeLabels();
      removeIframeSensors();
      mouseLabel.style.transform = "translate3d(-10000px, -10000px, 0)";
      showToast("二维坐标测试已关闭");
      return;
    }

    scheduleCardCoordinateDebug();
    showToast("二维坐标测试已开启");
  }

  window.addEventListener("mousemove", updatePointerFromEvent);
  window.addEventListener("mouseup", scheduleCardCoordinateDebug);
  window.addEventListener("click", scheduleCardCoordinateDebug);
  window.addEventListener("resize", scheduleCardCoordinateDebug);

  window.addEventListener("keydown", event => {
    if (enabled) scheduleCardCoordinateDebug();
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        event.key.length !== 1) return;

    keyBuffer = (keyBuffer + event.key).slice(-debugSequence.length);
    if (keyBuffer !== debugSequence) return;

    keyBuffer = "";
    setEnabled(!enabled);
  });

  window.setCoordinateDebugEnabled = setEnabled;
  window.getCoordinateDebugState = () => ({
    enabled,
    mouseScreen: {
      x: pointerClientX - viewport.getBoundingClientRect().left,
      y: pointerClientY - viewport.getBoundingClientRect().top
    },
    mouseWorld: clientToWorld(pointerClientX, pointerClientY),
    view: { x: view.x, y: view.y, zoom: view.zoom }
  });
})();

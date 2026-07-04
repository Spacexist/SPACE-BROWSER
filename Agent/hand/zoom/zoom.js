// Agent/hand/zoom/zoom.js
// Zoom action module for the canvas view.

(function initializeAgentHandZoom() {
  function animateViewToPromise(targetX, targetY, targetZoom, options = {}) {
    return new Promise(resolve => {
      if (typeof animateViewTo === "function" && Number(options.duration) > 0) {
        animateViewTo(targetX, targetY, targetZoom, resolve, {
          duration: Number(options.duration),
          deferGrid: true,
          compositor: true
        });
        return;
      }

      view.x = targetX;
      view.y = targetY;
      view.zoom = targetZoom;
      if (typeof updateView === "function") updateView();
      resolve();
    });
  }

  async function run(payload = {}, options = {}, context = {}) {
    const zoomOptions = context.getZoomOptions
      ? context.getZoomOptions({ ...payload, ...options })
      : { ...payload, ...options };
    const factor = Number(zoomOptions.factor) || 1.3;
    const minZoom = Number(zoomOptions.min) || 0.04;
    const maxZoom = Number(zoomOptions.max) || 8;
    const direction = String(
      zoomOptions.direction ||
      zoomOptions.mode ||
      (zoomOptions.delta > 0 ? "in" : zoomOptions.delta < 0 ? "out" : "")
    ).toLowerCase();

    let targetZoom = Number(zoomOptions.zoom);
    if (!Number.isFinite(targetZoom)) {
      if (direction === "out") {
        targetZoom = view.zoom / factor;
      } else {
        targetZoom = view.zoom * factor;
      }
    }
    targetZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));

    const anchorInput = zoomOptions.point || zoomOptions.anchor || { space: "screen", ...getViewportCenterScreen() };
    const anchorClient = context.resolveClientPoint
      ? context.resolveClientPoint(anchorInput)
      : screenToClient(anchorInput.x, anchorInput.y);
    const anchorScreen = clientToScreen(anchorClient.x, anchorClient.y);
    const worldAtAnchor = screenToWorld(anchorScreen.x, anchorScreen.y);
    const targetX = anchorScreen.x - worldAtAnchor.x * targetZoom;
    const targetY = anchorScreen.y - worldAtAnchor.y * targetZoom;

    await animateViewToPromise(targetX, targetY, targetZoom, zoomOptions);

    return {
      ok: true,
      zoom: view.zoom,
      view: { x: view.x, y: view.y, zoom: view.zoom },
      detail: `zoom ${Math.round(view.zoom * 100)}%`
    };
  }

  window.AgentHandZoom = {
    run
  };
})();

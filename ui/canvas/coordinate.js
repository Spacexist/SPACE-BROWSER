// canvas/coordinate.js
// Shared coordinate model for the infinite canvas.

// View state is the camera transform from world space into viewport screen space.
var view = { x: 0, y: 0, zoom: 1 };
var viewportBounds = null;

function getCanvasViewportElement() {
  return document.getElementById("viewport");
}

function refreshViewportBounds() {
  const viewportElement = getCanvasViewportElement();
  if (!viewportElement) {
    viewportBounds = { left: 0, top: 0, width: 0, height: 0 };
    return viewportBounds;
  }

  const rect = viewportElement.getBoundingClientRect();
  viewportBounds = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
  return viewportBounds;
}

function getViewportBounds() {
  return viewportBounds || refreshViewportBounds();
}

// Coordinate spaces:
// - world: infinite-canvas physical units measured from the canvas origin.
// - screen: pixels measured from the browser window's top-left corner.
// - client: browser content coordinates reported by DOM events.
// - viewport: pixels measured from the canvas viewport's top-left corner.
function clientToViewport(clientX, clientY) {
  const rect = getViewportBounds();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function viewportToClient(viewportX, viewportY) {
  const rect = getViewportBounds();
  return {
    x: rect.left + viewportX,
    y: rect.top + viewportY
  };
}

function clientToScreen(clientX, clientY) {
  const insets = getBrowserChromeInsets();
  return {
    x: insets.left + clientX,
    y: insets.top + clientY
  };
}

function screenToClient(screenX, screenY) {
  const insets = getBrowserChromeInsets();
  return {
    x: screenX - insets.left,
    y: screenY - insets.top
  };
}

function viewportToScreen(viewportX, viewportY) {
  const client = viewportToClient(viewportX, viewportY);
  return clientToScreen(client.x, client.y);
}

function screenToViewport(screenX, screenY) {
  const client = screenToClient(screenX, screenY);
  return clientToViewport(client.x, client.y);
}

function screenToWorld(screenX, screenY) {
  const viewportPoint = screenToViewport(screenX, screenY);
  return {
    x: (viewportPoint.x - view.x) / view.zoom,
    y: (viewportPoint.y - view.y) / view.zoom
  };
}

function worldToScreen(worldX, worldY) {
  const viewportPoint = {
    x: view.x + worldX * view.zoom,
    y: view.y + worldY * view.zoom
  };
  return viewportToScreen(viewportPoint.x, viewportPoint.y);
}

function worldToViewport(worldX, worldY) {
  return {
    x: view.x + worldX * view.zoom,
    y: view.y + worldY * view.zoom
  };
}

function viewportToWorld(viewportX, viewportY) {
  return {
    x: (viewportX - view.x) / view.zoom,
    y: (viewportY - view.y) / view.zoom
  };
}

function clientToWorld(clientX, clientY) {
  const point = clientToViewport(clientX, clientY);
  return viewportToWorld(point.x, point.y);
}

function worldToClient(worldX, worldY) {
  const point = worldToViewport(worldX, worldY);
  return viewportToClient(point.x, point.y);
}

function getViewportCenterScreen() {
  const rect = getViewportBounds();
  return clientToScreen(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2
  );
}

function getViewportCenterViewport() {
  const rect = getViewportBounds();
  return {
    x: rect.width / 2,
    y: rect.height / 2
  };
}

function getViewportCenterClient() {
  const center = getViewportCenterViewport();
  return viewportToClient(center.x, center.y);
}

function getViewportScreenBounds() {
  const bounds = getViewportBounds();
  const topLeft = viewportToScreen(0, 0);
  const bottomRight = viewportToScreen(bounds.width, bounds.height);
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
    width: bounds.width,
    height: bounds.height
  };
}

function getBrowserChromeInsets() {
  const horizontalChrome = Math.max(0, window.outerWidth - window.innerWidth);
  const verticalChrome = Math.max(0, window.outerHeight - window.innerHeight);
  const sideInset = horizontalChrome / 2;
  const bottomInset = Math.min(sideInset, verticalChrome);
  return {
    left: sideInset,
    right: horizontalChrome - sideInset,
    top: Math.max(0, verticalChrome - bottomInset),
    bottom: bottomInset
  };
}

function getPhysicalWindowCenterScreen() {
  return {
    x: window.outerWidth / 2,
    y: window.outerHeight / 2
  };
}

function getViewportScreenOcclusion() {
  const screenBounds = getViewportScreenBounds();
  return {
    left: Math.max(0, screenBounds.left),
    top: Math.max(0, screenBounds.top),
    right: Math.max(0, window.outerWidth - screenBounds.right),
    bottom: Math.max(0, window.outerHeight - screenBounds.bottom)
  };
}

function getFocusViewportMetrics() {
  const viewport = getViewportBounds();
  const screen = getViewportScreenBounds();
  const occlusion = getViewportScreenOcclusion();
  return {
    viewport: {
      left: 0,
      top: 0,
      width: viewport.width,
      height: viewport.height
    },
    screen,
    occlusion,
    center: {
      x: viewport.width / 2,
      y: viewport.height / 2
    }
  };
}

function clientToDesktop(clientX, clientY) {
  const insets = getBrowserChromeInsets();
  return {
    x: window.screenX + insets.left + clientX,
    y: window.screenY + insets.top + clientY
  };
}

function screenToDesktop(screenX, screenY) {
  return {
    x: window.screenX + screenX,
    y: window.screenY + screenY
  };
}

function worldToDesktop(worldX, worldY) {
  const client = worldToClient(worldX, worldY);
  return clientToDesktop(client.x, client.y);
}

function getViewportCenterDesktop() {
  const center = getViewportCenterClient();
  return clientToDesktop(center.x, center.y);
}

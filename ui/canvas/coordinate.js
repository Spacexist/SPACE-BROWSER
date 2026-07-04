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
// - screen: pixels measured from the viewport's top-left corner.
// - client: browser event coordinates, which include the viewport's page offset.
function clientToScreen(clientX, clientY) {
  const rect = getViewportBounds();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function screenToClient(screenX, screenY) {
  const rect = getViewportBounds();
  return {
    x: rect.left + screenX,
    y: rect.top + screenY
  };
}

function screenToWorld(screenX, screenY) {
  return {
    x: (screenX - view.x) / view.zoom,
    y: (screenY - view.y) / view.zoom
  };
}

function worldToScreen(worldX, worldY) {
  return {
    x: view.x + worldX * view.zoom,
    y: view.y + worldY * view.zoom
  };
}

function clientToWorld(clientX, clientY) {
  const point = clientToScreen(clientX, clientY);
  return screenToWorld(point.x, point.y);
}

function worldToClient(worldX, worldY) {
  const point = worldToScreen(worldX, worldY);
  return screenToClient(point.x, point.y);
}

function getViewportCenterScreen() {
  const rect = getViewportBounds();
  return {
    x: rect.width / 2,
    y: rect.height / 2
  };
}

function getViewportCenterClient() {
  const center = getViewportCenterScreen();
  return screenToClient(center.x, center.y);
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
  const insets = getBrowserChromeInsets();
  return {
    x: window.outerWidth / 2 - insets.left,
    y: window.outerHeight / 2 - insets.top
  };
}

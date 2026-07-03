// canvas/canvas.js
// Dedicated Module for Canvas Infinite Viewport, Zooming/Panning, Dot-grid, and File Drops

// Viewport state shared globally
var view = { x: 0, y: 0, zoom: 1 };
var gridFrame = 0;
var gridPointer = {
  x: -10000,
  y: -10000,
  visualX: -10000,
  visualY: -10000,
  velocityX: 0,
  velocityY: 0,
  strength: 0,
  inside: false
};
var spaceDown = false;
var panning = null;
var dotGridEffect = document.getElementById("dot-grid-effect");
var renderedGridView = null;
var gridRefreshTimer = 0;
var gridViewMotionActive = false;
var viewportBounds = null;
var pointerMoveFrame = 0;
var latestPointerPosition = { clientX: -10000, clientY: -10000 };
var wheelFrame = 0;
var pendingWheelInput = { clientX: 0, clientY: 0, deltaY: 0 };

const DOT_GRID_CACHE_PADDING = 128;
const DOT_GRID_EFFECT_SIZE = 320;
const DOT_GRID_EFFECT_RADIUS = 140;
const DOT_GRID_SETTLE_DELAY = 80;

function refreshViewportBounds() {
  const rect = viewport.getBoundingClientRect();
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

// Coordinate Conversion
function screenToWorld(clientX, clientY) {
  const rect = getViewportBounds();
  return {
    x: (clientX - rect.left - view.x) / view.zoom,
    y: (clientY - rect.top - view.y) / view.zoom
  };
}

// Reset/Fit View
var viewAnimation = null;
var viewCompositorAnimation = null;
var viewAnimationDefersGrid = false;
var renderedZoomPercent = null;

function finishDeferredViewRendering(refreshGrid = true) {
  if (!viewAnimationDefersGrid) return;

  viewAnimationDefersGrid = false;
  world.style.willChange = "";
  if (refreshGrid) {
    previewStaticDotGrid();
    scheduleDotGrid();
  }
}

function cancelViewAnimation(refreshGrid = true) {
  if (viewCompositorAnimation) {
    const animation = viewCompositorAnimation;
    viewCompositorAnimation = null;

    // WAAPI focus moves run outside the JS view state. Capture the current
    // compositor matrix before cancelling so dragging or a second focus move
    // continues from the exact visible position instead of jumping.
    const transform = getComputedStyle(world).transform;
    if (transform && transform !== "none") {
      try {
        const matrix = new DOMMatrixReadOnly(transform);
        view.x = matrix.e;
        view.y = matrix.f;
        view.zoom = Math.abs(matrix.a);
      } catch (_) {
        // Keep the last stable view if an older browser cannot parse matrices.
      }
    }
    animation.cancel();
    updateView({ updateGrid: false });
  }

  if (viewAnimation) {
    cancelAnimationFrame(viewAnimation);
    viewAnimation = null;
  }
  finishDeferredViewRendering(refreshGrid);
}

function animateViewTo(
  targetX,
  targetY,
  targetZoom,
  onComplete = null,
  options = {}
) {
  cancelViewAnimation(false);

  const deferGrid = Boolean(options.deferGrid);
  const duration = Number.isFinite(options.duration)
    ? Math.max(0, options.duration)
    : 300;
  const movementIsNegligible =
    Math.abs(targetX - view.x) < 0.01 &&
    Math.abs(targetY - view.y) < 0.01 &&
    Math.abs(targetZoom - view.zoom) < 0.0001;

  if (movementIsNegligible || duration === 0) {
    view.x = targetX;
    view.y = targetY;
    view.zoom = targetZoom;
    updateView();
    if (typeof onComplete === "function") onComplete();
    return;
  }

  if (deferGrid) {
    viewAnimationDefersGrid = true;
    world.style.willChange = "transform";
    gridPointer.strength = 0;
    hideDotGridEffect();
  }

  if (options.compositor && typeof world.animate === "function") {
    const startTransform =
      `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    const targetTransform =
      `translate(${targetX}px, ${targetY}px) scale(${targetZoom})`;

    viewAnimation = requestAnimationFrame(() => {
      viewAnimation = null;
      const animation = world.animate(
        [
          { transform: startTransform },
          { transform: targetTransform }
        ],
        {
          duration,
          easing: "cubic-bezier(0.215, 0.61, 0.355, 1)",
          fill: "forwards"
        }
      );
      viewCompositorAnimation = animation;

      animation.onfinish = () => {
        if (viewCompositorAnimation !== animation) return;

        viewCompositorAnimation = null;
        view.x = targetX;
        view.y = targetY;
        view.zoom = targetZoom;
        updateView({ updateGrid: false });
        animation.cancel();
        finishDeferredViewRendering(true);
        if (typeof onComplete === "function") {
          onComplete();
        }
      };
    });
    return;
  }
  
  var startTime = 0;
  const startX = view.x;
  const startY = view.y;
  const startZoom = view.zoom;
  
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const ease = 1 - Math.pow(1 - progress, 3); // Cubic-out easing
    
    view.x = startX + (targetX - startX) * ease;
    view.y = startY + (targetY - startY) * ease;
    view.zoom = startZoom + (targetZoom - startZoom) * ease;
    
    updateView({ updateGrid: !deferGrid });
    
    if (progress < 1) {
      viewAnimation = requestAnimationFrame(step);
    } else {
      viewAnimation = null;
      finishDeferredViewRendering(true);
      if (typeof onComplete === "function") {
        onComplete();
      }
    }
  }

  function beginAnimation(now) {
    startTime = now;
    viewAnimation = requestAnimationFrame(step);
  }

  // Give Chromium one paint to promote the world before moving large iframe
  // surfaces. This avoids paying layer creation on the first animation frame.
  viewAnimation = requestAnimationFrame(beginAnimation);
}

function updateView(options = {}) {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const zoomPercent = Math.round(view.zoom * 100);
  if (zoomPercent !== renderedZoomPercent) {
    renderedZoomPercent = zoomPercent;
    zoomLabel.textContent = `${zoomPercent}%`;
  }
  if (options.updateGrid !== false) {
    previewStaticDotGrid();
    scheduleDotGrid();
  }
}

// Dot-Grid Rendering
function getDotGridMetrics(targetView = view) {
  let worldStep = 40;
  let size = worldStep * targetView.zoom;
  while (size < 32) {
    worldStep *= 2;
    size = worldStep * targetView.zoom;
  }
  while (size > 64) {
    worldStep /= 2;
    size = worldStep * targetView.zoom;
  }

  return {
    size,
    startX: ((targetView.x % size) + size) % size,
    startY: ((targetView.y % size) + size) % size
  };
}

function drawStaticDotGrid() {
  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  if (!viewportWidth || !viewportHeight) return;

  const width = viewportWidth + DOT_GRID_CACHE_PADDING * 2;
  const height = viewportHeight + DOT_GRID_CACHE_PADDING * 2;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));

  if (dotGrid.width !== pixelWidth || dotGrid.height !== pixelHeight) {
    dotGrid.width = pixelWidth;
    dotGrid.height = pixelHeight;
  }
  dotGrid.style.width = `${width}px`;
  dotGrid.style.height = `${height}px`;
  dotGrid.style.transform = "none";

  const ctx = dotGrid.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { size, startX, startY } = getDotGridMetrics(view);
  const minX = -DOT_GRID_CACHE_PADDING;
  const minY = -DOT_GRID_CACHE_PADDING;
  const maxX = viewportWidth + DOT_GRID_CACHE_PADDING;
  const maxY = viewportHeight + DOT_GRID_CACHE_PADDING;
  const firstX = startX + Math.ceil((minX - startX) / size) * size;
  const firstY = startY + Math.ceil((minY - startY) / size) * size;
  const baseRadius = 0.46;

  ctx.beginPath();
  for (let y = firstY; y <= maxY; y += size) {
    for (let x = firstX; x <= maxX; x += size) {
      const localX = x + DOT_GRID_CACHE_PADDING;
      const localY = y + DOT_GRID_CACHE_PADDING;
      ctx.moveTo(localX + baseRadius, localY);
      ctx.arc(localX, localY, baseRadius, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = "rgba(200, 208, 220, 0.48)";
  ctx.fill();

  renderedGridView = { x: view.x, y: view.y, zoom: view.zoom };
}

function previewStaticDotGrid() {
  if (!renderedGridView) {
    drawStaticDotGrid();
  }
  if (!renderedGridView) return;

  gridViewMotionActive = true;
  const scale = view.zoom / renderedGridView.zoom;
  const translateX = view.x - renderedGridView.x * scale;
  const translateY = view.y - renderedGridView.y * scale;
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const minX = translateX - DOT_GRID_CACHE_PADDING * scale;
  const minY = translateY - DOT_GRID_CACHE_PADDING * scale;
  const maxX = translateX + (width + DOT_GRID_CACHE_PADDING) * scale;
  const maxY = translateY + (height + DOT_GRID_CACHE_PADDING) * scale;
  const cacheStillCoversViewport = minX <= 0 && minY <= 0 &&
    maxX >= width && maxY >= height;

  if (cacheStillCoversViewport) {
    dotGrid.style.transform =
      `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
  } else {
    drawStaticDotGrid();
  }

  clearTimeout(gridRefreshTimer);
  gridRefreshTimer = window.setTimeout(() => {
    drawStaticDotGrid();
    gridViewMotionActive = false;
    scheduleDotGrid();
  }, DOT_GRID_SETTLE_DELAY);
}

function hideDotGridEffect() {
  dotGridEffect.style.transform = "translate3d(-400px, -400px, 0)";
}

function scheduleDotGrid() {
  if (gridFrame) return;
  gridFrame = requestAnimationFrame(() => {
    gridFrame = 0;
    const interactionActive = Boolean(
      gridViewMotionActive || panning || activeDragCard || activeResizeCard
    );

    if (interactionActive) {
      gridPointer.strength = 0;
      gridPointer.velocityX = 0;
      gridPointer.velocityY = 0;
      hideDotGridEffect();
      return;
    }

    const targetStrength = gridPointer.inside ? 1 : 0;
    const strengthEase = gridPointer.inside ? 0.14 : 0.18;

    // A damped spring gives the field a short, light return without keeping a
    // permanent animation loop alive.
    const spring = 0.22;
    const damping = 0.58;
    gridPointer.velocityX = (gridPointer.velocityX +
      (gridPointer.x - gridPointer.visualX) * spring) * damping;
    gridPointer.velocityY = (gridPointer.velocityY +
      (gridPointer.y - gridPointer.visualY) * spring) * damping;
    gridPointer.visualX += gridPointer.velocityX;
    gridPointer.visualY += gridPointer.velocityY;
    gridPointer.strength += (targetStrength - gridPointer.strength) * strengthEase;

    drawDotGridEffect();

    const pointerMoving = targetStrength > 0.01 && (
      Math.abs(gridPointer.x - gridPointer.visualX) > 0.15 ||
      Math.abs(gridPointer.y - gridPointer.visualY) > 0.15 ||
      Math.abs(gridPointer.velocityX) > 0.05 ||
      Math.abs(gridPointer.velocityY) > 0.05
    );
    const strengthChanging = Math.abs(targetStrength - gridPointer.strength) > 0.01;
    if (pointerMoving || strengthChanging) scheduleDotGrid();
  });
}

function drawDotGridEffect() {
  if (!dotGridEffect) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelSize = Math.max(1, Math.round(DOT_GRID_EFFECT_SIZE * ratio));
  if (dotGridEffect.width !== pixelSize || dotGridEffect.height !== pixelSize) {
    dotGridEffect.width = pixelSize;
    dotGridEffect.height = pixelSize;
  }

  const ctx = dotGridEffect.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, DOT_GRID_EFFECT_SIZE, DOT_GRID_EFFECT_SIZE);

  if (gridPointer.strength <= 0.004) {
    hideDotGridEffect();
    return;
  }

  const halfSize = DOT_GRID_EFFECT_SIZE / 2;
  const canvasLeft = Math.floor(gridPointer.visualX - halfSize);
  const canvasTop = Math.floor(gridPointer.visualY - halfSize);
  dotGridEffect.style.transform =
    `translate3d(${canvasLeft}px, ${canvasTop}px, 0)`;

  // The local layer replaces this small square exactly, so no circular mask
  // or halo is needed over the cached full-screen grid.
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, DOT_GRID_EFFECT_SIZE, DOT_GRID_EFFECT_SIZE);

  const { size, startX, startY } = getDotGridMetrics(renderedGridView || view);
  const baseRadius = 0.46;
  const hoverRadiusSquared = DOT_GRID_EFFECT_RADIUS * DOT_GRID_EFFECT_RADIUS;
  const firstX = startX + Math.ceil((canvasLeft - startX) / size) * size;
  const firstY = startY + Math.ceil((canvasTop - startY) / size) * size;
  const maxX = canvasLeft + DOT_GRID_EFFECT_SIZE;
  const maxY = canvasTop + DOT_GRID_EFFECT_SIZE;
  const influencedDots = [];

  ctx.beginPath();
  for (let y = firstY; y <= maxY; y += size) {
    for (let x = firstX; x <= maxX; x += size) {
      const localX = x - canvasLeft;
      const localY = y - canvasTop;
      const dx = x - gridPointer.visualX;
      const dy = y - gridPointer.visualY;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared < hoverRadiusSquared) {
        const distance = Math.sqrt(distanceSquared);
        const distanceRatio = distance / DOT_GRID_EFFECT_RADIUS;
        const proximity = 1 - distanceRatio;
        const easedProximity = proximity * proximity * (3 - 2 * proximity);
        const influence = easedProximity * gridPointer.strength;
        const displacement = 9 * influence;
        const directionX = distance > 0.01 ? dx / distance : 0;
        const directionY = distance > 0.01 ? dy / distance : 0;
        influencedDots.push({
          x: localX + directionX * displacement,
          y: localY + directionY * displacement,
          influence
        });
        continue;
      }

      ctx.moveTo(localX + baseRadius, localY);
      ctx.arc(localX, localY, baseRadius, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = "rgba(200, 208, 220, 0.48)";
  ctx.fill();

  // The field is expressed mainly through displacement, not brightness.
  for (const dot of influencedDots) {
    const radius = baseRadius + 0.48 * dot.influence;
    const alpha = 0.48 + 0.3 * dot.influence;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(214, 222, 232, ${alpha})`;
    ctx.fill();
  }
}

// Keyboard keyup listener for Spacebar grabbing
window.addEventListener("keyup", event => {
  if (event.code === "Space") {
    spaceDown = false;
    if (!panning) viewport.style.cursor = "";
  }
});

// Windows resize
window.addEventListener("resize", () => {
  refreshViewportBounds();
  clearTimeout(gridRefreshTimer);
  renderedGridView = null;
  gridViewMotionActive = false;
  drawStaticDotGrid();
  scheduleDotGrid();
});

// Canvas Viewport Events (Panning & Zooming)
function applyPendingWheelZoom() {
  wheelFrame = 0;
  const deltaY = pendingWheelInput.deltaY;
  pendingWheelInput.deltaY = 0;
  if (!deltaY) return;

  const rect = getViewportBounds();
  const screenX = pendingWheelInput.clientX - rect.left;
  const screenY = pendingWheelInput.clientY - rect.top;
  
  const worldX = (screenX - view.x) / view.zoom;
  const worldY = (screenY - view.y) / view.zoom;
  
  // Calculate next zoom using exponential step
  const next = Math.min(8, Math.max(0.04, view.zoom * Math.exp(-deltaY * 0.0012)));
  
  view.x = screenX - worldX * next;
  view.y = screenY - worldY * next;
  view.zoom = next;
  
  updateView();
}

viewport.addEventListener("wheel", event => {
  event.preventDefault();
  interruptFocusViewTransition();

  pendingWheelInput.clientX = event.clientX;
  pendingWheelInput.clientY = event.clientY;
  pendingWheelInput.deltaY += event.deltaY;
  if (!wheelFrame) {
    wheelFrame = requestAnimationFrame(applyPendingWheelZoom);
  }
}, { passive: false });

viewport.addEventListener("mousedown", event => {
  const interactive = event.target.closest(".card-item");
  
  // Focus does not lock canvas navigation. Empty space remains available
  // for panning; Escape is the only focus-exit shortcut.
  if (event.button === 1 || (event.button === 0 && (spaceDown || !interactive))) {
    event.preventDefault();
    interruptFocusViewTransition();
    panning = { x: event.clientX - view.x, y: event.clientY - view.y };
    viewport.style.cursor = "grabbing";
    viewport.classList.add("panning");
    setPageIframeInteractionShield(true);
  }
});

function applyPendingPointerMove() {
  pointerMoveFrame = 0;
  const clientX = latestPointerPosition.clientX;
  const clientY = latestPointerPosition.clientY;
  const rect = getViewportBounds();
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;
  const pointerInside = pointerX >= 0 && pointerX <= rect.width &&
    pointerY >= 0 && pointerY <= rect.height;

  if (pointerInside && !gridPointer.inside) {
    gridPointer.visualX = pointerX;
    gridPointer.visualY = pointerY;
    gridPointer.velocityX = 0;
    gridPointer.velocityY = 0;
  }
  gridPointer.x = pointerX;
  gridPointer.y = pointerY;
  gridPointer.inside = pointerInside;
  scheduleDotGrid();
  
  if (panning) {
    view.x = clientX - panning.x;
    view.y = clientY - panning.y;
    updateView();
    return;
  }
  
  // Dragging card
  if (activeDragCard && activeDragCardData) {
    const worldMouse = screenToWorld(clientX, clientY);
    const cardObj = activeDragCardData;
    
    if (cardObj) {
      cardObj.x = worldMouse.x - cardDragOffset.x;
      cardObj.y = worldMouse.y - cardDragOffset.y;
      activeDragCard.style.left = `${cardObj.x}px`;
      activeDragCard.style.top = `${cardObj.y}px`;
    }
    return;
  }
  
  // Resizing card
  if (activeResizeCard && activeResizeCardData && resizeDirection) {
    const cardObj = activeResizeCardData;
    
    if (cardObj) {
      const dx = (clientX - resizeStart.clientX) / view.zoom;
      const dy = (clientY - resizeStart.clientY) / view.zoom;
      
      let nextW = resizeStart.width;
      let nextH = resizeStart.height;
      let nextX = resizeStart.x;
      let nextY = resizeStart.y;
      
      const minW = cardObj.type === "page" ? 400 : (cardObj.type === "image" || cardObj.type === "excel" ? 200 : 150);
      const minH = cardObj.type === "page" ? 300 : (cardObj.type === "image" || cardObj.type === "excel" ? 150 : 100);
      
      if (resizeDirection.includes('r')) {
        nextW = Math.max(minW, resizeStart.width + dx);
      }
      if (resizeDirection.includes('l')) {
        const proposedW = resizeStart.width - dx;
        if (proposedW >= minW) {
          nextW = proposedW;
          nextX = resizeStart.x + dx;
        }
      }
      if (resizeDirection.includes('b')) {
        nextH = Math.max(minH, resizeStart.height + dy);
      }
      if (resizeDirection.includes('t')) {
        const proposedH = resizeStart.height - dy;
        if (proposedH >= minH) {
          nextH = proposedH;
          nextY = resizeStart.y + dy;
        }
      }
      
      cardObj.width = nextW;
      cardObj.height = nextH;
      cardObj.x = nextX;
      cardObj.y = nextY;
      
      activeResizeCard.style.width = `${nextW}px`;
      activeResizeCard.style.height = `${nextH}px`;
      activeResizeCard.style.left = `${nextX}px`;
      activeResizeCard.style.top = `${nextY}px`;
    }
  }
}

function queuePointerMove(clientX, clientY) {
  latestPointerPosition.clientX = clientX;
  latestPointerPosition.clientY = clientY;
  if (!pointerMoveFrame) {
    pointerMoveFrame = requestAnimationFrame(applyPendingPointerMove);
  }
}

window.addEventListener("mousemove", event => {
  queuePointerMove(event.clientX, event.clientY);
});

window.addEventListener("mouseup", event => {
  if (pointerMoveFrame) {
    cancelAnimationFrame(pointerMoveFrame);
    pointerMoveFrame = 0;
  }
  latestPointerPosition.clientX = event.clientX;
  latestPointerPosition.clientY = event.clientY;
  applyPendingPointerMove();

  if (panning) {
    panning = null;
    viewport.style.cursor = spaceDown ? "grab" : "";
    viewport.classList.remove("panning");
  }
  
  if (activeDragCard) {
    activeDragCard.classList.remove("dragging");
    activeDragCard = null;
    activeDragCardData = null;
    viewport.classList.remove("dragging-card");
  }
  
  if (activeResizeCard) {
    activeResizeCard.classList.remove("resizing");
    activeResizeCard = null;
    activeResizeCardData = null;
    resizeDirection = null;
    viewport.classList.remove("dragging-card");
  }

  setPageIframeInteractionShield(false);
  scheduleDotGrid();
});

viewport.addEventListener("mouseleave", () => {
  gridPointer.inside = false;
  scheduleDotGrid();
});

// Fit all cards dynamically on screen
function resetView() {
  interruptFocusViewTransition();

  const vWidth = viewport.clientWidth;
  const vHeight = viewport.clientHeight;
  
  let targetX, targetY, targetZoom;
  
  if (cardsList.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    cardsList.forEach(card => {
      minX = Math.min(minX, card.x);
      minY = Math.min(minY, card.y);
      maxX = Math.max(maxX, card.x + card.width);
      maxY = Math.max(maxY, card.y + card.height);
    });
    
    const boundingW = maxX - minX;
    const boundingH = maxY - minY;
    const padding = 120;
    
    const zoomX = (vWidth - padding * 2) / boundingW;
    const zoomY = (vHeight - padding * 2) / boundingH;
    targetZoom = Math.min(1.5, Math.max(0.15, Math.min(zoomX, zoomY)));
    
    const centerX = minX + boundingW / 2;
    const centerY = minY + boundingH / 2;
    targetX = vWidth / 2 - centerX * targetZoom;
    targetY = vHeight / 2 - centerY * targetZoom;
  } else {
    // defaults
    targetZoom = 1;
    targetX = vWidth / 2;
    targetY = vHeight / 2;
  }
  
  animateViewTo(targetX, targetY, targetZoom);
  showToast("已重置画布视角");
}

function addNewCard() {
  const rect = viewport.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const worldCenter = screenToWorld(centerX, centerY);
  
  const card = createCard(
    "动态创建的想法", 
    "双击可以直接编辑此处的文本内容。长按卡片空白处拖拽即可改变它们在无限画布里的位置。", 
    Math.round(worldCenter.x - 140), 
    Math.round(worldCenter.y - 100),
    "Brainstorm"
  );
  
  animateCardEntrance(card.element);
  enterCardFocus(card);
}

function addNewPage() {
  const rect = viewport.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const worldCenter = screenToWorld(centerX, centerY);
  
  const card = createPageCard(
    Math.round(worldCenter.x - 600), 
    Math.round(worldCenter.y - 400),
    ""
  );
  
  animateCardEntrance(card.element);
  enterCardFocus(card);
}

// Toolbar controls hookups
$("#btn-zoom-in").addEventListener("click", () => {
  interruptFocusViewTransition();
  const rect = viewport.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const worldX = (centerX - view.x) / view.zoom;
  const worldY = (centerY - view.y) / view.zoom;
  
  view.zoom = Math.min(8, view.zoom * 1.3);
  view.x = centerX - worldX * view.zoom;
  view.y = centerY - worldY * view.zoom;
  updateView();
});

$("#btn-zoom-out").addEventListener("click", () => {
  interruptFocusViewTransition();
  const rect = viewport.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const worldX = (centerX - view.x) / view.zoom;
  const worldY = (centerY - view.y) / view.zoom;
  
  view.zoom = Math.max(0.04, view.zoom / 1.3);
  view.x = centerX - worldX * view.zoom;
  view.y = centerY - worldY * view.zoom;
  updateView();
});

$("#btn-reset-view").addEventListener("click", resetView);
$("#btn-add-card").addEventListener("click", addNewCard);
$("#btn-add-page").addEventListener("click", addNewPage);

$("#btn-add-image").addEventListener("click", () => {
  $("#image-loader").click();
});

$("#image-loader").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) {
    const rect = viewport.getBoundingClientRect();
    const worldCenter = screenToWorld(rect.width / 2, rect.height / 2);
    if (file.type.startsWith("image/")) {
      handleImageFile(file, worldCenter.x, worldCenter.y);
    } else if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {
      handleExcelFile(file, worldCenter.x, worldCenter.y);
    } else if (file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm")) {
      handleHtmlFile(file, worldCenter.x, worldCenter.y);
    }
  }
  event.target.value = ""; // clear input
});

viewport.addEventListener("dragover", event => {
  event.preventDefault();
});

viewport.addEventListener("drop", event => {
  event.preventDefault();
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    const worldPos = screenToWorld(event.clientX, event.clientY);
    if (file.type.startsWith("image/")) {
      handleImageFile(file, worldPos.x, worldPos.y);
    } else if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {
      handleExcelFile(file, worldPos.x, worldPos.y);
    } else if (file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm")) {
      handleHtmlFile(file, worldPos.x, worldPos.y);
    } else {
      showToast("支持导入图片、电子表格（XLSX/XLS）以及本地 HTML 组件", true);
    }
  }
});

// Double-click viewport to spawn a card at pointer position
viewport.addEventListener("dblclick", event => {
  if (event.target.closest(".card-item") || event.target.closest(".floating-toolbar")) return;
  const worldPos = screenToWorld(event.clientX, event.clientY);
  const card = createCard(
    "双击创建的想法",
    "可以在此处记录临时想法。支持拖动和内容实时修改。",
    Math.round(worldPos.x - 140),
    Math.round(worldPos.y - 100),
    "Idea"
  );
  enterCardFocus(card);
});

// Initialize with some default demo cards
function initDemo() {
  const vWidth = viewport.clientWidth || window.innerWidth;
  const vHeight = viewport.clientHeight || window.innerHeight;
  
  const cx = vWidth / 2;
  const cy = vHeight / 2;
  
  createCard(
    "欢迎来到自由画布 🎨", 
    "这是一套精简后的无限画布组件。所有外围的自包含侧边栏逻辑均已被剥离，现在只留下了纯粹的画布缩放、平移与网格特效。", 
    cx - 360, 
    cy - 240,
    "Welcome"
  );
  
  createCard(
    "控制方式 ⌨️", 
    "<b>画布平移：</b>直接左键按住画布空白处拖拽，或鼠标中键拖拽，或空格+左键拖拽。<br><b>画布缩放：</b>以鼠标指针为中心，滚动滚轮即可放大/缩小画布。", 
    cx + 40, 
    cy - 240,
    "Guide"
  );
  
  createCard(
    "动态交互与脑暴 💡", 
    "双击画布任意空白处，可以在该位置直接新建脑暴卡片！你可以自由修改卡片里的文本，并在画布上摆放它们。", 
    cx - 160, 
    cy + 40,
    "Tips"
  );

  createPageCard(
    cx - 600,
    cy + 340,
    "example.com"
  );

  // Set initial viewport translation
  view.zoom = 0.85; // slightly zoom out so all 4 items fit nicely
  view.x = 0;
  view.y = 0;
  
  updateView();
}

// Kick off
if (typeof loadCanvasState === "function" && loadCanvasState()) {
  // Loaded successfully
} else {
  initDemo();
}

// Collapsible Help Panel (Tips Panel)
(function() {
  const tipsPanel = document.getElementById("tips-panel");
  const tipsToggle = document.getElementById("tips-toggle");
  const tipsCloseBtn = document.getElementById("tips-close-btn");

  if (tipsPanel && tipsToggle && tipsCloseBtn) {
    tipsToggle.addEventListener("click", () => {
      tipsPanel.classList.remove("collapsed");
    });

    tipsCloseBtn.addEventListener("click", event => {
      event.stopPropagation(); // prevent triggering parent canvas handlers
      tipsPanel.classList.add("collapsed");
    });
  }
})();

// Collapsible Floating Toolbar
(function() {
  const toolbar = document.getElementById("floating-toolbar");
  const toggle = document.getElementById("toolbar-toggle");

  if (toolbar && toggle) {
    toggle.addEventListener("click", event => {
      event.stopPropagation(); // prevent triggering parent canvas handlers
      toolbar.classList.toggle("collapsed");
    });
  }
})();

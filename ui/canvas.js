// canvas.js
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

// Coordinate Conversion
function screenToWorld(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.zoom,
    y: (clientY - rect.top - view.y) / view.zoom
  };
}

// Reset/Fit View
var viewAnimation = null;

function cancelViewAnimation() {
  if (viewAnimation) {
    cancelAnimationFrame(viewAnimation);
    viewAnimation = null;
  }
}

function animateViewTo(targetX, targetY, targetZoom, onComplete = null) {
  cancelViewAnimation();
  
  const startTime = performance.now();
  const duration = 300; // 300ms smooth transition
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
    
    updateView();
    
    if (progress < 1) {
      viewAnimation = requestAnimationFrame(step);
    } else {
      viewAnimation = null;
      if (typeof onComplete === "function") {
        onComplete();
      }
    }
  }
  
  viewAnimation = requestAnimationFrame(step);
}

function updateView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
  scheduleDotGrid();
  scheduleVisibilityCheck(); // Debounced check for off-screen page hibernation
}

// Off-Screen Visibility Checking & Hibernation Logic
var visibilityTimeout = null;
function scheduleVisibilityCheck() {
  if (visibilityTimeout) clearTimeout(visibilityTimeout);
  visibilityTimeout = setTimeout(checkViewportVisibility, 500);
}

function checkViewportVisibility() {
  const vWidth = window.innerWidth;
  const vHeight = window.innerHeight;
  const buffer = 400; // 400px buffer zone to prevent rapid toggle flickering
  
  cardsList.forEach(card => {
    if (card.type !== "page") return;
    
    // Calculate card's current screen position based on canvas view matrix
    const screenLeft = view.x + card.x * view.zoom;
    const screenTop = view.y + card.y * view.zoom;
    const screenWidth = card.width * view.zoom;
    const screenHeight = card.height * view.zoom;
    
    const isVisible = (
      screenLeft + screenWidth >= -buffer &&
      screenLeft <= vWidth + buffer &&
      screenTop + screenHeight >= -buffer &&
      screenTop <= vHeight + buffer
    );
    
    const iframeWrapper = card.element.querySelector(".iframe-wrapper");
    const iframeEl = card.element.querySelector(".page-iframe");
    const hasIframe = !!iframeEl;
    
    // Don't hibernate if the card is currently focused
    if (focusedCard === card) {
      return;
    }
    
    if (!isVisible) {
      // Unload if loaded and not already hibernating
      if (hasIframe && !card.isHibernated && card.url) {
        const inputEl = card.element.querySelector(".page-input");
        if (inputEl) {
          card.url = inputEl.value.trim() || card.url;
        }
        
        iframeEl.src = "about:blank";
        iframeEl.remove();
        card.isHibernated = true;
        
        let sleepPlaceholder = card.element.querySelector(".iframe-sleep-placeholder");
        if (!sleepPlaceholder) {
          sleepPlaceholder = document.createElement("div");
          sleepPlaceholder.className = "iframe-sleep-placeholder";
          sleepPlaceholder.innerHTML = `
            <div class="sleep-inner">
              <span class="sleep-icon">😴</span>
              <span class="sleep-text">省电模式：网页已在后台挂起以释放内存</span>
            </div>
          `;
          iframeWrapper.appendChild(sleepPlaceholder);
        }
        console.log(`[Memory Saver] Hibernated card ID ${card.id} (${card.url})`);
      }
    } else {
      // Re-load if hibernating
      if (card.isHibernated && card.url) {
        const sleepPlaceholder = card.element.querySelector(".iframe-sleep-placeholder");
        if (sleepPlaceholder) {
          sleepPlaceholder.remove();
        }
        
        const newIframe = document.createElement("iframe");
        newIframe.className = "page-iframe";
        newIframe.referrerPolicy = "no-referrer";
        newIframe.src = card.url;
        
        // Re-apply subpixel antialiasing and contrast styles
        newIframe.style.webkitFontSmoothing = "subpixel-antialiased";
        newIframe.style.textRendering = "optimizeLegibility";
        newIframe.style.imageRendering = "-webkit-optimize-contrast";
        newIframe.style.backfaceVisibility = "hidden";
        newIframe.style.transform = "translateZ(0)";
        
        iframeWrapper.insertBefore(newIframe, iframeWrapper.firstChild);
        card.isHibernated = false;
        console.log(`[Memory Saver] Woke up card ID ${card.id} (${card.url})`);
      }
    }
  });
}

// Dot-Grid Rendering
function scheduleDotGrid() {
  if (gridFrame) return;
  gridFrame = requestAnimationFrame(() => {
    gridFrame = 0;
    const interactionActive = Boolean(panning || activeDragCard || activeResizeCard);
    const targetStrength = gridPointer.inside ? (interactionActive ? 0.2 : 1) : 0;
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

    drawDotGrid();

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

function drawDotGrid() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (dotGrid.width !== pixelWidth || dotGrid.height !== pixelHeight) {
    dotGrid.width = pixelWidth;
    dotGrid.height = pixelHeight;
  }
  
  const ctx = dotGrid.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  
  // Keep the number of visible dots stable at every zoom level. The world-grid
  // interval still follows zoom, but switches level before it becomes dense.
  let worldStep = 40;
  let size = worldStep * view.zoom;
  while (size < 32) {
    worldStep *= 2;
    size = worldStep * view.zoom;
  }
  while (size > 64) {
    worldStep /= 2;
    size = worldStep * view.zoom;
  }
  
  const startX = ((view.x % size) + size) % size;
  const startY = ((view.y % size) + size) % size;
  const baseRadius = 0.46;
  const hoverRadius = 140;
  const hoverRadiusSquared = hoverRadius * hoverRadius;
  const influencedDots = [];
  
  // Batch the quiet grid. Only the small local field needs individual drawing.
  ctx.beginPath();
  for (let y = startY; y < height; y += size) {
    for (let x = startX; x < width; x += size) {
      if (gridPointer.strength > 0.01) {
        const dx = x - gridPointer.visualX;
        const dy = y - gridPointer.visualY;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < hoverRadiusSquared) {
          const distance = Math.sqrt(distanceSquared);
          const distanceRatio = distance / hoverRadius;
          const proximity = 1 - distanceRatio;
          const easedProximity = proximity * proximity * (3 - 2 * proximity);
          const influence = easedProximity * gridPointer.strength;
          const displacement = 9 * influence;
          const directionX = distance > 0.01 ? dx / distance : 0;
          const directionY = distance > 0.01 ? dy / distance : 0;
          influencedDots.push({
            x: x + directionX * displacement,
            y: y + directionY * displacement,
            influence
          });
          continue;
        }
      }

      ctx.moveTo(x + baseRadius, y);
      ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = "rgba(190, 198, 210, 0.34)";
  ctx.fill();

  // The field is expressed mainly through displacement, not brightness.
  for (const dot of influencedDots) {
    const radius = baseRadius + 0.48 * dot.influence;
    const alpha = 0.22 + 0.4 * dot.influence;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(205, 214, 224, ${alpha})`;
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
  scheduleDotGrid();
});

// Canvas Viewport Events (Panning & Zooming)
viewport.addEventListener("wheel", event => {
  event.preventDefault();
  if (typeof cancelPendingFocusRestore === "function") {
    cancelPendingFocusRestore();
  }
  cancelViewAnimation();
  
  const rect = viewport.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  
  const worldX = (screenX - view.x) / view.zoom;
  const worldY = (screenY - view.y) / view.zoom;
  
  // Calculate next zoom using exponential step
  const next = Math.min(8, Math.max(0.04, view.zoom * Math.exp(-event.deltaY * 0.0012)));
  
  view.x = screenX - worldX * next;
  view.y = screenY - worldY * next;
  view.zoom = next;
  
  updateView();
}, { passive: false });

viewport.addEventListener("mousedown", event => {
  const interactive = event.target.closest(".card-item");
  
  // Focus does not lock canvas navigation. Empty space remains available
  // for panning; Escape is the only focus-exit shortcut.
  if (event.button === 1 || (event.button === 0 && (spaceDown || !interactive))) {
    event.preventDefault();
    if (typeof cancelPendingFocusRestore === "function") {
      cancelPendingFocusRestore();
    }
    cancelViewAnimation();
    panning = { x: event.clientX - view.x, y: event.clientY - view.y };
    viewport.style.cursor = "grabbing";
    viewport.classList.add("panning");
    setPageIframeInteractionShield(true);
  }
});

window.addEventListener("mousemove", event => {
  const rect = viewport.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
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
    view.x = event.clientX - panning.x;
    view.y = event.clientY - panning.y;
    updateView();
    return;
  }
  
  // Dragging card
  if (activeDragCard) {
    const worldMouse = screenToWorld(event.clientX, event.clientY);
    const cardId = parseInt(activeDragCard.dataset.id);
    const cardObj = cardsList.find(c => c.id === cardId);
    
    if (cardObj) {
      cardObj.x = worldMouse.x - cardDragOffset.x;
      cardObj.y = worldMouse.y - cardDragOffset.y;
      activeDragCard.style.left = `${cardObj.x}px`;
      activeDragCard.style.top = `${cardObj.y}px`;
      scheduleVisibilityCheck(); // check visibility during drag
    }
    return;
  }
  
  // Resizing card
  if (activeResizeCard && resizeDirection) {
    const cardId = parseInt(activeResizeCard.dataset.id);
    const cardObj = cardsList.find(c => c.id === cardId);
    
    if (cardObj) {
      const dx = (event.clientX - resizeStart.clientX) / view.zoom;
      const dy = (event.clientY - resizeStart.clientY) / view.zoom;
      
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
      scheduleVisibilityCheck(); // check visibility during resize
    }
  }
});

window.addEventListener("mouseup", () => {
  if (panning) {
    panning = null;
    viewport.style.cursor = spaceDown ? "grab" : "";
    viewport.classList.remove("panning");
  }
  
  if (activeDragCard) {
    activeDragCard.classList.remove("dragging");
    activeDragCard = null;
    viewport.classList.remove("dragging-card");
  }
  
  if (activeResizeCard) {
    activeResizeCard.classList.remove("resizing");
    activeResizeCard = null;
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
  if (typeof cancelPendingFocusRestore === "function") {
    cancelPendingFocusRestore();
  }
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
  if (typeof cancelPendingFocusRestore === "function") {
    cancelPendingFocusRestore();
  }
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
initDemo();

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

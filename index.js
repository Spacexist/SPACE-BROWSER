"use strict";

const $ = (selector, root = document) => root.querySelector(selector);

const viewport = $("#viewport");
const world = $("#world");
const dotGrid = $("#dot-grid");
const zoomLabel = $("#zoom-label");
const toast = $("#toast");

// Viewport state
let view = { x: 0, y: 0, zoom: 1 };
let gridFrame = 0;
const gridPointer = { x: -10000, y: -10000, inside: false };
let spaceDown = false;
let panning = null;

// Card dragging state
let activeDragCard = null;
let cardDragOffset = { x: 0, y: 0 };
let cardIdCounter = 0;
let cardsList = [];

// Card resizing state
let activeResizeCard = null;
let resizeDirection = null;
let resizeStart = { clientX: 0, clientY: 0, width: 0, height: 0, x: 0, y: 0 };

// Focus mode state
let hoveredCard = null;
let focusedPageCard = null;
let focusedNoteCard = null;
let preFocusView = null;

// Toast helpers
let toastTimer = 0;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = "toast";
  if (isError) toast.classList.add("error");
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
}

// Coordinate Conversion
function screenToWorld(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.zoom,
    y: (clientY - rect.top - view.y) / view.zoom
  };
}

// Reset/Fit View
let viewAnimation = null;

function cancelViewAnimation() {
  if (viewAnimation) {
    cancelAnimationFrame(viewAnimation);
    viewAnimation = null;
  }
}

function animateViewTo(targetX, targetY, targetZoom) {
  cancelViewAnimation();
  
  const startTime = performance.now();
  const duration = 300; // 300ms smooth transition
  const startX = view.x;
  const startY = view.y;
  const startZoom = view.zoom;
  
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    // Cubic-out easing
    const ease = 1 - Math.pow(1 - progress, 3);
    
    view.x = startX + (targetX - startX) * ease;
    view.y = startY + (targetY - startY) * ease;
    view.zoom = startZoom + (targetZoom - startZoom) * ease;
    
    updateView();
    
    if (progress < 1) {
      viewAnimation = requestAnimationFrame(step);
    } else {
      viewAnimation = null;
    }
  }
  
  viewAnimation = requestAnimationFrame(step);
}

function focusCard(card, silent = false) {
  const vWidth = viewport.clientWidth;
  const vHeight = viewport.clientHeight;
  if (!vWidth || !vHeight) return;

  const cardWidth = card.width || (card.element ? card.element.offsetWidth : (card.type === "page" ? 1200 : 300));
  const cardHeight = card.height || (card.element ? card.element.offsetHeight : (card.type === "page" ? 800 : 220));
  
  const padding = card.type === "page" ? 30 : 100; // Note cards have larger padding so they don't blow up full screen
  const zoomX = (vWidth - padding * 2) / cardWidth;
  const zoomY = (vHeight - padding * 2) / cardHeight;
  
  // Cap max zoom to 2.5 for page cards, 1.2 for note cards (to prevent blurriness)
  const maxZoomLimit = card.type === "page" ? 2.5 : 1.2;
  const targetZoom = Math.min(maxZoomLimit, Math.max(0.1, Math.min(zoomX, zoomY)));
  
  const cardCenterX = card.x + cardWidth / 2;
  const cardCenterY = card.y + cardHeight / 2;
  
  const targetX = vWidth / 2 - cardCenterX * targetZoom;
  const targetY = vHeight / 2 - cardCenterY * targetZoom;
  
  animateViewTo(targetX, targetY, targetZoom);
  if (!silent) {
    showToast(`已聚焦至目标卡片 (${Math.round(targetZoom * 100)}%)`);
  }
}

function enterBrowserMode(card) {
  if (!card || card.type !== "page") return;
  
  if (focusedPageCard && focusedPageCard !== card) {
    exitBrowserMode();
  }
  if (focusedNoteCard) {
    exitNoteFocus();
  }
  
  // Save pre-focus view state
  if (!preFocusView) {
    preFocusView = { x: view.x, y: view.y, zoom: view.zoom };
  }
  
  focusedPageCard = card;
  card.element.classList.add("interactive");
  
  const inputEl = card.element.querySelector(".page-input");
  const loadBtn = card.element.querySelector(".page-btn-load");
  if (inputEl) inputEl.disabled = false;
  if (loadBtn) loadBtn.disabled = false;
  
  const indicatorEl = card.element.querySelector(".page-mode-indicator");
  if (indicatorEl) {
    indicatorEl.textContent = "● 浏览器模式 (Esc 退出)";
  }
  
  focusCard(card, true);
  showToast("已开启浏览器模式，网页及输入已解锁。按下 Esc 退出。");
}

function exitBrowserMode() {
  if (!focusedPageCard) return;
  
  const card = focusedPageCard;
  card.element.classList.remove("interactive");
  
  const inputEl = card.element.querySelector(".page-input");
  const loadBtn = card.element.querySelector(".page-btn-load");
  if (inputEl) inputEl.disabled = true;
  if (loadBtn) loadBtn.disabled = true;
  
  const indicatorEl = card.element.querySelector(".page-mode-indicator");
  if (indicatorEl) {
    indicatorEl.textContent = "[F] 浏览器模式";
  }
  
  focusedPageCard = null;
  
  if (document.activeElement) {
    document.activeElement.blur();
  }
  window.focus();
  
  // Restore view
  if (preFocusView) {
    animateViewTo(preFocusView.x, preFocusView.y, preFocusView.zoom);
    preFocusView = null;
  }
  
  showToast("已退出浏览器模式，画布锁回只读拖动状态。");
}

function enterNoteFocus(card) {
  if (focusedPageCard) {
    exitBrowserMode();
  }
  if (focusedNoteCard && focusedNoteCard !== card) {
    exitNoteFocus();
  }
  
  // Save pre-focus view state
  if (!preFocusView) {
    preFocusView = { x: view.x, y: view.y, zoom: view.zoom };
  }
  
  focusedNoteCard = card;
  card.element.classList.add("focused-note");
  focusCard(card, true);
  showToast("已聚焦至便签卡片。按下 Esc 退出。");
}

function exitNoteFocus() {
  if (!focusedNoteCard) return;
  
  const card = focusedNoteCard;
  card.element.classList.remove("focused-note");
  focusedNoteCard = null;
  
  if (document.activeElement) {
    document.activeElement.blur();
  }
  window.focus();
  
  // Restore view
  if (preFocusView) {
    animateViewTo(preFocusView.x, preFocusView.y, preFocusView.zoom);
    preFocusView = null;
  }
  
  showToast("已退出便签卡片聚焦。");
}

function resetView() {
  const vWidth = viewport.clientWidth;
  const vHeight = viewport.clientHeight;
  
  let targetX, targetY, targetZoom;
  
  if (cardsList.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    cardsList.forEach(card => {
      minX = Math.min(minX, card.x);
      minY = Math.min(minY, card.y);
      const w = card.width || 280;
      const h = card.height || 200;
      maxX = Math.max(maxX, card.x + w);
      maxY = Math.max(maxY, card.y + h);
    });
    
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    
    const padding = 60;
    const zoomX = (vWidth - padding * 2) / contentWidth;
    const zoomY = (vHeight - padding * 2) / contentHeight;
    targetZoom = Math.min(1.2, Math.max(0.3, Math.min(zoomX, zoomY)));
    
    targetX = (vWidth - contentWidth * targetZoom) / 2 - minX * targetZoom;
    targetY = (vHeight - contentHeight * targetZoom) / 2 - minY * targetZoom;
  } else {
    targetZoom = 1;
    targetX = vWidth / 2;
    targetY = vHeight / 2;
  }
  
  animateViewTo(targetX, targetY, targetZoom);
  showToast("已重置画布视角");
}

function updateView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
  scheduleDotGrid();
}

// Dot-Grid Rendering
function scheduleDotGrid() {
  if (gridFrame) return;
  gridFrame = requestAnimationFrame(() => {
    gridFrame = 0;
    drawDotGrid();
  });
}

function drawDotGrid() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  
  if (dotGrid.width !== pixelWidth || dotGrid.height !== pixelHeight) {
    dotGrid.width = pixelWidth;
    dotGrid.height = pixelHeight;
  }
  
  const ctx = dotGrid.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  
  // Calculate dynamic steps based on zoom level
  let worldStep = 40;
  while (worldStep * view.zoom < 18) worldStep *= 5;
  while (worldStep * view.zoom > 100) worldStep /= 5;
  
  const step = worldStep * view.zoom;
  const startX = ((view.x % step) + step) % step;
  const startY = ((view.y % step) + step) % step;
  
  const halfLife = 80;
  const baseRadius = 1.05;
  const magnify = 4.8;
  
  for (let y = startY; y <= height + step; y += step) {
    for (let x = startX; x <= width + step; x += step) {
      const distance = gridPointer.inside
        ? Math.hypot(x - gridPointer.x, y - gridPointer.y)
        : 10000;
      
      const influence = gridPointer.inside ? Math.pow(0.5, distance / halfLife) : 0;
      const radius = baseRadius + magnify * influence;
      
      // Clean flat monochromatic dot grid
      const grey = Math.round(64 + (120 - 64) * influence);
      const alpha = 0.28 + 0.42 * influence;
      
      ctx.fillStyle = `rgba(${grey}, ${grey}, ${grey}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Canvas Panning and Zooming Interaction
viewport.addEventListener("pointermove", event => {
  const rect = viewport.getBoundingClientRect();
  gridPointer.x = event.clientX - rect.left;
  gridPointer.y = event.clientY - rect.top;
  gridPointer.inside = true;
  scheduleDotGrid();
});

viewport.addEventListener("pointerleave", () => {
  gridPointer.inside = false;
  scheduleDotGrid();
});

viewport.addEventListener("wheel", event => {
  event.preventDefault();
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
  
  // Exit browser mode or note focus if clicking outside the currently focused card
  if (focusedPageCard && event.target.closest(".card-item") !== focusedPageCard.element && !event.target.closest(".floating-toolbar")) {
    exitBrowserMode();
  }
  if (focusedNoteCard && event.target.closest(".card-item") !== focusedNoteCard.element && !event.target.closest(".floating-toolbar")) {
    exitNoteFocus();
  }
  
  // Pan canvas on middle-click, or left-click when space is down or clicking background
  if (event.button === 1 || (event.button === 0 && (spaceDown || !interactive))) {
    event.preventDefault();
    cancelViewAnimation();
    panning = { x: event.clientX - view.x, y: event.clientY - view.y };
    viewport.style.cursor = "grabbing";
    viewport.classList.add("panning");
  }
});

window.addEventListener("mousemove", event => {
  if (panning) {
    view.x = event.clientX - panning.x;
    view.y = event.clientY - panning.y;
    updateView();
  }
  
  if (activeDragCard) {
    const worldMouse = screenToWorld(event.clientX, event.clientY);
    const cardId = activeDragCard.dataset.id;
    const card = cardsList.find(c => c.id == cardId);
    
    if (card) {
      card.x = worldMouse.x - cardDragOffset.x;
      card.y = worldMouse.y - cardDragOffset.y;
      activeDragCard.style.left = `${card.x}px`;
      activeDragCard.style.top = `${card.y}px`;
    }
  }
  
  if (activeResizeCard) {
    const dx = (event.clientX - resizeStart.clientX) / view.zoom;
    const dy = (event.clientY - resizeStart.clientY) / view.zoom;
    const cardId = activeResizeCard.dataset.id;
    const card = cardsList.find(c => c.id == cardId);
    
    if (card) {
      const minWidth = 320;
      const minHeight = 240;
      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      let newX = resizeStart.x;
      let newY = resizeStart.y;
      
      switch (resizeDirection) {
        case 'br':
          newWidth = Math.max(minWidth, resizeStart.width + dx);
          newHeight = Math.max(minHeight, resizeStart.height + dy);
          break;
        case 'bl':
          let wValL = resizeStart.width - dx;
          if (wValL < minWidth) {
            newWidth = minWidth;
            newX = resizeStart.x + (resizeStart.width - minWidth);
          } else {
            newWidth = wValL;
            newX = resizeStart.x + dx;
          }
          newHeight = Math.max(minHeight, resizeStart.height + dy);
          break;
        case 'tr':
          newWidth = Math.max(minWidth, resizeStart.width + dx);
          let hValT = resizeStart.height - dy;
          if (hValT < minHeight) {
            newHeight = minHeight;
            newY = resizeStart.y + (resizeStart.height - minHeight);
          } else {
            newHeight = hValT;
            newY = resizeStart.y + dy;
          }
          break;
        case 'tl':
          let wValTL = resizeStart.width - dx;
          if (wValTL < minWidth) {
            newWidth = minWidth;
            newX = resizeStart.x + (resizeStart.width - minWidth);
          } else {
            newWidth = wValTL;
            newX = resizeStart.x + dx;
          }
          let hValTL = resizeStart.height - dy;
          if (hValTL < minHeight) {
            newHeight = minHeight;
            newY = resizeStart.y + (resizeStart.height - minHeight);
          } else {
            newHeight = hValTL;
            newY = resizeStart.y + dy;
          }
          break;
      }
      
      card.width = newWidth;
      card.height = newHeight;
      card.x = newX;
      card.y = newY;
      
      activeResizeCard.style.width = `${newWidth}px`;
      activeResizeCard.style.height = `${newHeight}px`;
      activeResizeCard.style.left = `${newX}px`;
      activeResizeCard.style.top = `${newY}px`;
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
});

window.addEventListener("keydown", event => {
  const isInputActive = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;

  if (event.code === "Space" && !isInputActive) {
    spaceDown = true;
    event.preventDefault();
    viewport.style.cursor = "grab";
  }

  // F Key to ENTER browser mode or focus standard note card (Strictly Enter Only, no toggling)
  if ((event.key === "f" || event.key === "F") && !isInputActive) {
    if (hoveredCard) {
      if (hoveredCard.type === "page") {
        if (focusedPageCard !== hoveredCard) {
          event.preventDefault();
          enterBrowserMode(hoveredCard);
        }
      } else {
        // Standard note card (tips)
        if (focusedNoteCard !== hoveredCard) {
          event.preventDefault();
          enterNoteFocus(hoveredCard);
        }
      }
    }
  }

  // Escape Key to EXIT browser mode or note focus (Strictly Exit Only)
  if (event.key === "Escape") {
    if (focusedPageCard) {
      event.preventDefault();
      exitBrowserMode();
    } else if (focusedNoteCard) {
      event.preventDefault();
      exitNoteFocus();
    }
  }
});

window.addEventListener("keyup", event => {
  if (event.code === "Space") {
    spaceDown = false;
    if (!panning) viewport.style.cursor = "";
  }
});

window.addEventListener("blur", () => {
  spaceDown = false;
  panning = null;
  viewport.style.cursor = "";
  viewport.classList.remove("panning");
  
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
});

window.addEventListener("resize", () => {
  scheduleDotGrid();
});

window.addEventListener("message", event => {
  if (event.data && event.data.source === "SPACE_PAGE_NAVIGATED") {
    const iframeSrc = event.data.url;
    const sender = event.source;
    
    // Find the card where iframeEl.contentWindow === sender
    const card = cardsList.find(c => {
      if (c.type !== "page") return false;
      const iframeEl = c.element.querySelector(".page-iframe");
      return iframeEl && iframeEl.contentWindow === sender;
    });
    
    if (card) {
      // Update address bar value dynamically
      const inputEl = card.element.querySelector(".page-input");
      if (inputEl && document.activeElement !== inputEl) {
        inputEl.value = iframeSrc;
      }
      card.url = iframeSrc;
      
      // Initialize history if missing
      if (!card.history) {
        card.history = [];
        card.historyIndex = -1;
      }
      
      // Synchronize history index or push new state
      const existingIndex = card.history.indexOf(iframeSrc);
      if (existingIndex !== -1) {
        card.historyIndex = existingIndex;
      } else {
        // Truncate any forward history and push new URL
        card.history = card.history.slice(0, card.historyIndex + 1);
        card.history.push(iframeSrc);
        card.historyIndex = card.history.length - 1;
      }
      
      // Update UI state of Back button
      const backBtn = card.element.querySelector(".page-btn-back");
      if (backBtn) {
        backBtn.disabled = card.historyIndex <= 0;
      }
    }
  }
});

// Draggable Cards Layering & Interaction Management
let maxZIndex = 10;
function bringToFront(cardElement) {
  maxZIndex += 1;
  cardElement.style.zIndex = maxZIndex;
}

// Helper to enable Card dragging via bottom iPhone drag bar
function enableCardDragging(cardObj) {
  const cardElement = cardObj.element;
  let dragHandle = cardElement.querySelector(".page-drag-handle-wrapper");
  if (!dragHandle) {
    dragHandle = document.createElement("div");
    dragHandle.className = "page-drag-handle-wrapper";
    dragHandle.title = "按住此条拖拽移动卡片";
    dragHandle.innerHTML = `<div class="page-drag-bar"></div>`;
    cardElement.appendChild(dragHandle);
  }
  
  dragHandle.addEventListener("mousedown", event => {
    if (event.button !== 0) return; // only left click
    event.stopPropagation();
    
    activeDragCard = cardElement;
    cardElement.classList.add("dragging");
    viewport.classList.add("dragging-card");
    
    // Bring card to front without re-appending DOM (prevents iframe reloads!)
    bringToFront(cardElement);
    
    const worldMouse = screenToWorld(event.clientX, event.clientY);
    cardDragOffset = {
      x: worldMouse.x - cardObj.x,
      y: worldMouse.y - cardObj.y
    };
  });
}

// Helper to enable Card resizing via four corner white arcs
function enableCardResizing(cardObj) {
  const cardElement = cardObj.element;
  const handleDirections = ['tl', 'tr', 'bl', 'br'];
  
  handleDirections.forEach(dir => {
    const handle = document.createElement("div");
    handle.className = `resize-handle resize-${dir}`;
    cardElement.appendChild(handle);
    
    handle.addEventListener("mousedown", event => {
      if (event.button !== 0) return; // only left click
      event.stopPropagation();
      event.preventDefault();
      
      activeResizeCard = cardElement;
      resizeDirection = dir;
      
      // Bring card to front on resize start
      bringToFront(cardElement);
      
      const currentWidth = parseFloat(cardElement.style.width) || cardObj.width || cardElement.offsetWidth;
      const currentHeight = parseFloat(cardElement.style.height) || cardObj.height || cardElement.offsetHeight;
      const currentX = parseFloat(cardElement.style.left) || cardObj.x;
      const currentY = parseFloat(cardElement.style.top) || cardObj.y;
      
      resizeStart = {
        clientX: event.clientX,
        clientY: event.clientY,
        width: currentWidth,
        height: currentHeight,
        x: currentX,
        y: currentY
      };
      
      cardElement.classList.add("resizing");
      viewport.classList.add("dragging-card");
    });
  });
}

function createCard(title, content, x = 0, y = 0, tag = "Note") {
  cardIdCounter += 1;
  const id = cardIdCounter;
  
  const width = 320;
  const height = 240;
  
  const cardElement = document.createElement("div");
  cardElement.className = "card-item note-card";
  cardElement.dataset.id = id;
  cardElement.style.left = `${x}px`;
  cardElement.style.top = `${y}px`;
  cardElement.style.width = `${width}px`;
  cardElement.style.height = `${height}px`;
  
  cardElement.innerHTML = `
    <div class="card-header">
      <span class="card-tag">${tag}</span>
      <button class="card-close" title="删除卡片">×</button>
    </div>
    <h3 contenteditable="true" spellcheck="false" placeholder="卡片标题">${title}</h3>
    <p contenteditable="true" spellcheck="false" placeholder="在此输入卡片内容...">${content}</p>
  `;
  
  const cardObj = { id, type: "note", title, content, x, y, width, height, element: cardElement };
  
  cardElement.addEventListener("mouseenter", () => {
    hoveredCard = cardObj;
  });
  
  cardElement.addEventListener("mouseleave", () => {
    if (hoveredCard === cardObj) hoveredCard = null;
  });
  
  cardElement.addEventListener("mousedown", () => {
    bringToFront(cardElement);
  });
  
  enableCardDragging(cardObj);
  enableCardResizing(cardObj);
  
  cardElement.querySelector(".card-close").addEventListener("click", () => {
    cardElement.style.transform = "scale(0.8)";
    cardElement.style.opacity = "0";
    setTimeout(() => {
      cardElement.remove();
      cardsList = cardsList.filter(c => c.id !== id);
    }, 200);
  });
  
  cardElement.addEventListener("mouseup", () => {
    cardObj.x = parseFloat(cardElement.style.left);
    cardObj.y = parseFloat(cardElement.style.top);
  });
  
  const titleEl = cardElement.querySelector("h3");
  const contentEl = cardElement.querySelector("p");
  
  titleEl.addEventListener("blur", () => {
    cardObj.title = titleEl.textContent;
  });
  
  contentEl.addEventListener("blur", () => {
    cardObj.content = contentEl.textContent;
  });

  world.appendChild(cardElement);
  cardsList.push(cardObj);
  
  bringToFront(cardElement);
  
  return cardObj;
}

// Add New Card Action
function addNewCard() {
  // Spawn card at viewport center translated to world space
  const rect = viewport.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const worldCenter = screenToWorld(centerX, centerY);
  
  const card = createCard(
    "新脑暴想法", 
    "双击可以直接编辑此处的文本内容。长按卡片空白处拖拽即可改变它们在无限画布里的位置。", 
    Math.round(worldCenter.x - 140), 
    Math.round(worldCenter.y - 100),
    "Brainstorm"
  );
  
  animateCardEntrance(card.element);
  showToast("已在画布中心添加新卡片");
}

function animateCardEntrance(element) {
  element.style.transform = "scale(0.8) translateY(20px)";
  element.style.opacity = "0";
  element.style.transition = "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
  
  requestAnimationFrame(() => {
    element.style.transform = "";
    element.style.opacity = "";
    setTimeout(() => {
      element.style.transition = "border-color 0.25s, box-shadow 0.25s, transform 0.2s";
    }, 300);
  });
}

// Create Draggable Page Card (Iframe Embed)
function createPageCard(x = 0, y = 0, initialUrl = "", displayName = "") {
  cardIdCounter += 1;
  const id = cardIdCounter;
  
  const width = 1200;
  const height = 800;
  
  const cardElement = document.createElement("div");
  cardElement.className = "card-item page-card";
  cardElement.dataset.id = id;
  cardElement.style.left = `${x}px`;
  cardElement.style.top = `${y}px`;
  cardElement.style.width = `${width}px`;
  cardElement.style.height = `${height}px`;
  
  const displayVal = displayName || initialUrl;
  
  cardElement.innerHTML = `
    <div class="page-header-row">
      <span class="card-tag">Page</span>
      <button class="page-nav-btn page-btn-back" title="后退" disabled>←</button>
      <button class="page-nav-btn page-btn-refresh" title="刷新">↻</button>
      <input type="text" class="page-input" placeholder="输入网址 (如 example.com) 或拖入本地 HTML" value="${displayVal}">
      <button class="page-btn page-btn-load" title="载入网页">Go</button>
      <span class="page-mode-indicator">[F] 浏览器模式</span>
      <button class="card-close" title="删除卡片">×</button>
    </div>
    <div class="iframe-wrapper">
      <div class="iframe-empty">
        <span>🌐 请在上方输入网址并点击 <b>Go</b>。</span>
        <span style="font-size: 11px; opacity: 0.6; margin-top: 4px;">
          注：推荐使用本地 HTML 组件、图片与表格。
        </span>
      </div>
      <div class="iframe-cover">
        <div class="iframe-freeze-indicator">
          <span>🔒 按下 F 键 解冻组件</span>
        </div>
      </div>
    </div>
  `;
  
  const inputEl = cardElement.querySelector(".page-input");
  const loadBtn = cardElement.querySelector(".page-btn-load");
  const backBtn = cardElement.querySelector(".page-btn-back");
  const refreshBtn = cardElement.querySelector(".page-btn-refresh");
  const wrapperEl = cardElement.querySelector(".iframe-wrapper");
  const emptyEl = cardElement.querySelector(".iframe-empty");
  let iframeEl = null;
  
  if (displayName && initialUrl) {
    inputEl.dataset.actualUrl = initialUrl;
  }
  
  // Start locked: disable address bar inputs by default
  inputEl.disabled = true;
  loadBtn.disabled = true;
  
  const cardObj = { 
    id, 
    type: "page", 
    url: initialUrl, 
    x, 
    y, 
    width, 
    height, 
    element: cardElement,
    history: initialUrl ? [initialUrl] : [],
    historyIndex: initialUrl ? 0 : -1
  };
  
  cardElement.addEventListener("mouseenter", () => {
    hoveredCard = cardObj;
  });
  
  cardElement.addEventListener("mouseleave", () => {
    if (hoveredCard === cardObj) hoveredCard = null;
  });
  
  cardElement.addEventListener("mousedown", () => {
    bringToFront(cardElement);
  });
  
  // Wire up back & refresh buttons
  backBtn.addEventListener("click", () => {
    if (iframeEl && cardObj.historyIndex > 0) {
      iframeEl.contentWindow.postMessage({ source: "SPACE_PAGE_CONTROL", action: "back" }, "*");
    }
  });

  refreshBtn.addEventListener("click", () => {
    if (iframeEl) {
      iframeEl.contentWindow.postMessage({ source: "SPACE_PAGE_CONTROL", action: "refresh" }, "*");
    }
  });
  
  // Abstracted helpers
  enableCardDragging(cardObj);
  enableCardResizing(cardObj);
  
  function loadUrl() {
    let url = inputEl.dataset.actualUrl || inputEl.value.trim();
    if (!url) {
      showToast("请输入网址或本地路径", true);
      return;
    }
    
    // Reset history stack for new manual root navigation
    cardObj.history = [];
    cardObj.historyIndex = -1;
    if (backBtn) backBtn.disabled = true;
    
    const isBlobUrl = /^blob:/i.test(url);
    let isLocalFile = false;
    if (!isBlobUrl && (/^file:\/\/\//i.test(url) || /^[a-zA-Z]:[\\\/]/i.test(url))) {
      isLocalFile = true;
    }
    
    const isExcelFile = url.toLowerCase().endsWith('.xlsx') || url.toLowerCase().endsWith('.xls') || url.includes('.xlsx?') || url.includes('.xls?');
    
    if (!isLocalFile && !isBlobUrl && !/^https?:\/\//i.test(url)) {
      url = "https://" + url;
      inputEl.value = url;
    }
    
    if (iframeEl) iframeEl.remove();
    cardElement.classList.remove("has-iframe");
    
    // Clear any existing excel container in the page card
    let oldExcel = wrapperEl.querySelector(".page-excel-container");
    if (oldExcel) oldExcel.remove();
    
    if (isExcelFile) {
      emptyEl.style.display = "none";
      
      if (isLocalFile) {
        showToast("受浏览器安全限制，请直接将 Excel 拖入画布中导入！", true);
        return;
      }
      
      showToast("正在读取并解析电子表格...");
      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error("无法读取表格文件，请确认网络连接！");
          return res.arrayBuffer();
        })
        .then(ab => {
          const data = new Uint8Array(ab);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const html = XLSX.utils.sheet_to_html(worksheet);
          
          const sheetContainer = document.createElement("div");
          sheetContainer.className = "page-excel-container";
          sheetContainer.innerHTML = html;
          wrapperEl.insertBefore(sheetContainer, wrapperEl.firstChild);
          
          showToast(`工作表 [${sheetName}] 解析并渲染成功！`);
        })
        .catch(err => {
          showToast(err.message, true);
        });
    } else {
      iframeEl = document.createElement("iframe");
      iframeEl.className = "page-iframe";
      iframeEl.referrerPolicy = "no-referrer";
      
      let targetUrl = url;
      if (isLocalFile) {
        targetUrl = url;
        if (/^[a-zA-Z]:[\\\/]/i.test(url)) {
          targetUrl = "file:///" + url.replace(/\\/g, '/');
        }
      }
      iframeEl.src = targetUrl;
      
      emptyEl.style.display = "none";
      wrapperEl.insertBefore(iframeEl, wrapperEl.firstChild);
      
      // Activate freeze mask once iframe is loaded
      cardElement.classList.add("has-iframe");
      
      showToast(isLocalFile ? "正在加载本地文件..." : "正在尝试载入网页...");
      iframeEl.addEventListener("load", () => {
        showToast(isLocalFile ? "本地文件已载入" : "网页已载入");
      }, { once: true });
      iframeEl.addEventListener("error", () => {
        emptyEl.textContent = "网页载入失败，请确认网址可正常访问。";
        emptyEl.style.display = "";
        showToast("网页载入失败", true);
      }, { once: true });
    }
    
    cardObj.url = url;
  }
  
  loadBtn.addEventListener("click", loadUrl);
  
  inputEl.addEventListener("input", () => {
    delete inputEl.dataset.actualUrl;
  });

  inputEl.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      loadUrl();
    }
    // Prevent space key from triggering canvas grab when typing inside input
    event.stopPropagation();
  });
  
  cardElement.querySelector(".card-close").addEventListener("click", () => {
    cardElement.style.transform = "scale(0.8)";
    cardElement.style.opacity = "0";
    setTimeout(() => {
      // Clean up Blob URLs from memory on close
      if (cardObj.url && cardObj.url.startsWith("blob:")) {
        URL.revokeObjectURL(cardObj.url);
      }
      cardElement.remove();
      cardsList = cardsList.filter(c => c.id !== id);
    }, 200);
  });
  
  cardElement.addEventListener("mouseup", () => {
    cardObj.x = parseFloat(cardElement.style.left);
    cardObj.y = parseFloat(cardElement.style.top);
  });

  world.appendChild(cardElement);
  cardsList.push(cardObj);
  
  bringToFront(cardElement);
  
  if (initialUrl) {
    loadUrl();
  }
  
  return cardObj;
}

function createImageCard(src, x = 0, y = 0, width = 400, height = 300) {
  cardIdCounter += 1;
  const id = cardIdCounter;
  
  const cardElement = document.createElement("div");
  cardElement.className = "card-item image-card";
  cardElement.dataset.id = id;
  cardElement.style.left = `${x}px`;
  cardElement.style.top = `${y}px`;
  cardElement.style.width = `${width}px`;
  cardElement.style.height = `${height}px`;
  
  cardElement.innerHTML = `
    <div class="card-header">
      <span class="card-tag">Image</span>
      <button class="card-close" title="删除图片">×</button>
    </div>
    <div class="image-wrapper">
      <img class="card-image" src="${src}" alt="loaded image">
    </div>
  `;
  
  const cardObj = { id, type: "image", src, x, y, width, height, element: cardElement };
  
  cardElement.addEventListener("mouseenter", () => {
    hoveredCard = cardObj;
  });
  
  cardElement.addEventListener("mouseleave", () => {
    if (hoveredCard === cardObj) hoveredCard = null;
  });
  
  cardElement.addEventListener("mousedown", () => {
    bringToFront(cardElement);
  });
  
  // Abstracted helpers
  enableCardDragging(cardObj);
  enableCardResizing(cardObj);
  
  cardElement.querySelector(".card-close").addEventListener("click", () => {
    cardElement.style.transform = "scale(0.8)";
    cardElement.style.opacity = "0";
    setTimeout(() => {
      cardElement.remove();
      cardsList = cardsList.filter(c => c.id !== id);
    }, 200);
  });
  
  cardElement.addEventListener("mouseup", () => {
    cardObj.x = parseFloat(cardElement.style.left);
    cardObj.y = parseFloat(cardElement.style.top);
  });

  world.appendChild(cardElement);
  cardsList.push(cardObj);
  
  bringToFront(cardElement);
  
  return cardObj;
}

function handleImageFile(file, x, y) {
  const reader = new FileReader();
  reader.onload = event => {
    const src = event.target.result;
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || 400;
      let h = img.naturalHeight || 300;
      
      const maxDim = 400;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      
      const card = createImageCard(src, x - w / 2, y - h / 2, w, h);
      animateCardEntrance(card.element);
      showToast("已成功导入图片");
    };
    img.src = src;
  };
  reader.readAsDataURL(file);
}

function handleHtmlFile(file, x, y) {
  const reader = new FileReader();
  reader.onload = event => {
    const htmlText = event.target.result;
    const blob = new Blob([htmlText], { type: 'text/html; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const card = createPageCard(x - 600, y - 400, blobUrl, file.name);
    animateCardEntrance(card.element);
    showToast(`本地 HTML 组件 [${file.name}] 已成功载入！`);
  };
  reader.readAsText(file);
}

function createExcelCard(sheetName, html, x = 0, y = 0, width = 600, height = 400) {
  cardIdCounter += 1;
  const id = cardIdCounter;
  
  const cardElement = document.createElement("div");
  cardElement.className = "card-item excel-card";
  cardElement.dataset.id = id;
  cardElement.style.left = `${x}px`;
  cardElement.style.top = `${y}px`;
  cardElement.style.width = `${width}px`;
  cardElement.style.height = `${height}px`;
  
  cardElement.innerHTML = `
    <div class="card-header">
      <span class="card-tag">Excel</span>
      <span class="excel-sheet-name">${sheetName}</span>
      <button class="card-close" title="删除">×</button>
    </div>
    <div class="excel-wrapper">
      <div class="excel-table-container">
        ${html}
      </div>
    </div>
  `;
  
  const cardObj = { id, type: "excel", sheetName, html, x, y, width, height, element: cardElement };
  
  cardElement.addEventListener("mouseenter", () => {
    hoveredCard = cardObj;
  });
  
  cardElement.addEventListener("mouseleave", () => {
    if (hoveredCard === cardObj) hoveredCard = null;
  });
  
  cardElement.addEventListener("mousedown", () => {
    bringToFront(cardElement);
  });
  
  // Abstracted helpers
  enableCardDragging(cardObj);
  enableCardResizing(cardObj);
  
  cardElement.querySelector(".card-close").addEventListener("click", () => {
    cardElement.style.transform = "scale(0.8)";
    cardElement.style.opacity = "0";
    setTimeout(() => {
      cardElement.remove();
      cardsList = cardsList.filter(c => c.id !== id);
    }, 200);
  });
  
  cardElement.addEventListener("mouseup", () => {
    cardObj.x = parseFloat(cardElement.style.left);
    cardObj.y = parseFloat(cardElement.style.top);
  });

  world.appendChild(cardElement);
  cardsList.push(cardObj);
  
  bringToFront(cardElement);
  
  return cardObj;
}

function handleExcelFile(file, x, y) {
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const html = XLSX.utils.sheet_to_html(worksheet);
      
      const card = createExcelCard(sheetName, html, x - 300, y - 200, 600, 400);
      animateCardEntrance(card.element);
      showToast(`电子表格 [${sheetName}] 导入成功`);
    } catch (err) {
      showToast("表格解析失败: " + err.message, true);
    }
  };
  reader.readAsArrayBuffer(file);
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
  showToast("已在画布中心添加网页卡片");
}

// Toolbar controls hookups
$("#btn-zoom-in").addEventListener("click", () => {
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
  createCard(
    "双击创建的想法",
    "可以在此处记录临时想法。支持拖动和内容实时修改。",
    Math.round(worldPos.x - 140),
    Math.round(worldPos.y - 100),
    "Idea"
  );
  showToast("已在此处创建新卡片");
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

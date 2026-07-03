// card/cards.js
// Dedicated Module for Card Creation, Loader Helpers, Dragging and Resizing Systems

// Globals shared across scripts
var cardIdCounter = 0;
var cardsList = [];

var activeDragCard = null;
var activeDragCardData = null;
var cardDragOffset = { x: 0, y: 0 };

var activeResizeCard = null;
var activeResizeCardData = null;
var resizeDirection = null;
var resizeStart = { clientX: 0, clientY: 0, width: 0, height: 0, x: 0, y: 0 };
var maxZIndex = 10;

function bringToFront(cardElement) {
  maxZIndex += 1;
  cardElement.style.zIndex = maxZIndex;
}

function removeCard(card, onRemove = null) {
  releaseCardFromFocusManager(card);

  card.element.style.transform = "scale(0.8)";
  card.element.style.opacity = "0";
  setTimeout(() => {
    if (typeof onRemove === "function") onRemove();
    card.element.remove();
    cardsList = cardsList.filter(item => item !== card);
  }, 200);
}

function mountCard(card, options = {}) {
  const cardElement = card.element;
  registerFocusableCard(card);

  cardElement.addEventListener("mousedown", () => {
    bringToFront(cardElement);
  });
  cardElement.querySelector(".card-close").addEventListener("click", event => {
    event.stopPropagation();
    removeCard(card, options.onRemove);
  });

  enableCardDragging(card);
  enableCardResizing(card);
  world.appendChild(cardElement);
  cardsList.push(card);
  bringToFront(cardElement);
}

// Entrance zoom and slide animation for newly created cards
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

// 1. Create standard Note card (Ideas/Brainstorming)
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
      <div class="header-left">
        <span class="page-mode-indicator"></span>
        <h3 data-focus-editable contenteditable="true" spellcheck="false" placeholder="卡片标题">${title}</h3>
      </div>
      <button class="card-close" title="删除卡片">×</button>
    </div>
    <p data-focus-editable contenteditable="true" spellcheck="false" placeholder="在此输入卡片内容...">${content}</p>
  `;
  
  const cardObj = { id, type: "note", title, content, x, y, width, height, element: cardElement };
  
  const titleEl = cardElement.querySelector("h3");
  const descEl = cardElement.querySelector("p");
  
  titleEl.addEventListener("input", () => {
    cardObj.title = titleEl.textContent;
  });
  descEl.addEventListener("input", () => {
    cardObj.content = descEl.innerHTML;
  });
  
  // Keep editor keystrokes local, but let Escape reach the Focus Manager.
  titleEl.addEventListener("keydown", event => {
    if (event.key !== "Escape") event.stopPropagation();
  });
  descEl.addEventListener("keydown", event => {
    if (event.key !== "Escape") event.stopPropagation();
  });

  mountCard(cardObj);
  
  return cardObj;
}

// 2. Create Page Card (Browser Embed)
function createPageCard(x = 0, y = 0, initialUrl = "", displayName = "") {
  cardIdCounter += 1;
  const id = cardIdCounter;
  
  const width = 1200;
  const height = 800;
  
  const cardElement = document.createElement("div");
  cardElement.className = "card-item page-card interactive";
  cardElement.dataset.id = id;
  cardElement.style.left = `${x}px`;
  cardElement.style.top = `${y}px`;
  cardElement.style.width = `${width}px`;
  cardElement.style.height = `${height}px`;
  
  const displayVal = displayName || initialUrl;
  
  cardElement.innerHTML = `
    <div class="page-header-row">
      <span class="page-mode-indicator"></span>
      <button class="page-nav-btn page-btn-back" title="后退" disabled>←</button>
      <button class="page-nav-btn page-btn-refresh" title="刷新">↻</button>
      <input data-focus-control type="text" class="page-input" placeholder="输入网址 (如 google.com) 或拖入本地 HTML" value="${displayVal}">
      <button data-focus-control class="page-btn page-btn-load" title="载入网页">Go</button>
      <button class="card-close" title="删除卡片">×</button>
    </div>
    <div class="iframe-wrapper">
      <div class="iframe-empty">
        <span>🌐 请在上方输入网址并点击 <b>Go</b>。</span>
        <span style="font-size: 11px; opacity: 0.6; margin-top: 4px;">
          注：推荐使用本地 HTML 组件、图片与表格。
        </span>
      </div>
      <div class="iframe-cover"></div>
    </div>
  `;
  
  const inputEl = cardElement.querySelector(".page-input");
  const loadBtn = cardElement.querySelector(".page-btn-load");
  const backBtn = cardElement.querySelector(".page-btn-back");
  const refreshBtn = cardElement.querySelector(".page-btn-refresh");
  const wrapperEl = cardElement.querySelector(".iframe-wrapper");
  const emptyEl = cardElement.querySelector(".iframe-empty");
  
  if (displayName && initialUrl) {
    inputEl.dataset.actualUrl = initialUrl;
  }
  
  // Start unlocked: address bar inputs are enabled by default
  inputEl.disabled = false;
  loadBtn.disabled = false;
  
  const cardObj = { 
    id, 
    type: "page", 
    url: initialUrl, 
    x, 
    y, 
    width, 
    height, 
    element: cardElement,
    currentUrl: initialUrl,
    iframeEl: null,
    contentKind: initialUrl ? "iframe" : "empty",
    objectUrl: /^blob:/i.test(initialUrl) ? initialUrl : null,
    history: initialUrl ? [initialUrl] : [],
    historyIndex: initialUrl ? 0 : -1
  };
  
  // Wire up back & refresh buttons
  backBtn.addEventListener("click", () => {
    if (cardObj.iframeEl && cardObj.historyIndex > 0) {
      cardObj.iframeEl.contentWindow.postMessage({ source: "SPACE_PAGE_CONTROL", action: "back" }, "*");
    }
  });

  refreshBtn.addEventListener("click", () => {
    if (cardObj.iframeEl) {
      cardObj.iframeEl.contentWindow.postMessage({ source: "SPACE_PAGE_CONTROL", action: "refresh" }, "*");
    }
  });
  
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

    // Revoke only the previous local object URL. The manager owns the iframe
    // node itself so every unload path updates the same state and reference.
    if (cardObj.objectUrl && cardObj.objectUrl !== url) {
      URL.revokeObjectURL(cardObj.objectUrl);
    }
    cardObj.objectUrl = isBlobUrl ? url : null;
    cardObj.url = url;
    cardObj.currentUrl = url;

    destroyPageCardIframe(cardObj);
    cardElement.classList.remove("has-iframe");
    
    // Clear any existing excel container in the page card
    const oldExcel = cardElement.querySelector(".page-excel-container");
    if (oldExcel) oldExcel.remove();
    
    if (isExcelFile) {
      cardObj.contentKind = "excel";
      emptyEl.style.display = "none";
      
      const loader = document.createElement("div");
      loader.className = "page-excel-container";
      loader.innerHTML = `<span style="color:var(--muted); font-size:12px;">正在导入并渲染电子表格数据...</span>`;
      wrapperEl.appendChild(loader);
      
      if (isBlobUrl) {
        fetch(url)
          .then(res => res.arrayBuffer())
          .then(ab => {
            const data = new Uint8Array(ab);
            const workbook = XLSX.read(data, { type: "array" });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const html = XLSX.utils.sheet_to_html(worksheet);
            
            loader.innerHTML = `
              <div class="excel-sheet-name" style="margin-bottom:8px; display:inline-block;">${sheetName}</div>
              <div class="excel-table-container">${html}</div>
            `;
          })
          .catch(err => {
            loader.innerHTML = `<span style="color:var(--danger); font-size:12px;">导入失败: ${err.message}</span>`;
          });
      } else {
        loader.innerHTML = `<span style="color:var(--danger); font-size:12px;">在线地址暂不支持直接渲染，请直接拖拽本地 .xlsx 文件到画布中。</span>`;
      }
      return;
    }
    
    cardObj.contentKind = "iframe";
    emptyEl.style.display = "none";
    mountPageCardIframe(cardObj, url, { reason: "load" });
  }
  
  loadBtn.addEventListener("click", loadUrl);
  
  inputEl.addEventListener("input", () => {
    delete inputEl.dataset.actualUrl;
  });

  inputEl.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      loadUrl();
    }
    if (event.key !== "Escape") event.stopPropagation();
  });
  
  mountCard(cardObj, {
    onRemove: () => {
      unregisterPageCardMemory(cardObj);
      if (cardObj.objectUrl) {
        URL.revokeObjectURL(cardObj.objectUrl);
        cardObj.objectUrl = null;
      }
      destroyPageCardIframe(cardObj);
    }
  });
  registerPageCardMemory(cardObj);
  
  if (initialUrl) {
    loadUrl();
  }
  
  return cardObj;
}

// 3. Create Image Card (Local image drops)
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
      <span class="page-mode-indicator"></span>
      <button class="card-close" title="删除图片">×</button>
    </div>
    <div class="image-wrapper">
      <img class="card-image" src="${src}" alt="loaded image">
    </div>
  `;
  
  const cardObj = { id, type: "image", src, x, y, width, height, element: cardElement };
  
  mountCard(cardObj);
  
  return cardObj;
}

// 4. Create Excel Card (Local spreadsheet drops)
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
      <div class="header-left">
        <span class="page-mode-indicator"></span>
        <span class="excel-sheet-name">${sheetName}</span>
      </div>
      <button class="card-close" title="删除">×</button>
    </div>
    <div class="excel-wrapper">
      <div class="excel-table-container">
        ${html}
      </div>
    </div>
  `;
  
  const cardObj = { id, type: "excel", sheetName, html, x, y, width, height, element: cardElement };
  
  mountCard(cardObj);
  
  return cardObj;
}

// ----------------------------------------------------
// Card Dragging & Resizing Implementation details
// ----------------------------------------------------

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
    prepareCardManipulation(cardObj);
    
    activeDragCard = cardElement;
    activeDragCardData = cardObj;
    cardElement.classList.add("dragging");
    viewport.classList.add("dragging-card");
    setPageIframeInteractionShield(true);
    
    bringToFront(cardElement);
    
    const worldMouse = screenToWorld(event.clientX, event.clientY);
    cardDragOffset = {
      x: worldMouse.x - cardObj.x,
      y: worldMouse.y - cardObj.y
    };
  });
}

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
      prepareCardManipulation(cardObj);
      
      activeResizeCard = cardElement;
      activeResizeCardData = cardObj;
      resizeDirection = dir;
      
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
      setPageIframeInteractionShield(true);
    });
  });
}

// ----------------------------------------------------
// File Importers
// ----------------------------------------------------

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

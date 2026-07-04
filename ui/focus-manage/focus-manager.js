// focus-manage/focus-manager.js
// Dedicated Module for Canvas Card Focus and Browser Mode (F / ESC) State Machine

// DOM Selectors
const $ = (selector, root = document) => root.querySelector(selector);

const viewport = $("#viewport");
const world = $("#world");
const dotGrid = $("#dot-grid");
const zoomLabel = $("#zoom-label");
const toast = $("#toast");

// Toast helpers
var toastTimer = 0;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = "toast";
  if (isError) toast.classList.add("error");
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
}

// `focusedCard` is the only focus source of truth. CSS and the canvas status
// indicator are synchronized directly instead of observing DOM mutations.
var hoveredCard = null;
var focusedCard = null;
var preFocusView = null;
var focusTransitionToken = 0;
var pageIframeInteractionShielded = false;
var focusViewTransitionCard = null;

const canvasFocusStatus = $("#canvas-focus-status");

function syncCanvasFocusStatus() {
  if (!canvasFocusStatus) return;

  const isFocused = Boolean(focusedCard);
  const label = isFocused ? "画布已聚焦" : "画布未聚焦";
  canvasFocusStatus.classList.toggle("is-focused", isFocused);
  canvasFocusStatus.setAttribute("aria-label", label);
  canvasFocusStatus.title = label;
}

function setFocusedCard(card) {
  focusedCard = card || null;
  syncCanvasFocusStatus();
}

function beginFocusViewTransition(card) {
  finishFocusViewTransition();
  if (!card || !card.element) return;

  focusViewTransitionCard = card;
  card.element.classList.add("focus-transition-card");
  viewport.classList.add("focus-view-transition");
}

function finishFocusViewTransition(card = null) {
  if (card && focusViewTransitionCard !== card) return;

  if (focusViewTransitionCard && focusViewTransitionCard.element) {
    focusViewTransitionCard.element.classList.remove("focus-transition-card");
  }
  focusViewTransitionCard = null;
  viewport.classList.remove("focus-view-transition");
}

// Track mouse position globally for real-time card detection under pointer
let lastMouseX = 0;
let lastMouseY = 0;
window.addEventListener("mousemove", event => {
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
  releaseStalePageIframeShield();
});

function getCardAtPointer(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element) return null;
  const cardElement = element.closest(".card-item");
  if (!cardElement) return null;
  const cardId = parseInt(cardElement.dataset.id);
  return cardsList.find(c => c.id === cardId);
}

function registerFocusableCard(card) {
  if (!card || !card.element) return;

  card.element.addEventListener("mouseenter", () => {
    hoveredCard = card;
    // If keyboard focus is lost inside an iframe, restore it to the parent window
    if (document.activeElement && document.activeElement.tagName === "IFRAME") {
      window.focus();
    }
  });
  card.element.addEventListener("mouseleave", () => {
    if (hoveredCard === card) hoveredCard = null;
  });
}

function releaseCardFromFocusManager(card) {
  if (!card) return false;
  if (hoveredCard === card) hoveredCard = null;
  return focusedCard === card ? exitActiveFocus() : false;
}

function syncPageIframeCover(cardElement) {
  if (!cardElement || !cardElement.classList.contains("page-card")) return;

  const coverEl = cardElement.querySelector(".iframe-cover");
  if (!coverEl) return;

  const interactionActive = Boolean(
    panning || activeDragCard || activeResizeCard
  );
  const needsInputShield = pageIframeInteractionShielded &&
    interactionActive &&
    cardElement.classList.contains("interactive");
  coverEl.classList.toggle("canvas-input-shield", needsInputShield);
}

function clearAllPageIframeShields() {
  document.querySelectorAll(".card-item.page-card .iframe-cover.canvas-input-shield")
    .forEach(coverEl => coverEl.classList.remove("canvas-input-shield"));
}

// Focus Manager owns the iframe interaction boundary. Canvas movement only
// reports whether it needs protection; frozen/interactive cover state stays here.
function setPageIframeInteractionShield(active) {
  pageIframeInteractionShielded = Boolean(active);
  document.querySelectorAll(".card-item.page-card").forEach(syncPageIframeCover);
}

function releaseStalePageIframeShield() {
  if (panning || activeDragCard || activeResizeCard) return;
  pageIframeInteractionShielded = false;
  clearAllPageIframeShields();
  if (viewport) {
    viewport.classList.toggle("panning", Boolean(panning));
    viewport.classList.toggle("dragging-card", Boolean(activeDragCard || activeResizeCard));
  }
}

function cancelPendingFocusRestore(preserveOrigin = false) {
  // A stored origin with no active card means the restore animation is active
  // (or was interrupted). No second phase variable is needed.
  if (focusedCard || !preFocusView) return false;

  focusTransitionToken += 1;
  cancelViewAnimation();

  if (!preserveOrigin) {
    preFocusView = null;
  }

  return true;
}

function interruptFocusViewTransition(preserveOrigin = false) {
  if (!cancelPendingFocusRestore(preserveOrigin)) {
    cancelViewAnimation();
  }
  finishFocusViewTransition();
}

function prepareFocusTransition() {
  interruptFocusViewTransition(true);

  if (!preFocusView) {
    preFocusView = { x: view.x, y: view.y, zoom: view.zoom };
  }
}

function getFocusViewAnimationOptions() {
  const loadedPageCount = document.querySelectorAll(
    ".card-item.page-card.has-iframe"
  ).length;
  return {
    deferGrid: true,
    compositor: true,
    duration: loadedPageCount > 1 ? 220 : 300
  };
}

function restorePreFocusView(onComplete = null) {
  if (!preFocusView) {
    if (typeof onComplete === "function") onComplete();
    return;
  }

  const restoreView = preFocusView;
  const transitionToken = ++focusTransitionToken;

  animateViewTo(
    restoreView.x,
    restoreView.y,
    restoreView.zoom,
    () => {
      if (transitionToken !== focusTransitionToken || focusedCard) {
        return;
      }

      preFocusView = null;
      if (typeof onComplete === "function") onComplete();
    },
    getFocusViewAnimationOptions()
  );
}

function setCardEditingEnabled(card, enabled) {
  // Always keep editable and controls enabled
  card.element.querySelectorAll("[data-focus-editable]").forEach(element => {
    element.contentEditable = "true";
  });
  card.element.querySelectorAll("[data-focus-control]").forEach(element => {
    element.disabled = false;
  });
}

function releaseDocumentFocus(card = null) {
  const activeElement = document.activeElement;
  const canRelease = activeElement && (!card ||
    (card.element && card.element.contains(activeElement)));
  if (canRelease &&
      typeof activeElement.blur === "function") {
    activeElement.blur();
  }
  window.focus();
}

function prepareCardManipulation(card) {
  releaseDocumentFocus(card);
  interruptFocusViewTransition();
}

function activateCard(card) {
  card.element.classList.add("focused-card");

  if (card.type !== "page") return;

  if (typeof wakePageCardIframe === "function") {
    wakePageCardIframe(card);
  }
}

function deactivateCard(card) {
  if (!card || !card.element) return;

  card.element.classList.remove("focused-card");
}

function reevaluateCardMemory(card) {
  if (typeof reevaluatePageCardMemory === "function") {
    reevaluatePageCardMemory(card);
  }
}

// Center any card in the viewport.
function centerCardInViewport(card, isSmooth = true, onComplete = null) {
  if (!card || !card.element) return;

  const rect = viewport.getBoundingClientRect();
  const viewportWidth = rect.width;
  const viewportHeight = rect.height;
  const geometry = getCardWorldGeometry(card);
  const focusGeometry = typeof getCardFocusWorldGeometry === "function"
    ? (getCardFocusWorldGeometry(card) || geometry)
    : geometry;
  if (!geometry || !focusGeometry) return;
  const cardWidth = geometry.width;
  const cardHeight = geometry.height;
  const isPage = card.type === "page";
  const padding = isPage ? 30 : 100;
  const zoomX = (viewportWidth - padding * 2) / cardWidth;
  const zoomY = (viewportHeight - padding * 2) / cardHeight;
  const maxZoomLimit = isPage ? 2.5 : 1.2;
  const fittedZoom = Math.min(
    maxZoomLimit,
    Math.max(0.1, Math.min(zoomX, zoomY))
  );
  // Cross-origin iframe text is rasterized before the canvas transform is
  // applied. Near 100%, a small fractional scale is visibly softer than
  // native browser rendering, so prefer an exact 1:1 focus view.
  const targetZoom = isPage && Math.abs(fittedZoom - 1) <= 0.12
    ? 1
    : fittedZoom;
  // Focus should align to the visible viewport center, not the outer browser
  // window center. That avoids bias from host tabs/bookmarks and lets page
  // cards center by their actual content area instead of the whole shell.
  const anchorX = viewportWidth / 2;
  const anchorY = viewportHeight / 2;
  const targetX = anchorX - focusGeometry.centerX * targetZoom;
  const targetY = anchorY - focusGeometry.centerY * targetZoom;

  if (isSmooth) {
    animateViewTo(
      targetX,
      targetY,
      targetZoom,
      onComplete,
      getFocusViewAnimationOptions()
    );
  } else {
    view.zoom = targetZoom;
    view.x = targetX;
    view.y = targetY;
    updateView();
    if (typeof onComplete === "function") onComplete();
  }
}

// Enter focus mode for a card
function enterCardFocus(card) {
  if (!card || !card.element) return false;

  releaseDocumentFocus();

  if (focusedCard && focusedCard !== card) {
    const previousCard = focusedCard;
    deactivateCard(previousCard);
    setFocusedCard(null);
    reevaluateCardMemory(previousCard);
  }

  prepareFocusTransition();
  setFocusedCard(card);
  activateCard(card);
  beginFocusViewTransition(card);
  centerCardInViewport(card, true, () => {
    finishFocusViewTransition(card);
    if (focusedCard !== card || card.type !== "page") return;
    const iframeElement = card.iframeEl ||
      card.element.querySelector(".page-iframe");
    if (iframeElement) iframeElement.focus();
  });

  return true;
}

// Exit focus mode for a card (Disabled: focus no longer manages exit modules)
function exitActiveFocus() {
  return false;
}

// Keyboard shortcuts (Control/Ctrl for Focus)
window.addEventListener("keydown", event => {
  if (
    (event.key === "Control" || event.key === "Ctrl" || event.code === "ControlLeft" || event.code === "ControlRight") &&
    !event.repeat
  ) {
    const focusTarget = getCardAtPointer(lastMouseX, lastMouseY) || focusedCard;

    if (focusTarget) {
      enterCardFocus(focusTarget);
    }
  }
});

window.addEventListener("mouseup", releaseStalePageIframeShield, true);
window.addEventListener("blur", releaseStalePageIframeShield);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    releaseStalePageIframeShield();
  }
});

syncCanvasFocusStatus();

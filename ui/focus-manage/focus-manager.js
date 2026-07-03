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

function registerFocusableCard(card) {
  if (!card || !card.element) return;

  card.element.addEventListener("mouseenter", () => {
    hoveredCard = card;
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

  const needsInputShield = pageIframeInteractionShielded &&
    cardElement.classList.contains("interactive");
  coverEl.classList.toggle("canvas-input-shield", needsInputShield);
}

// Focus Manager owns the iframe interaction boundary. Canvas movement only
// reports whether it needs protection; frozen/interactive cover state stays here.
function setPageIframeInteractionShield(active) {
  pageIframeInteractionShielded = Boolean(active);
  document.querySelectorAll(".card-item.page-card").forEach(syncPageIframeCover);
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
  card.element.querySelectorAll("[data-focus-editable]").forEach(element => {
    element.contentEditable = enabled ? "true" : "false";
  });
  card.element.querySelectorAll("[data-focus-control]").forEach(element => {
    element.disabled = !enabled;
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
  setCardEditingEnabled(card, true);

  if (card.type !== "page") return;

  if (typeof wakePageCardIframe === "function") {
    wakePageCardIframe(card);
  }
  card.element.classList.add("interactive");
  syncPageIframeCover(card.element);
}

function deactivateCard(card) {
  if (!card || !card.element) return;

  releaseDocumentFocus(card);
  setCardEditingEnabled(card, false);
  card.element.classList.remove("focused-card", "interactive");
  if (card.type === "page") syncPageIframeCover(card.element);
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
  const cardWidth = card.width || card.element.offsetWidth || 320;
  const cardHeight = card.height || card.element.offsetHeight || 240;
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
  const cardCenterX = card.x + cardWidth / 2;
  const cardCenterY = card.y + cardHeight / 2;
  let targetX = viewportWidth / 2 - cardCenterX * targetZoom;
  let targetY = viewportHeight / 2 - cardCenterY * targetZoom;

  if (isPage) {
    // Keep the page surface on physical-pixel boundaries. The correction is
    // sub-pixel sized, so centering remains visually unchanged.
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const screenLeft = card.x * targetZoom + targetX;
    const screenTop = card.y * targetZoom + targetY;
    targetX += Math.round(screenLeft * pixelRatio) / pixelRatio - screenLeft;
    targetY += Math.round(screenTop * pixelRatio) / pixelRatio - screenTop;
  }

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

// Exit focus mode for a card
function exitActiveFocus() {
  if (!focusedCard) return false;

  const card = focusedCard;
  beginFocusViewTransition(card);
  deactivateCard(card);
  setFocusedCard(null);
  reevaluateCardMemory(card);
  restorePreFocusView(() => finishFocusViewTransition(card));
  return true;
}

// Keyboard shortcuts (F / Escape)
window.addEventListener("keydown", event => {
  const activeElement = document.activeElement;
  const isInputActive = activeElement && (
    ["INPUT", "TEXTAREA"].includes(activeElement.tagName) ||
    activeElement.isContentEditable
  );
  const focusTarget = hoveredCard || focusedCard;

  if (
    (event.key === "f" || event.key === "F") &&
    !isInputActive &&
    !event.repeat &&
    focusTarget
  ) {
    event.preventDefault();
    enterCardFocus(focusTarget);
  }

  if (
    event.key === "Escape" ||
    event.code === "Escape" ||
    event.keyCode === 27
  ) {
    if (exitActiveFocus()) {
      event.preventDefault();
    }
  }
});

// Escape from an embedded page iframe
window.addEventListener("message", event => {
  if (!event.data || event.data.source !== "SPACE_ESCAPE_PRESSED") return;
  if (!focusedCard || focusedCard.type !== "page") return;

  const iframeEl = focusedCard.element.querySelector(".page-iframe");
  if (iframeEl && event.source === iframeEl.contentWindow) {
    exitActiveFocus();
  }
});

syncCanvasFocusStatus();

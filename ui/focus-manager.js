// focus-manager.js
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

// Shared globals across scripts
var hoveredCard = null;
var focusedCard = null;
var preFocusView = null;
var focusModePhase = "idle";
var focusTransitionToken = 0;
var pendingIframeFocusTimer = 0;
var pageIframeInteractionShielded = false;

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

function cancelPendingIframeFocus() {
  if (!pendingIframeFocusTimer) return;
  clearTimeout(pendingIframeFocusTimer);
  pendingIframeFocusTimer = 0;
}

function cancelPendingFocusRestore(preserveOrigin = false) {
  if (focusModePhase !== "restoring") return false;

  focusTransitionToken += 1;
  cancelViewAnimation();
  focusModePhase = "idle";

  if (!preserveOrigin) {
    preFocusView = null;
  }

  return true;
}

function prepareFocusTransition() {
  if (focusModePhase === "restoring") {
    cancelPendingFocusRestore(true);
  } else {
    cancelViewAnimation();
  }

  if (!preFocusView) {
    preFocusView = { x: view.x, y: view.y, zoom: view.zoom };
  }

  focusModePhase = "focused";
}

function restorePreFocusView() {
  if (!preFocusView) {
    focusModePhase = "idle";
    return;
  }

  const restoreView = preFocusView;
  const transitionToken = ++focusTransitionToken;
  focusModePhase = "restoring";

  animateViewTo(restoreView.x, restoreView.y, restoreView.zoom, () => {
    if (transitionToken !== focusTransitionToken || focusedCard) {
      return;
    }

    preFocusView = null;
    focusModePhase = "idle";
  });
}

function activateCard(card) {
  card.element.classList.add("focused-card");

  if (card.type === "note") {
    const titleEl = card.element.querySelector("h3");
    const descEl = card.element.querySelector("p");
    if (titleEl) titleEl.contentEditable = "true";
    if (descEl) descEl.contentEditable = "true";
    return;
  }

  if (card.type !== "page") return;

  if (typeof wakePageCardIframe === "function") {
    wakePageCardIframe(card);
  }
  card.element.classList.add("interactive");
  syncPageIframeCover(card.element);

  const inputEl = card.element.querySelector(".page-input");
  const loadBtn = card.element.querySelector(".page-btn-load");

  if (inputEl) inputEl.disabled = false;
  if (loadBtn) loadBtn.disabled = false;
}

function deactivateCard(card) {
  if (!card || !card.element) return;

  card.element.classList.remove("focused-card", "interactive");

  if (card.type === "note") {
    const titleEl = card.element.querySelector("h3");
    const descEl = card.element.querySelector("p");
    if (titleEl) {
      titleEl.contentEditable = "false";
      if (document.activeElement === titleEl) titleEl.blur();
    }
    if (descEl) {
      descEl.contentEditable = "false";
      if (document.activeElement === descEl) descEl.blur();
    }
    return;
  }

  if (card.type !== "page") return;

  syncPageIframeCover(card.element);

  const inputEl = card.element.querySelector(".page-input");
  const loadBtn = card.element.querySelector(".page-btn-load");

  if (inputEl) inputEl.disabled = true;
  if (loadBtn) loadBtn.disabled = true;
}

function releaseDocumentFocus() {
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
  window.focus();
}

// Center any card in the viewport.
function focusCard(card, isSmooth = true) {
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
    animateViewTo(targetX, targetY, targetZoom);
  } else {
    view.zoom = targetZoom;
    view.x = targetX;
    view.y = targetY;
    updateView();
  }
}

// Enter focus mode for a card
function enterCardFocus(card) {
  if (!card || !card.element) return false;

  cancelPendingIframeFocus();

  if (focusedCard && focusedCard !== card) {
    const previousCard = focusedCard;
    deactivateCard(previousCard);
    focusedCard = null;
    if (typeof reevaluatePageCardMemory === "function") {
      reevaluatePageCardMemory(previousCard);
    }
  }

  prepareFocusTransition();
  focusedCard = card;
  activateCard(card);
  focusCard(card, true);

  if (card.type === "page") {
    const iframeEl = card.element.querySelector(".page-iframe");
    if (iframeEl) {
      pendingIframeFocusTimer = setTimeout(() => {
        pendingIframeFocusTimer = 0;
        if (focusedCard === card && focusModePhase === "focused") {
          iframeEl.focus();
        }
      }, 150);
    }
  }

  return true;
}

// Exit focus mode for a card
function exitActiveFocus() {
  if (!focusedCard) return false;

  const card = focusedCard;
  cancelPendingIframeFocus();
  deactivateCard(card);
  focusedCard = null;
  if (typeof reevaluatePageCardMemory === "function") {
    reevaluatePageCardMemory(card);
  }
  releaseDocumentFocus();
  restorePreFocusView();
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

// ui/card/link-drop-handler.js
// Handles dragging bookmark and external links directly onto the canvas as Page Cards.

(function() {
  // Listen for dragging over the window
  window.addEventListener("dragover", event => {
    // Check if dragging links or text
    const types = event.dataTransfer.types;
    if (types && (types.includes("text/uri-list") || types.includes("text/plain"))) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });

  // Listen for dropping links
  window.addEventListener("drop", event => {
    let url = event.dataTransfer.getData("text/uri-list");
    
    // Fallback: try parsing text/plain if it contains a URL
    if (!url) {
      const text = event.dataTransfer.getData("text/plain");
      if (text) {
        const trimmed = text.trim();
        if (/^https?:\/\//i.test(trimmed) || (trimmed.includes(".") && !trimmed.includes(" "))) {
          url = trimmed;
        }
      }
    }

    if (url) {
      event.preventDefault();
      event.stopPropagation();

      // Clean up URL formatting (some browsers include newlines in text/uri-list)
      const cleanUrl = url.split("\r")[0].split("\n")[0].trim();
      if (!cleanUrl) return;

      // Ensure protocol is present
      let finalUrl = cleanUrl;
      if (!/^https?:\/\//i.test(finalUrl) && !/^file:\/\/\//i.test(finalUrl)) {
        finalUrl = "https://" + finalUrl;
      }

      // Convert mouse coordinates to world coordinates on the infinite canvas
      let worldX = event.clientX;
      let worldY = event.clientY;

      if (typeof screenToWorld === "function") {
        const worldPos = screenToWorld(event.clientX, event.clientY);
        worldX = worldPos.x;
        worldY = worldPos.y;
      }

      // Create a page card (centered on pointer)
      const cardWidth = 1200;
      const cardHeight = 800;

      if (typeof createPageCard === "function") {
        const card = createPageCard(
          Math.round(worldX - cardWidth / 2),
          Math.round(worldY - cardHeight / 2),
          finalUrl
        );

        if (typeof animateCardEntrance === "function") {
          animateCardEntrance(card.element);
        }
        if (typeof showToast === "function") {
          showToast(`已载入外部链接: ${finalUrl}`);
        }
      }
    }
  });
})();

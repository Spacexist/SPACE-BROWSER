// Agent/information.js
// Perception helpers only. This module finds targets and reports state.

(function initializeAgentInformation() {
  function getCards() {
    return Array.isArray(window.cardsList) ? window.cardsList : [];
  }

  function describeCard(card) {
    if (!card) return null;

    const geometry = typeof getCardWorldGeometry === "function"
      ? getCardWorldGeometry(card)
      : null;
    const clientCenter = geometry && typeof worldToClient === "function"
      ? worldToClient(geometry.centerX, geometry.centerY)
      : null;

    return {
      id: card.id,
      type: card.type,
      title: card.title || "",
      content: card.content || "",
      url: card.url || "",
      geometry,
      clientCenter,
      focused: typeof focusedCard !== "undefined" && focusedCard === card
    };
  }

  function listCards() {
    return getCards().map(describeCard);
  }

  function findCardById(id) {
    return getCards().find(card => card && card.id === Number(id)) || null;
  }

  function findCardByText(text) {
    const needle = String(text || "").trim().toLowerCase();
    if (!needle) return null;

    return getCards().find(card => {
      const haystack = [
        card.title,
        card.content,
        card.url,
        card.element ? card.element.textContent : ""
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    }) || null;
  }

  function findCardAtClientPoint(clientX, clientY) {
    if (typeof getCardAtPointer === "function") {
      return getCardAtPointer(clientX, clientY);
    }

    const element = document.elementFromPoint(clientX, clientY);
    const cardElement = element && element.closest(".card-item");
    if (!cardElement) return null;
    return findCardById(cardElement.dataset.id);
  }

  window.AgentInformation = {
    cards: listCards,
    describeCard,
    findCardById,
    findCardByText,
    findCardAtClientPoint,
    focusedCard: () => describeCard(typeof focusedCard !== "undefined" ? focusedCard : null),
    view: () => ({ x: view.x, y: view.y, zoom: view.zoom })
  };
})();

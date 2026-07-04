// Agent/hand/close/close.js
// Close action module for cards.

(function initializeAgentHandClose() {
  function getCloseButtonClient(card) {
    if (!card || !card.element) return null;
    const button = card.element.querySelector(".card-close");
    if (!button) return null;

    const rect = button.getBoundingClientRect();
    return {
      button,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  async function run(payload = {}, options = {}, context = {}) {
    const cardRef = context.normalizeCardReference
      ? context.normalizeCardReference(payload)
      : (payload.card || payload);
    const card = context.resolveCard ? context.resolveCard(cardRef) : null;
    if (!card) {
      return { ok: false, detail: "card not found" };
    }
    const mergedOptions = context.mergeActionOptions
      ? context.mergeActionOptions(payload.move || payload.cursor, options)
      : { ...(payload.move || payload.cursor || {}), ...(options || {}) };

    const closeTarget = getCloseButtonClient(card);
    if (!closeTarget) {
      return { ok: false, detail: `card #${card.id} has no close button` };
    }

    if (context.mClick) {
      const result = await context.mClick({
        move: mergedOptions,
        space: "client",
        c: {
          x: closeTarget.x,
          y: closeTarget.y
        }
      }, mergedOptions);
      return {
        ...result,
        card: context.describeCard ? context.describeCard(card) : card,
        detail: result.ok ? `closed card #${card.id}` : result.detail
      };
    }

    closeTarget.button.click();
    return {
      ok: true,
      card: context.describeCard ? context.describeCard(card) : card,
      detail: `closed card #${card.id}`
    };
  }

  window.AgentHandClose = {
    run
  };
})();

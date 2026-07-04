// Agent/hand/focus/focus.js
// Focus action module for cards.

(function initializeAgentHandFocus() {
  async function run(payload = {}, options = {}, context = {}) {
    const cardRef = context.normalizeCardReference
      ? context.normalizeCardReference(payload)
      : (payload.card || payload);
    const card = context.resolveCard ? context.resolveCard(cardRef) : null;
    if (!card || typeof enterCardFocus !== "function") {
      return { ok: false, detail: "card not found" };
    }
    const mergedOptions = context.mergeActionOptions
      ? context.mergeActionOptions(payload.move || payload.cursor, options)
      : { ...(payload.move || payload.cursor || {}), ...(options || {}) };
    const point = context.normalizeActionPointPayload
      ? context.normalizeActionPointPayload(payload, {
        fallbackSpace: payload.space || "physical",
        physicalKey: "p",
        screenKey: "s",
        clientKey: "c"
      })
      : null;

    const focusGeometry = typeof getCardFocusWorldGeometry === "function"
      ? getCardFocusWorldGeometry(card)
      : null;
    const center = focusGeometry || (context.getCardCenterWorld ? context.getCardCenterWorld(card) : null);
    if (options.moveCursor !== false && (context.move || context.moveTo)) {
      await (context.move || context.moveTo)(point || {
        space: "physical",
        x: center.x,
        y: center.y
      }, mergedOptions);
    }

    const ctrlResult = context.ctrl
      ? await context.ctrl(card, mergedOptions)
      : { ok: enterCardFocus(card) };
    const ok = Boolean(ctrlResult && ctrlResult.ok);
    return {
      ok,
      card: context.describeCard ? context.describeCard(card) : card,
      detail: ok ? `focused card #${card.id}` : `focus failed for #${card.id}`
    };
  }

  window.AgentHandFocus = {
    run
  };
})();

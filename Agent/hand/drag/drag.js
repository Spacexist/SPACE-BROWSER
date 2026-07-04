// Agent/hand/drag/drag.js
// Drag action module for cards.

(function initializeAgentHandDrag() {
  async function run(payload = {}, options = {}, context = {}) {
    const cardRef = context.normalizeCardReference
      ? context.normalizeCardReference(payload)
      : (payload.card || payload);
    const card = context.resolveCard ? context.resolveCard(cardRef) : null;
    if (!card) {
      return { ok: false, detail: "card not found" };
    }

    const center = context.getCardCenterWorld ? context.getCardCenterWorld(card) : null;
    if (!center) {
      return { ok: false, detail: `card #${card.id} has no geometry` };
    }

    const mergedOptions = context.mergeActionOptions
      ? context.mergeActionOptions(payload.move || payload.cursor, options)
      : { ...(payload.move || payload.cursor || {}), ...(options || {}) };
    const dragOptions = context.getDragOptions
      ? context.getDragOptions(mergedOptions)
      : mergedOptions;
    const dragSpace = context.normalizeSpaceName
      ? context.normalizeSpaceName(payload.space, "physical")
      : (payload.space || "physical");
    const startPoint = context.normalizeActionPointPayload
      ? context.normalizeActionPointPayload(payload, {
        fallbackSpace: dragSpace,
        physicalKey: "start_p",
        screenKey: "start_s",
        clientKey: "start_c"
      })
      : null;
    const targetPoint = context.normalizeActionPointPayload
      ? context.normalizeActionPointPayload(payload, {
        fallbackSpace: dragSpace,
        physicalKey: "target_p",
        screenKey: "target_s",
        clientKey: "target_c"
      })
      : (payload.to || payload.target || payload.point || payload);

    if (!targetPoint) {
      return { ok: false, detail: "drag target point is missing" };
    }

    const startWorld = startPoint
      ? context.resolveWorldPoint(startPoint)
      : { x: center.x, y: center.y };
    const targetWorld = context.resolveWorldPoint
      ? context.resolveWorldPoint(targetPoint)
      : { x: Number(targetPoint.x), y: Number(targetPoint.y) };
    const path = window.AgentMovementRule
      ? AgentMovementRule.createBezierPath(
        { x: startWorld.x, y: startWorld.y },
        { x: targetWorld.x, y: targetWorld.y },
        {
          curve: Math.min(120, Math.max(24, Math.hypot(targetWorld.x - startWorld.x, targetWorld.y - startWorld.y) * 0.08))
        }
      )
      : null;
    const anchorOffset = {
      x: startWorld.x - (card.x || 0),
      y: startWorld.y - (card.y || 0)
    };

    await (context.move || context.moveTo)(startPoint || {
      space: "physical",
      x: center.x,
      y: center.y
    }, dragOptions);

    const cursor = context.getCursor ? context.getCursor() : null;
    context.setCardDragState && context.setCardDragState(card, true);

    try {
      if (context.hold) {
        await context.hold({
          holdMs: dragOptions.holdMs,
          dispatch: false
        }, dragOptions);
      } else if (cursor && typeof cursor.press === "function") {
        cursor.press();
      }

      const moveResult = await (context.move || context.moveTo)(targetPoint, {
        ...dragOptions,
        onProgress: progress => {
          const worldPoint = path
            ? path.pointAt(progress)
            : {
              x: startWorld.x + (targetWorld.x - startWorld.x) * progress,
              y: startWorld.y + (targetWorld.y - startWorld.y) * progress
            };
          context.setCardPosition(
            card,
            worldPoint.x - anchorOffset.x,
            worldPoint.y - anchorOffset.y
          );
          if (typeof dragOptions.onProgress === "function") {
            dragOptions.onProgress(progress);
          }
        }
      });

      context.setCardPosition(
        card,
        targetWorld.x - anchorOffset.x,
        targetWorld.y - anchorOffset.y
      );

      return {
        ok: true,
        card: context.describeCard ? context.describeCard(card) : card,
        startWorld,
        cursor: moveResult,
        targetWorld,
        detail: `dragged card #${card.id} to ${Math.round(targetWorld.x)}, ${Math.round(targetWorld.y)}`
      };
    } finally {
      if (cursor && typeof cursor.release === "function") cursor.release();
      context.setCardDragState && context.setCardDragState(card, false);
    }
  }

  window.AgentHandDrag = {
    run
  };
})();

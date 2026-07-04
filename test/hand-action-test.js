// test/hand-action-test.js
// Manual wrappers around AgentHand actions for the on-page test panel.

(function initializeHandActionTest() {
  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function syncParamsWithLiveTarget(params = {}) {
    if (!window.SpaceTest || !SpaceTest.cursorTarget || typeof SpaceTest.cursorTarget.get !== "function") {
      return { ...params };
    }

    const target = SpaceTest.cursorTarget.get();
    if (!target) return { ...params };

    const point = params.space === "physical" ? target.physical : target.screen;
    return {
      ...params,
      x: point.x,
      y: point.y
    };
  }

  function pointFromParams(params = {}) {
    const point = {
      x: Number(params.x),
      y: Number(params.y)
    };

    return params.space === "physical"
      ? { p: point }
      : { s: point };
  }

  function moveFromParams(params = {}) {
    return {
      duration: finite(params.duration),
      steps: finite(params.steps),
      follow: params.follow !== false && params.follow !== "false"
    };
  }

  function cardTargetFromParams(params = {}) {
    if (params.cardId !== undefined && params.cardId !== null && params.cardId !== "") {
      return { id: Number(params.cardId) };
    }

    const focused = window.AgentInformation && typeof AgentInformation.focusedCard === "function"
      ? AgentInformation.focusedCard()
      : null;
    if (focused && focused.id !== undefined) {
      return { id: focused.id };
    }

    const firstCard = window.AgentInformation && typeof AgentInformation.cards === "function"
      ? AgentInformation.cards()[0]
      : null;
    if (firstCard && firstCard.id !== undefined) {
      return { id: firstCard.id };
    }

    return {
      space: params.space === "physical" ? "physical" : "screen",
      x: params.x,
      y: params.y
    };
  }

  async function runMove(params = {}) {
    const liveParams = syncParamsWithLiveTarget(params);
    const result = await AgentHand.run("move", {
      move: moveFromParams(liveParams),
      space: liveParams.space,
      ...pointFromParams(liveParams)
    });
    return {
      ok: result.ok,
      detail:
        `move ${liveParams.space} ${Math.round(Number(liveParams.x))}, ${Math.round(Number(liveParams.y))}`
    };
  }

  async function runClick(params = {}) {
    const liveParams = syncParamsWithLiveTarget(params);
    const hasExplicitCardId = params.cardId !== undefined &&
      params.cardId !== null &&
      String(params.cardId).trim() !== "";
    const payload = hasExplicitCardId
      ? {
        move: moveFromParams(liveParams),
        cardId: Number(params.cardId)
      }
      : {
        move: moveFromParams(liveParams),
        space: liveParams.space,
        ...pointFromParams(liveParams)
      };
    const result = await AgentHand.run("m_click", payload);
    return {
      ok: result.ok,
      detail: result.detail
    };
  }

  async function runDrag(params = {}) {
    const liveParams = syncParamsWithLiveTarget(params);
    const result = await AgentHand.run("drag", {
      move: moveFromParams(liveParams),
      cardId: cardTargetFromParams(liveParams).id,
      space: liveParams.space,
      ...(liveParams.space === "physical"
        ? {
          start_p: null,
          target_p: { x: Number(liveParams.x), y: Number(liveParams.y) }
        }
        : {
          start_s: null,
          target_s: { x: Number(liveParams.x), y: Number(liveParams.y) }
        })
    });
    return {
      ok: result.ok,
      detail: result.detail
    };
  }

  async function runFocus(params = {}) {
    const liveParams = syncParamsWithLiveTarget(params);
    const cardTarget = cardTargetFromParams(liveParams);
    const result = await AgentHand.run("focus", {
      move: moveFromParams(liveParams),
      cardId: cardTarget.id,
      space: liveParams.space,
      ...pointFromParams(liveParams)
    });
    return {
      ok: result.ok,
      detail: result.detail
    };
  }

  async function runClose(params = {}) {
    const cardTarget = cardTargetFromParams(params);
    const result = await AgentHand.run("close", {
      move: moveFromParams(params),
      cardId: cardTarget.id
    });
    return {
      ok: result.ok,
      detail: result.detail
    };
  }

  async function runZoom(params = {}) {
    const result = await AgentHand.run("zoom", {
      direction: params.direction || "in",
      factor: finite(params.factor)
    }, {
      duration: finite(params.zoomDuration)
    });
    return {
      ok: result.ok,
      detail: result.detail
    };
  }

  if (!window.SpaceTest) {
    window.SpaceTest = {};
  }

  window.SpaceTest.handAction = {
    move: runMove,
    click: runClick,
    m_click: runClick,
    drag: runDrag,
    focus: runFocus,
    close: runClose,
    zoom: runZoom
  };
})();

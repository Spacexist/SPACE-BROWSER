// test/cursor-function-test.js
// Manual cursor function tester for AgentHand.moveTo({ space, x, y }).

(function initializeCursorFunctionTest() {
  function formatPoint(point) {
    if (!point) return "";
    return `${Math.round(point.x)}, ${Math.round(point.y)}`;
  }

  async function runCursorFunctionTest(params) {
    if (!window.AgentHand) {
      throw new Error("AgentHand is not loaded");
    }

    const point = {
      space: params.space,
      x: Number(params.x),
      y: Number(params.y)
    };
    const state = await AgentHand.moveTo(point, {
      duration: Number.isFinite(Number(params.duration)) ? Number(params.duration) : undefined,
      steps: Number.isFinite(Number(params.steps)) ? Number(params.steps) : undefined,
      follow: params.follow !== false && params.follow !== "false" && params.follow !== "off"
    });

    return {
      ok: true,
      point,
      target: state.target,
      client: state.points.client,
      screen: state.points.screen,
      physical: state.points.physical,
      follow: state.follow,
      detail:
        `target ${point.space} ${formatPoint(point)} | ` +
        `S ${formatPoint(state.points.screen)} | ` +
        `P ${formatPoint(state.points.physical)} | ` +
        `follow ${state.follow && state.follow.followed ? "yes" : "no"}`
    };
  }

  if (!window.SpaceTest) {
    window.SpaceTest = {};
  }

  window.SpaceTest.cursorFunction = {
    run: runCursorFunctionTest
  };
})();

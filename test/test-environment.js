// test/test-environment.js
// Test-only facade for manual and future automated checks.

(function initializeSpaceTestEnvironment() {
  window.SpaceTest = {
    cards: () => window.AgentInformation ? AgentInformation.cards() : [],
    view: () => ({ x: view.x, y: view.y, zoom: view.zoom }),
    cursor: () => window.AgentVisualCursor ? AgentVisualCursor.get() : null,
    move: () => window.AgentVisualMove ? AgentVisualMove.get() : (
      window.AgentVisualCursor ? AgentVisualCursor.get() : null
    ),
    coordinateDebug: {
      enable: () => window.setCoordinateDebugEnabled && setCoordinateDebugEnabled(true),
      disable: () => window.setCoordinateDebugEnabled && setCoordinateDebugEnabled(false),
      state: () => window.getCoordinateDebugState ? getCoordinateDebugState() : null
    },
    hand: () => window.AgentHand || null,
    information: () => window.AgentInformation || null
  };
})();

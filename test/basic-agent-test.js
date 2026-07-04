// test/basic-agent-test.js
// Basic smoke tests for the root Agent modules.

(function initializeBasicAgentTest() {
  function pass(name, detail = "") {
    return { name, ok: true, detail };
  }

  function fail(name, error) {
    return {
      name,
      ok: false,
      detail: error && error.message ? error.message : String(error)
    };
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  async function runBasicAgentTest(options = {}) {
    const results = [];
    const shouldFocus = options.focus !== false;

    try {
      assert(window.AgentInformation, "AgentInformation is not loaded");
      assert(window.AgentHand, "AgentHand is not loaded");
      assert(window.AgentHandGeneral, "AgentHandGeneral is not loaded");
      assert(window.AgentHandClick, "AgentHandClick is not loaded");
      assert(window.AgentCursor, "AgentCursor is not loaded");
      assert(window.AgentVisualCursor, "AgentVisualCursor is not loaded");
      results.push(pass("agent modules loaded"));
    } catch (error) {
      results.push(fail("agent modules loaded", error));
      return report(results);
    }

    let firstCard = null;
    try {
      const cards = AgentInformation.cards();
      assert(cards.length > 0, "No cards found on canvas");
      firstCard = cards[0];
      assert(firstCard.geometry, "First card has no world geometry");
      assert(firstCard.clientCenter, "First card has no client center");
      results.push(pass("information can read cards", `found ${cards.length} cards`));
    } catch (error) {
      results.push(fail("information can read cards", error));
      return report(results);
    }

    try {
      assert(AgentHandGeneral.has("click"), "General dispatcher has no click action");
      assert(typeof AgentHand.run === "function", "AgentHand.run() is not available");
      results.push(pass("hand general dispatcher ready"));
    } catch (error) {
      results.push(fail("hand general dispatcher ready", error));
    }

    try {
      const screenPoint = clientToScreen(firstCard.clientCenter.x, firstCard.clientCenter.y);
      await AgentHand.moveTo({
        space: "screen",
        x: screenPoint.x,
        y: screenPoint.y
      });
      const cursor = AgentCursor.get();
      assert(cursor.visible, "Visual cursor is not visible");
      assert(Math.abs(cursor.clientX - firstCard.clientCenter.x) < 2, "Cursor X did not reach target");
      assert(Math.abs(cursor.clientY - firstCard.clientCenter.y) < 2, "Cursor Y did not reach target");
      results.push(pass("cursor can move by screen point"));
    } catch (error) {
      results.push(fail("cursor can move by screen point", error));
    }

    try {
      await AgentHand.moveTo({
        space: "physical",
        x: firstCard.geometry.centerX,
        y: firstCard.geometry.centerY
      });
      const cursor = AgentCursor.get();
      assert(Math.abs(cursor.clientX - firstCard.clientCenter.x) < 2, "Physical cursor X did not reach target");
      assert(Math.abs(cursor.clientY - firstCard.clientCenter.y) < 2, "Physical cursor Y did not reach target");
      results.push(pass("cursor can move by physical point"));
    } catch (error) {
      results.push(fail("cursor can move by physical point", error));
    }

    if (shouldFocus) {
      try {
        const focused = await AgentHand.focusCard(firstCard);
        assert(focused, "AgentHand.focusCard returned false");
        const focusedDescription = AgentInformation.focusedCard();
        assert(focusedDescription && focusedDescription.id === firstCard.id,
          "Focused card does not match target");
        results.push(pass("hand can focus card", `card #${firstCard.id}`));
      } catch (error) {
        results.push(fail("hand can focus card", error));
      }
    }

    try {
      const state = window.SpaceTest ? SpaceTest.view() : null;
      assert(state && Number.isFinite(state.zoom), "SpaceTest.view() did not return view state");
      results.push(pass("test environment facade works"));
    } catch (error) {
      results.push(fail("test environment facade works", error));
    }

    return report(results);
  }

  function report(results) {
    const passed = results.filter(result => result.ok).length;
    const failed = results.length - passed;
    const summary = { passed, failed, results };

    console.table(results);
    if (failed && typeof showToast === "function") {
      showToast(`Agent basic test failed: ${failed}`, true);
    } else if (typeof showToast === "function") {
      showToast(`Agent basic test passed: ${passed}`);
    }
    return summary;
  }

  function install() {
    if (!window.SpaceTest) {
      window.SpaceTest = {};
    }

    window.SpaceTest.basicAgent = {
      run: runBasicAgentTest
    };
  }

  install();
})();

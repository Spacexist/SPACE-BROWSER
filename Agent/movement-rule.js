// Agent/movement-rule.js
// General movement rules shared by cursor and future hand actions.

(function initializeAgentMovementRule() {
  const DEFAULT_SCREEN_MARGIN = 96;
  const DEFAULT_FOLLOW_DURATION = 260;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getCubicBezierPoint(start, c1, c2, end, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: mt2 * mt * start.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t2 * t * end.x,
      y: mt2 * mt * start.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t2 * t * end.y
    };
  }

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function createBezierPath(start, end, options = {}) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const curve = Number.isFinite(Number(options.curve))
      ? Number(options.curve)
      : Math.min(180, Math.max(24, distance * 0.18));
    const length = distance || 1;
    const normalX = -dy / length;
    const normalY = dx / length;
    const direction = options.curveDirection === -1 ? -1 : 1;
    const bendX = normalX * curve * direction;
    const bendY = normalY * curve * direction;

    return {
      start,
      c1: {
        x: start.x + dx * 0.32 + bendX,
        y: start.y + dy * 0.32 + bendY
      },
      c2: {
        x: start.x + dx * 0.68 + bendX,
        y: start.y + dy * 0.68 + bendY
      },
      end,
      pointAt(t) {
        return getCubicBezierPoint(this.start, this.c1, this.c2, this.end, t);
      }
    };
  }

  function getPhysicalScreenPoint(point) {
    if (!point || point.space !== "physical") return null;
    if (typeof worldToScreen !== "function") {
      throw new Error("worldToScreen() is not loaded");
    }
    return worldToScreen(Number(point.x), Number(point.y));
  }

  function isScreenPointVisible(screenPoint, options = {}) {
    const bounds = getViewportBounds();
    const margin = Number.isFinite(Number(options.margin))
      ? Number(options.margin)
      : DEFAULT_SCREEN_MARGIN;

    return screenPoint.x >= margin &&
      screenPoint.y >= margin &&
      screenPoint.x <= bounds.width - margin &&
      screenPoint.y <= bounds.height - margin;
  }

  function getScreenFollowAnchor(screenPoint, options = {}) {
    const bounds = getViewportBounds();
    const margin = Number.isFinite(Number(options.margin))
      ? Number(options.margin)
      : DEFAULT_SCREEN_MARGIN;
    const minX = Math.min(margin, bounds.width / 2);
    const maxX = Math.max(minX, bounds.width - margin);
    const minY = Math.min(margin, bounds.height / 2);
    const maxY = Math.max(minY, bounds.height - margin);
    let x = clamp(screenPoint.x, minX, maxX);
    let y = clamp(screenPoint.y, minY, maxY);
    let horizontal = "inside";
    let vertical = "inside";

    if (screenPoint.x < minX) {
      x = minX;
      horizontal = "left";
    } else if (screenPoint.x > maxX) {
      x = maxX;
      horizontal = "right";
    }

    if (screenPoint.y < minY) {
      y = minY;
      vertical = "top";
    } else if (screenPoint.y > maxY) {
      y = maxY;
      vertical = "bottom";
    }

    return {
      x,
      y,
      horizontal,
      vertical
    };
  }

  function createPhysicalFollowPlan(point, options = {}) {
    if (!point || point.space !== "physical") {
      return { followed: false, reason: "not-physical" };
    }

    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Physical follow point requires finite x and y");
    }

    const screenPoint = getPhysicalScreenPoint(point);
    const anchor = getScreenFollowAnchor(screenPoint, options);
    const followed = anchor.horizontal !== "inside" || anchor.vertical !== "inside";

    if (!followed) {
      return {
        followed: false,
        reason: "already-visible",
        screenPoint,
        anchor
      };
    }

    const startView = {
      x: view.x,
      y: view.y,
      zoom: view.zoom
    };
    const targetView = {
      x: anchor.x - x * view.zoom,
      y: anchor.y - y * view.zoom,
      zoom: view.zoom
    };

    return {
      followed: true,
      reason: "edge-follow-physical",
      point: { space: "physical", x, y },
      screenPointBefore: screenPoint,
      anchor,
      startView,
      targetView
    };
  }

  function applyPhysicalFollowPlan(plan, progress, options = {}) {
    if (!plan || !plan.followed) return plan;

    const t = easeInOutCubic(clamp(progress, 0, 1));
    view.x = plan.startView.x + (plan.targetView.x - plan.startView.x) * t;
    view.y = plan.startView.y + (plan.targetView.y - plan.startView.y) * t;
    view.zoom = plan.startView.zoom + (plan.targetView.zoom - plan.startView.zoom) * t;

    if (typeof updateView === "function") {
      updateView({ updateGrid: options.updateGrid !== false && progress >= 1 });
    }

    return {
      ...plan,
      screenPointAfter: getPhysicalScreenPoint(plan.point)
    };
  }

  function animateViewToPromise(targetX, targetY, targetZoom, options = {}) {
    return new Promise(resolve => {
      if (typeof animateViewTo === "function") {
        animateViewTo(targetX, targetY, targetZoom, resolve, options);
        return;
      }

      view.x = targetX;
      view.y = targetY;
      view.zoom = targetZoom;
      if (typeof updateView === "function") updateView();
      resolve();
    });
  }

  async function followPhysicalPoint(point, options = {}) {
    const plan = createPhysicalFollowPlan(point, options);
    if (!plan.followed) return plan;

    if (typeof interruptFocusViewTransition === "function") {
      interruptFocusViewTransition();
    }

    const duration = Number.isFinite(Number(options.duration))
      ? Number(options.duration)
      : DEFAULT_FOLLOW_DURATION;

    await animateViewToPromise(plan.targetView.x, plan.targetView.y, plan.targetView.zoom, {
      duration,
      deferGrid: true,
      compositor: true
    });

    return {
      ...plan,
      screenPointAfter: getPhysicalScreenPoint(point)
    };
  }

  window.AgentMovementRule = {
    applyPhysicalFollowPlan,
    createPhysicalFollowPlan,
    createBezierPath,
    easeInOutCubic,
    followPhysicalPoint,
    getScreenFollowAnchor,
    isScreenPointVisible
  };
})();

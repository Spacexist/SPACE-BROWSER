const http = require("node:http");
const { URL } = require("node:url");
const { CdpClient, delay } = require("./cdp-client");

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}

function clampStepCount(value, fallback = 24) {
  const count = Math.round(Number(value));
  return Number.isFinite(count) && count > 0 ? count : fallback;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getButtonName(button) {
  const value = String(button || "left").toLowerCase();
  if (value === "right" || value === "middle" || value === "back" || value === "forward") {
    return value;
  }
  return "left";
}

function getButtonsBitmask(button) {
  switch (getButtonName(button)) {
    case "right":
      return 2;
    case "middle":
      return 4;
    case "back":
      return 8;
    case "forward":
      return 16;
    case "left":
    default:
      return 1;
  }
}

class ChromeRunnerService {
  constructor(options = {}) {
    this.host = options.host || "127.0.0.1";
    this.port = Number(options.port) || 17373;
    this.cdp = new CdpClient();
    this.server = null;
    this.heldButton = null;
    this.lastPoint = null;
  }

  getState() {
    return {
      connected: Boolean(this.cdp.socket),
      session: this.cdp.getSessionInfo(),
      heldButton: this.heldButton,
      lastPoint: this.lastPoint
    };
  }

  async connectSession(options = {}) {
    try {
      const session = await this.cdp.connect(options);
      return {
        ok: true,
        session
      };
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      throw new Error(`CDP connect failed: ${detail}`);
    }
  }

  async dispatchMouse(type, payload = {}) {
    const x = finite(payload.x);
    const y = finite(payload.y);
    const button = getButtonName(payload.button);
    const params = {
      type,
      x,
      y,
      button: type === "mouseMoved" ? "none" : button,
      buttons: type === "mouseMoved"
        ? finite(payload.buttons, 0)
        : (type === "mousePressed" ? getButtonsBitmask(button) : 0),
      clickCount: finite(payload.clickCount, 1)
    };

    if (type === "mouseWheel") {
      params.deltaX = finite(payload.deltaX);
      params.deltaY = finite(payload.deltaY);
    }

    this.lastPoint = { x, y };
    await this.cdp.send("Input.dispatchMouseEvent", params);
    return {
      ok: true,
      type,
      client: { x, y }
    };
  }

  async move(payload = {}) {
    return this.dispatchMouse("mouseMoved", {
      ...payload,
      buttons: this.heldButton ? getButtonsBitmask(this.heldButton) : 0
    });
  }

  async click(payload = {}) {
    await this.move(payload);
    await this.dispatchMouse("mousePressed", payload);
    const holdMs = Math.max(0, finite(payload.holdMs, 40));
    if (holdMs > 0) await delay(holdMs);
    await this.dispatchMouse("mouseReleased", payload);
    return {
      ok: true,
      detail: `clicked ${Math.round(finite(payload.x))}, ${Math.round(finite(payload.y))}`,
      client: { x: finite(payload.x), y: finite(payload.y) }
    };
  }

  async hold(payload = {}) {
    await this.move(payload);
    await this.dispatchMouse("mousePressed", payload);
    this.heldButton = getButtonName(payload.button);
    return {
      ok: true,
      detail: `held ${Math.round(finite(payload.x))}, ${Math.round(finite(payload.y))}`,
      client: { x: finite(payload.x), y: finite(payload.y) }
    };
  }

  async release(payload = {}) {
    const point = {
      x: payload.x !== undefined ? finite(payload.x) : (this.lastPoint ? this.lastPoint.x : 0),
      y: payload.y !== undefined ? finite(payload.y) : (this.lastPoint ? this.lastPoint.y : 0),
      button: payload.button || this.heldButton || "left"
    };

    await this.dispatchMouse("mouseReleased", point);
    this.heldButton = null;
    return {
      ok: true,
      detail: `released ${Math.round(point.x)}, ${Math.round(point.y)}`,
      client: { x: point.x, y: point.y }
    };
  }

  async drag(payload = {}) {
    const from = payload.from || {};
    const to = payload.to || {};
    const button = payload.button || "left";
    const steps = clampStepCount(payload.steps, 24);
    const duration = Math.max(0, finite(payload.duration, 520));

    await this.move({ x: finite(from.x), y: finite(from.y), button });
    await this.hold({ x: finite(from.x), y: finite(from.y), button });

    const sleepMs = steps > 0 ? duration / steps : 0;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const x = finite(from.x) + (finite(to.x) - finite(from.x)) * t;
      const y = finite(from.y) + (finite(to.y) - finite(from.y)) * t;
      await this.dispatchMouse("mouseMoved", {
        x,
        y,
        button,
        buttons: getButtonsBitmask(button)
      });
      if (sleepMs > 0) await delay(sleepMs);
    }

    await this.release({ x: finite(to.x), y: finite(to.y), button });
    return {
      ok: true,
      detail: `dragged to ${Math.round(finite(to.x))}, ${Math.round(finite(to.y))}`,
      from: { x: finite(from.x), y: finite(from.y) },
      to: { x: finite(to.x), y: finite(to.y) }
    };
  }

  async scroll(payload = {}) {
    const point = {
      x: finite(payload.x),
      y: finite(payload.y),
      deltaX: finite(payload.deltaX),
      deltaY: finite(payload.deltaY)
    };
    await this.dispatchMouse("mouseWheel", point);
    return {
      ok: true,
      detail: `scrolled at ${Math.round(point.x)}, ${Math.round(point.y)}`,
      client: { x: point.x, y: point.y },
      deltaX: point.deltaX,
      deltaY: point.deltaY
    };
  }

  async type(payload = {}) {
    const text = String(payload.text || "");
    await this.cdp.send("Input.insertText", { text });
    return {
      ok: true,
      detail: `typed ${text.length} characters`,
      text
    };
  }

  async handleRequest(request, response) {
    if (request.method === "OPTIONS") {
      sendJson(response, 200, { ok: true });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          ...this.getState()
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/session") {
        sendJson(response, 200, {
          ok: true,
          ...this.getState()
        });
        return;
      }

      const body = await parseJsonBody(request);

      if (request.method === "POST" && url.pathname === "/session/connect") {
        const result = await this.connectSession(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/input/move") {
        sendJson(response, 200, await this.move(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/input/click") {
        sendJson(response, 200, await this.click(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/input/hold") {
        sendJson(response, 200, await this.hold(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/input/release") {
        sendJson(response, 200, await this.release(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/input/drag") {
        sendJson(response, 200, await this.drag(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/input/scroll") {
        sendJson(response, 200, await this.scroll(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/input/type") {
        sendJson(response, 200, await this.type(body));
        return;
      }

      sendJson(response, 404, {
        ok: false,
        detail: `Unknown route: ${request.method} ${url.pathname}`
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        detail: error && error.message ? error.message : String(error)
      });
    }
  }

  async start() {
    if (this.server) return this.server;
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response);
    });
    await new Promise(resolve => {
      this.server.listen(this.port, this.host, resolve);
    });
    return this.server;
  }

  async stop() {
    await this.cdp.close();
    if (!this.server) return;
    await new Promise(resolve => this.server.close(resolve));
    this.server = null;
  }
}

module.exports = {
  ChromeRunnerService
};

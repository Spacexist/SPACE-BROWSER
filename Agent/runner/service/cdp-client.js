const { setTimeout: delay } = require("node:timers/promises");

class CdpClient {
  constructor() {
    this.socket = null;
    this.target = null;
    this.debugUrl = "http://127.0.0.1:9222";
    this.nextId = 1;
    this.pending = new Map();
  }

  ensureRuntime() {
    if (typeof fetch !== "function") {
      throw new Error("Node fetch() is not available. Use a modern Node runtime.");
    }
  }

  getWebSocketCtor() {
    if (typeof WebSocket === "function") {
      return WebSocket;
    }

    try {
      const wsModule = require("ws");
      if (typeof wsModule === "function") return wsModule;
      if (wsModule && typeof wsModule.WebSocket === "function") return wsModule.WebSocket;
    } catch (error) {
      // Fall through to the final error below.
    }

    throw new Error(
      "Node WebSocket is not available. Use Node 22+, or install the 'ws' package for the runner service."
    );
  }

  async discoverTargets(debugUrl) {
    this.ensureRuntime();
    const endpoint = `${String(debugUrl).replace(/\/$/, "")}/json/list`;
    let response = null;
    try {
      response = await fetch(endpoint);
    } catch (error) {
      throw new Error(
        `Cannot reach Chrome debug endpoint at ${String(debugUrl).replace(/\/$/, "")}. ` +
        "Start Chrome from clickme.bat and keep that window open."
      );
    }
    if (!response.ok) {
      throw new Error(`Chrome debug endpoint returned HTTP ${response.status} at ${endpoint}`);
    }
    const targets = await response.json();
    if (!Array.isArray(targets)) {
      throw new Error("Chrome debug endpoint returned an invalid target list");
    }
    return targets;
  }

  chooseTarget(targets, options = {}) {
    const targetType = options.targetType || "page";
    const targetId = options.targetId || "";
    const titleIncludes = options.targetTitleIncludes || "";
    const urlIncludes = options.targetUrlIncludes || "";

    const candidates = targets.filter(target =>
      (!targetType || target.type === targetType) &&
      (!targetId || target.id === targetId || target.targetId === targetId) &&
      (!titleIncludes || String(target.title || "").includes(titleIncludes)) &&
      (!urlIncludes || String(target.url || "").includes(urlIncludes))
    );

    if (candidates.length > 0) {
      return candidates[0];
    }

    const fallbackPages = targets.filter(target => target.type === targetType);
    if (fallbackPages.length > 0) {
      return fallbackPages[0];
    }

    return null;
  }

  async connect(options = {}) {
    this.ensureRuntime();
    const WebSocketCtor = this.getWebSocketCtor();
    this.debugUrl = options.debugUrl || this.debugUrl;
    const targets = await this.discoverTargets(this.debugUrl);
    const target = this.chooseTarget(targets, options);
    if (!target || !target.webSocketDebuggerUrl) {
      throw new Error(
        "Chrome debug endpoint is ready, but no matching page target was found. " +
        "Open SPACE-BROWSER in that Chrome window and try Connect Runner again."
      );
    }

    await this.close();
    this.target = target;
    this.socket = new WebSocketCtor(target.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = event => {
        cleanup();
        const detail =
          (event && event.message) ||
          (event && event.error && event.error.message) ||
          "CDP socket open failed";
        reject(new Error(detail));
      };
      const cleanup = () => {
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
      };

      this.socket.addEventListener("open", onOpen);
      this.socket.addEventListener("error", onError);
    });

    this.socket.addEventListener("message", event => this.handleMessage(event.data));
    this.socket.addEventListener("close", () => this.handleClose());
    this.socket.addEventListener("error", event => this.handleSocketError(event));

    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Target.activateTarget", { targetId: target.id || target.targetId });

    return this.getSessionInfo();
  }

  handleMessage(raw) {
    let message = null;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      return;
    }

    if (!message || !message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message || "Unknown CDP error"));
      return;
    }

    pending.resolve(message.result || {});
  }

  handleClose() {
    const error = new Error("CDP connection closed");
    this.pending.forEach(pending => pending.reject(error));
    this.pending.clear();
    this.socket = null;
  }

  handleSocketError(event) {
    const error = new Error(event && event.message ? event.message : "CDP socket error");
    this.pending.forEach(pending => pending.reject(error));
    this.pending.clear();
  }

  async send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("CDP socket is not connected");
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    const result = await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(payload);
    });

    return result;
  }

  async close() {
    if (!this.socket) return;
    try {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
        await delay(20);
      }
    } catch (error) {
      // Ignore socket shutdown errors.
    } finally {
      this.socket = null;
      this.pending.clear();
    }
  }

  getSessionInfo() {
    return this.target
      ? {
        id: this.target.id || this.target.targetId || "",
        title: this.target.title || "",
        type: this.target.type || "",
        url: this.target.url || ""
      }
      : null;
  }
}

module.exports = {
  CdpClient,
  delay
};

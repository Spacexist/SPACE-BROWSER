// Agent/runner/runner.js
// Browser-side bridge for switching Hand execution between DOM and CDP backends.

(function initializeAgentRunner() {
  const DEFAULT_CONFIG = {
    backend: "cdp",
    endpoint: "http://127.0.0.1:17373",
    connectOnStartup: false,
    session: {
      debugUrl: "http://127.0.0.1:9222",
      targetUrlIncludes: "",
      targetTitleIncludes: ""
    }
  };

  let runnerConfig = cloneConfig(DEFAULT_CONFIG);
  let runnerStatus = {
    backend: "cdp",
    serviceReachable: false,
    connected: false,
    session: null,
    lastError: null
  };
  let configReady = loadConfig();

  function cloneConfig(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeConfig(base, next) {
    const merged = cloneConfig(base);
    if (!next || typeof next !== "object") return merged;

    Object.keys(next).forEach(key => {
      const value = next[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        merged[key] = mergeConfig(merged[key] || {}, value);
      } else if (value !== undefined) {
        merged[key] = value;
      }
    });

    return merged;
  }

  function pickDefined(options = {}) {
    const clean = {};
    Object.keys(options).forEach(key => {
      if (options[key] !== undefined && options[key] !== null && options[key] !== "") {
        clean[key] = options[key];
      }
    });
    return clean;
  }

  function getConfigUrl() {
    const script = document.currentScript;
    const baseUrl = script && script.src ? script.src : window.location.href;
    return new URL("config.json", baseUrl).toString();
  }

  function isFileProtocolConfigUrl(configUrl) {
    try {
      return new URL(configUrl).protocol === "file:";
    } catch (error) {
      return false;
    }
  }

  function dispatchStatus() {
    window.dispatchEvent(new CustomEvent("agent-runner-status", {
      detail: getStatus()
    }));
  }

  function dispatchConfig() {
    window.dispatchEvent(new CustomEvent("agent-runner-config-ready", {
      detail: getConfig()
    }));
  }

  async function loadConfig() {
    const configUrl = getConfigUrl();
    try {
      if (isFileProtocolConfigUrl(configUrl)) {
        runnerConfig = cloneConfig(DEFAULT_CONFIG);
      } else {
        const response = await fetch(configUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const fileConfig = await response.json();
        runnerConfig = mergeConfig(DEFAULT_CONFIG, fileConfig);
      }
    } catch (error) {
      runnerConfig = cloneConfig(DEFAULT_CONFIG);
    }

    runnerStatus.backend = getBackend();
    dispatchConfig();
    dispatchStatus();

    if (runnerConfig.connectOnStartup && getBackend() === "cdp") {
      try {
        await connect();
      } catch (error) {
        // Status already captures the error.
      }
    }

    return getConfig();
  }

  function getConfig() {
    return cloneConfig(runnerConfig);
  }

  function setConfig(nextConfig = {}) {
    runnerConfig = mergeConfig(runnerConfig, nextConfig);
    runnerStatus.backend = getBackend();
    dispatchConfig();
    dispatchStatus();
    return getConfig();
  }

  function getBackend() {
    return String(runnerConfig.backend || "cdp").trim().toLowerCase();
  }

  function setBackend(backend) {
    runnerConfig.backend = String(backend || "cdp").trim().toLowerCase();
    runnerStatus.backend = runnerConfig.backend;
    dispatchConfig();
    dispatchStatus();
    return getBackend();
  }

  function getStatus() {
    return {
      ...runnerStatus,
      backend: getBackend()
    };
  }

  function resolveSessionConfig(override = {}) {
    const pathHint = window.location.pathname || window.location.href || "";
    return {
      ...(runnerConfig.session || {}),
      targetUrlIncludes: runnerConfig.session && runnerConfig.session.targetUrlIncludes
        ? runnerConfig.session.targetUrlIncludes
        : pathHint,
      ...pickDefined(override.session || {}),
      debugUrl: override.debugUrl || (override.session && override.session.debugUrl) ||
        (runnerConfig.session && runnerConfig.session.debugUrl) ||
        DEFAULT_CONFIG.session.debugUrl
    };
  }

  async function request(path, body, method = "POST") {
    const endpoint = String(runnerConfig.endpoint || DEFAULT_CONFIG.endpoint).replace(/\/$/, "");
    let response = null;
    try {
      response = await fetch(`${endpoint}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: method === "GET" ? undefined : JSON.stringify(body || {})
      });
    } catch (error) {
      const networkError = new Error(
        `Cannot reach runner service at ${endpoint}. Start clickme.bat and try again.`
      );
      networkError.serviceReachable = false;
      throw networkError;
    }

    const text = await response.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        json = { ok: false, detail: text };
      }
    }

    if (!response.ok || json.ok === false) {
      const detail = json && json.detail ? json.detail : `HTTP ${response.status}`;
      const requestError = new Error(detail);
      requestError.serviceReachable = true;
      requestError.status = response.status;
      throw requestError;
    }

    return json;
  }

  async function ping() {
    try {
      const result = await request("/health", null, "GET");
      runnerStatus.serviceReachable = true;
      runnerStatus.lastError = null;
      runnerStatus.connected = Boolean(result.connected);
      runnerStatus.session = result.session || null;
      dispatchStatus();
      return result;
    } catch (error) {
      runnerStatus.serviceReachable = false;
      runnerStatus.connected = false;
      runnerStatus.lastError = error.message || String(error);
      dispatchStatus();
      throw error;
    }
  }

  async function connect(override = {}) {
    try {
      const result = await request("/session/connect", resolveSessionConfig(override));
      runnerStatus.serviceReachable = true;
      runnerStatus.connected = true;
      runnerStatus.session = result.session || null;
      runnerStatus.lastError = null;
      dispatchStatus();
      return result;
    } catch (error) {
      runnerStatus.serviceReachable = error && error.serviceReachable !== false;
      runnerStatus.connected = false;
      runnerStatus.lastError = error.message || String(error);
      dispatchStatus();
      throw error;
    }
  }

  async function ensureReady(override = {}) {
    if (getBackend() !== "cdp") {
      return {
        ok: true,
        backend: getBackend(),
        skipped: true,
        detail: `runner backend is ${getBackend()}`
      };
    }

    if (runnerStatus.connected) {
      return {
        ok: true,
        backend: getBackend(),
        connected: true,
        session: runnerStatus.session
      };
    }

    return connect(override);
  }

  async function execute(action, payload = {}, options = {}) {
    if (getBackend() !== "cdp") {
      return {
        ok: true,
        backend: getBackend(),
        skipped: true,
        action,
        detail: `runner backend is ${getBackend()}`
      };
    }

    await ensureReady(options);
    const requestBody = {
      action,
      ...(payload || {})
    };

    switch (action) {
      case "move":
        return request("/input/move", requestBody);
      case "click":
        return request("/input/click", requestBody);
      case "hold":
        return request("/input/hold", requestBody);
      case "release":
        return request("/input/release", requestBody);
      case "drag":
        return request("/input/drag", requestBody);
      case "scroll":
        return request("/input/scroll", requestBody);
      case "type":
        return request("/input/type", requestBody);
      default:
        throw new Error(`Unknown runner action: ${action}`);
    }
  }

  const api = {
    ready: () => configReady,
    getConfig,
    setConfig,
    getBackend,
    setBackend,
    getStatus,
    ping,
    connect,
    ensureReady,
    execute
  };

  window.AgentRunner = api;
})();

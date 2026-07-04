// Agent/hand/general/general.js
// Unified action dispatcher for AI-facing hand commands.

(function initializeAgentHandGeneral() {
  const actions = new Map();

  function normalizeActionName(name) {
    return String(name || "").trim();
  }

  function normalizeCommand(actionOrCommand, payload = {}, options = {}) {
    if (typeof actionOrCommand === "string") {
      return {
        action: normalizeActionName(actionOrCommand),
        payload: payload || {},
        options: options || {}
      };
    }

    if (!actionOrCommand || typeof actionOrCommand !== "object") {
      throw new Error("Hand command must be an action name or command object");
    }

    const action = normalizeActionName(
      actionOrCommand.action ||
      actionOrCommand.tool ||
      actionOrCommand.name ||
      actionOrCommand.type
    );
    if (!action) {
      throw new Error("Hand command requires action/tool/name/type");
    }

    const {
      action: ignoredAction,
      tool: ignoredTool,
      name: ignoredName,
      type: ignoredType,
      payload: commandPayload,
      args,
      options: commandOptions,
      ...rest
    } = actionOrCommand;

    return {
      action,
      payload: commandPayload || args || rest,
      options: commandOptions || options || {}
    };
  }

  function register(action, handler, meta = {}) {
    const name = normalizeActionName(action);
    if (!name) throw new Error("Cannot register empty hand action");
    if (typeof handler !== "function") {
      throw new Error(`Hand action "${name}" handler must be a function`);
    }

    actions.set(name, { handler, meta: { ...meta, action: name } });
    return list();
  }

  function has(action) {
    return actions.has(normalizeActionName(action));
  }

  function list() {
    return Array.from(actions.values()).map(entry => ({ ...entry.meta }));
  }

  async function run(actionOrCommand, payload = {}, options = {}) {
    const command = normalizeCommand(actionOrCommand, payload, options);
    const entry = actions.get(command.action);
    if (!entry) {
      throw new Error(`Unknown hand action: ${command.action}`);
    }

    const result = await entry.handler(command.payload, command.options, command);
    return {
      ok: result && typeof result.ok === "boolean" ? result.ok : true,
      action: command.action,
      ...result
    };
  }

  window.AgentHandGeneral = {
    register,
    has,
    list,
    run,
    normalizeCommand
  };
})();

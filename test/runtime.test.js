const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  bootstrapPluginModule,
  createPluginRuntime,
  resetMenuRegistry,
} = require("../lib/runtime");
const {
  addMenuItem,
  addMenuSeparator,
  createMenu,
  getMenu,
  getOrCreateMenu,
  registerAction,
  removeMenu,
} = require("../lib/runtime/menu");
const {
  parseFramedMessages,
  serializeFramedMessage,
} = require("../lib/runtime/transport");

function createRuntimeHarness(options) {
  const stdin = new EventEmitter();
  const chunks = [];
  const stdout = {
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
  };
  const runtime = createPluginRuntime(options);
  runtime.start({ stdin, stdout });

  return {
    async request(message) {
      stdin.emit("data", serializeFramedMessage(message));
      await new Promise((resolve) => setImmediate(resolve));
      const parsed = parseFramedMessages(Buffer.concat(chunks));
      chunks.length = 0;
      return parsed.messages;
    },
  };
}

test("createPluginRuntime answers plugin.initialize with inferred capabilities", async () => {
  const harness = createRuntimeHarness({});

  const messages = await harness.request({
    jsonrpc: "2.0",
    id: 1,
    method: "plugin.initialize",
    params: {},
  });

  assert.deepEqual(messages, [
    {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocol_version: 1,
        implements: {
          plugin: true,
          vcs: false,
        },
      },
    },
  ]);
});

test("createPluginRuntime uses plugin defaults and host notifications", async () => {
  const harness = createRuntimeHarness({
    plugin: {
      async "plugin.init"(_params, context) {
        context.host.info("ready");
        return null;
      },
    },
  });

  const messages = await harness.request({
    jsonrpc: "2.0",
    id: 2,
    method: "plugin.init",
    params: {},
  });

  assert.deepEqual(messages, [
    {
      jsonrpc: "2.0",
      method: "host.log",
      params: {
        level: "info",
        target: "openvcs.plugin",
        message: "ready",
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      result: null,
    },
  ]);
});

test("createPluginRuntime reports missing methods as plugin failures", async () => {
  const harness = createRuntimeHarness({});

  const messages = await harness.request({
    jsonrpc: "2.0",
    id: 3,
    method: "vcs.get_caps",
    params: {},
  });

  assert.deepEqual(messages, [
    {
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32001,
        message: "method 'vcs.get_caps' is not implemented",
        data: {
          code: "rpc-method-not-found",
          message: "method 'vcs.get_caps' is not implemented",
        },
      },
    },
  ]);
});

test("bootstrapPluginModule runs OnPluginStart before starting runtime", async () => {
  const stdin = new EventEmitter();
  const chunks = [];
  const stdout = {
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
  };

  await bootstrapPluginModule({
    modulePath: "./plugin.js",
    transport: { stdin, stdout },
    async importPluginModule() {
      return {
        PluginDefinition: {
          plugin: {
            async "plugin.init"(_params, context) {
              context.host.info("booted");
              return null;
            },
          },
          vcs: {
            async "vcs.get_caps"() {
              return { commits: true };
            },
          },
        },
        OnPluginStart() {
        },
      };
    },
  });

  stdin.emit(
    "data",
    serializeFramedMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "plugin.initialize",
      params: {},
    })
  );
  stdin.emit(
    "data",
    serializeFramedMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "plugin.init",
      params: {},
    })
  );
  await new Promise((resolve) => setImmediate(resolve));

  const parsed = parseFramedMessages(Buffer.concat(chunks));
  assert.deepEqual(parsed.messages, [
    {
      jsonrpc: "2.0",
      id: 4,
      result: {
        protocol_version: 1,
        implements: {
          plugin: true,
          vcs: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "host.log",
      params: {
        level: "info",
        target: "openvcs.plugin",
        message: "booted",
      },
    },
    {
      jsonrpc: "2.0",
      id: 5,
      result: null,
    },
  ]);
});

test("bootstrapPluginModule rejects modules without OnPluginStart", async () => {
  await assert.rejects(
    () =>
      bootstrapPluginModule({
        modulePath: "./plugin.js",
        async importPluginModule() {
          return {};
        },
      }),
    /must export OnPluginStart/
  );
});

test("bootstrapPluginModule rejects when OnPluginStart throws", async () => {
  await assert.rejects(
    () =>
      bootstrapPluginModule({
        modulePath: "./plugin.js",
        async importPluginModule() {
          return {
            OnPluginStart() {
              throw new Error("startup failure");
            },
          };
        },
      }),
    /plugin startup failed/
  );
});

test("resetMenuRegistry clears all menus and action handlers", () => {
  createMenu("reset-test", "Reset Test", { surface: "menubar" });
  registerAction("reset-test-action", () => "ok");
  assert.notEqual(getMenu("reset-test"), null);

  resetMenuRegistry();

  assert.equal(getMenu("reset-test"), null);
  // After reset, addMenuItem/addMenuSeparator must silently no-op for unknown menus.
});

test("addMenuItem silently ignores when menu does not exist", () => {
  resetMenuRegistry();
  // Must not throw.
  addMenuItem("nonexistent-menu", {
    label: "Irrelevant",
    action: "test-action",
  });
  assert.equal(getMenu("nonexistent-menu"), null);
});

test("addMenuSeparator silently ignores when menu does not exist", () => {
  resetMenuRegistry();
  // Must not throw.
  addMenuSeparator("nonexistent-menu");
  assert.equal(getMenu("nonexistent-menu"), null);
});

test("addMenuItem and addMenuSeparator do not implicitly create menus", () => {
  resetMenuRegistry();
  createMenu("existing-menu", "Existing Menu", { surface: "menubar" });
  addMenuItem("existing-menu", {
    label: "Test Item",
    action: "test-action",
  });
  addMenuSeparator("existing-menu");
  assert.notEqual(getMenu("existing-menu"), null);
  // Verify state was not leaked from prior tests.
  assert.equal(getMenu("reset-test"), null);
  removeMenu("existing-menu");
});

test("plugin.handle_action dispatches only on action_id (not id)", async () => {
  resetMenuRegistry();
  // Register after reset so the handler is present.
  registerAction("test-action-id", (payload) => {
    if (typeof payload === "object" && payload != null) {
      return (payload).message;
    }
    return null;
  });

  const harness = createRuntimeHarness({
    plugin: {},
  });

  // Valid dispatch via action_id.
  const valid = await harness.request({
    jsonrpc: "2.0",
    id: 10,
    method: "plugin.handle_action",
    params: { action_id: "test-action-id", payload: { message: "hello" } },
  });
  assert.deepEqual(valid, [
    { jsonrpc: "2.0", id: 10, result: { message: "hello" } },
  ]);

  // Empty params returns null.
  const empty = await harness.request({
    jsonrpc: "2.0",
    id: 11,
    method: "plugin.handle_action",
    params: {},
  });
  assert.deepEqual(empty, [{ jsonrpc: "2.0", id: 11, result: null }]);

  // Unknown action returns null.
  const unknown = await harness.request({
    jsonrpc: "2.0",
    id: 12,
    method: "plugin.handle_action",
    params: { action_id: "nonexistent-action" },
  });
  assert.deepEqual(unknown, [{ jsonrpc: "2.0", id: 12, result: null }]);
});

test("bootstrapPluginModule resets menu registry before OnPluginStart", async () => {
  resetMenuRegistry();
  // Pre-populate state that should be cleared.
  createMenu("leak-test", "Leak Test", { surface: "menubar" });
  registerAction("leak-action", () => "leaked");

  const stdin = new EventEmitter();
  const chunks = [];
  const stdout = {
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
  };

  await bootstrapPluginModule({
    modulePath: "./plugin.js",
    transport: { stdin, stdout },
    async importPluginModule() {
      return {
        PluginDefinition: { plugin: {} },
        OnPluginStart() {},
      };
    },
  });

  // Menu from before bootstrap must not be present.
  assert.equal(getMenu("leak-test"), null);
});

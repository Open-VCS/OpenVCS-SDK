const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { createPluginRuntime } = require("../lib/runtime");
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

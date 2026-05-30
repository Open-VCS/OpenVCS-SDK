const assert = require("node:assert/strict");
const test = require("node:test");

const { createDefaultPluginDelegates, createHost, createRuntimeDispatcher, isPluginFailure, pluginError } = require("../lib/runtime");
const { PROTOCOL_VERSION } = require("../lib/types");

function writer() {
  const messages = [];
  return {
    messages,
    sendResult(id, result) {
      messages.push({ id, result });
    },
    sendError(id, code, message, data) {
      messages.push({ id, error: { code, message, data } });
    },
  };
}

test("default plugin delegates return protocol-safe defaults", async () => {
  const delegates = createDefaultPluginDelegates();

  assert.equal(await delegates["plugin.init"]({}, {}), null);
  assert.equal(await delegates["plugin.deinit"]({}, {}), null);
  assert.deepEqual(await delegates["plugin.get_menus"]({}, {}), []);
  assert.equal(await delegates["plugin.handle_action"]({}, {}), null);
  assert.deepEqual(await delegates["plugin.settings.defaults"]({}, {}), []);
  assert.deepEqual(await delegates["plugin.settings.on_load"]({ values: [1] }, {}), [1]);
  assert.deepEqual(await delegates["plugin.settings.on_load"]({}, {}), []);
  assert.equal(await delegates["plugin.settings.on_apply"]({}, {}), null);
  assert.deepEqual(await delegates["plugin.settings.on_save"]({ values: [2] }, {}), [2]);
  assert.deepEqual(await delegates["plugin.settings.on_save"]({}, {}), []);
  assert.equal(await delegates["plugin.settings.on_reset"]({}, {}), null);
});

test("dispatcher rejects protocol version mismatch", async () => {
  const out = writer();
  const dispatcher = createRuntimeDispatcher({}, createHost(() => {}), out);

  await dispatcher(1, "plugin.initialize", { expected_protocol_version: PROTOCOL_VERSION + 1 });

  assert.equal(out.messages[0].id, 1);
  assert.equal(out.messages[0].error.data.code, "protocol-version-mismatch");
});

test("dispatcher merges initialize override with inferred implements", async () => {
  const out = writer();
  const dispatcher = createRuntimeDispatcher(
    {
      implements: { plugin: { menus: true } },
      vcs: { "vcs.status": async () => ({ files: [] }) },
      plugin: {
        "plugin.initialize": async () => ({ implements: { custom: true } }),
      },
    },
    createHost(() => {}),
    out,
  );

  await dispatcher("init", "plugin.initialize", { expected_protocol_version: PROTOCOL_VERSION });

  assert.equal(out.messages[0].result.protocol_version, PROTOCOL_VERSION);
  assert.equal(out.messages[0].result.implements.custom, true);
  assert.equal(out.messages[0].result.implements.vcs, true);
});

test("dispatcher reports plugin failures separately from generic failures", async () => {
  const pluginOut = writer();
  await createRuntimeDispatcher(
    { plugin: { "plugin.init": async () => { throw pluginError("bad-input", "Bad input", { field: "x" }); } } },
    createHost(() => {}),
    pluginOut,
  )(2, "plugin.init", {});

  const genericOut = writer();
  await createRuntimeDispatcher(
    { plugin: { "plugin.init": async () => { throw new Error("Boom"); } } },
    createHost(() => {}),
    genericOut,
  )(3, "plugin.init", {});

  assert.equal(pluginOut.messages[0].error.data.code, "bad-input");
  assert.equal(genericOut.messages[0].error.data.code, "plugin-internal-error");
});

test("isPluginFailure rejects non-objects", () => {
  assert.equal(isPluginFailure(null), false);
  assert.equal(isPluginFailure("bad"), false);
  assert.equal(isPluginFailure({ code: "x", message: "y" }), false);
});

test("dispatcher times out slow handlers", async () => {
  const out = writer();
  const dispatcher = createRuntimeDispatcher(
    { timeout: 1, plugin: { "plugin.init": async () => new Promise(() => {}) } },
    createHost(() => {}),
    out,
  );

  await dispatcher(4, "plugin.init", {});

  assert.equal(out.messages[0].error.data.code, "request-timeout");
  assert.match(out.messages[0].error.message, /timed out/);
});

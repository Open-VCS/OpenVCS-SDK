const assert = require("node:assert/strict");
const test = require("node:test");

const { __private } = require("../lib/init");

test("validatePluginId accepts regular ids", () => {
  assert.equal(__private.validatePluginId("my.plugin"), undefined);
  assert.equal(__private.validatePluginId("my-plugin_1"), undefined);
});

test("validatePluginId rejects empty id", () => {
  assert.match(__private.validatePluginId(""), /required/);
});

test("validatePluginId rejects dot segments", () => {
  assert.match(__private.validatePluginId("."), /must not be/);
  assert.match(__private.validatePluginId(".."), /must not be/);
});

test("validatePluginId rejects path separators", () => {
  assert.match(__private.validatePluginId("bad/id"), /path separators/);
  assert.match(__private.validatePluginId("bad\\id"), /path separators/);
});

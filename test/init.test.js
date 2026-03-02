const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

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

test("collectAnswers re-prompts invalid plugin id", async () => {
  const prompts = [
    "plugin-dir",
    "module",
    "bad/id",
    "good-id",
    "Good Plugin",
    "0.2.0",
  ];
  const booleans = [true, false];
  const messages = [];

  const promptDriver = {
    async promptText() {
      return prompts.shift() || "";
    },
    async promptBoolean() {
      return booleans.shift() || false;
    },
    close() {},
  };

  const output = {
    write(message) {
      messages.push(message);
    },
  };

  const answers = await __private.collectAnswers(
    { forceTheme: false, targetHint: "plugin-dir" },
    promptDriver,
    output
  );

  assert.equal(answers.pluginId, "good-id");
  assert.equal(answers.targetDir, path.resolve("plugin-dir"));
  assert.equal(answers.defaultEnabled, true);
  assert.equal(answers.runNpmInstall, false);
  assert.equal(messages.some((message) => message.includes("must not contain path separators")), true);
});

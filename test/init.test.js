const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const path = require("node:path");

const { __private, initUsage, isUsageError, runInitCommand } = require("../lib/init");
const { cleanupTempDir, makeTempDir } = require("./helpers");

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

test("init helpers derive stable defaults", () => {
  assert.equal(__private.sanitizeIdToken(" My Plugin!! "), "my-plugin");
  assert.equal(__private.defaultPluginIdFromDir(path.join("tmp", "My Plugin")), "my-plugin");
  assert.equal(__private.defaultPluginIdFromDir(path.join("tmp", "!!!")), "openvcs.plugin");
  assert.match(initUsage("sdk"), /sdk init/);
});

test("runInitCommand validates args before prompting", async () => {
  await assert.rejects(() => runInitCommand(["--bad"]), /unknown argument for init/);
  await assert.rejects(() => runInitCommand(["one", "two"]), /at most one target directory/);

  let usageError;
  try {
    await runInitCommand(["--help"]);
  } catch (error) {
    usageError = error;
  }
  assert.equal(isUsageError(usageError), true);
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

test("writeModuleTemplate scaffolds SDK runtime entrypoint", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const targetDir = path.join(root, "plugin");

  __private.writeModuleTemplate({
    targetDir,
    kind: "module",
    pluginId: "example.plugin",
    pluginName: "Example Plugin",
    pluginVersion: "0.1.0",
    defaultEnabled: true,
    runNpmInstall: false,
  });

  const pluginSource = fs.readFileSync(path.join(targetDir, "src", "plugin.ts"), "utf8");
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(targetDir, "package.json"), "utf8")
  );

  assert.equal(packageJson.openvcs.module.exec, "openvcs-plugin.js");
  assert.match(pluginSource, /OnPluginStart/);
  assert.match(pluginSource, /PluginDefinition/);
  assert.match(pluginSource, /context\.host\.info\('OpenVCS plugin started'\)/);

  cleanupTempDir(root);
});

test("writeThemeTemplate scaffolds theme package without module runtime", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const targetDir = path.join(root, "theme-plugin");

  __private.writeThemeTemplate({
    targetDir,
    kind: "theme",
    pluginId: "example.theme",
    pluginName: "Example Theme",
    pluginVersion: "0.3.0",
    defaultEnabled: false,
    runNpmInstall: false,
  });

  const packageJson = JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8"));
  const themeJson = JSON.parse(fs.readFileSync(path.join(targetDir, "themes", "default", "theme.json"), "utf8"));

  assert.equal(packageJson.openvcs.module, undefined);
  assert.equal(packageJson.openvcs.default_enabled, false);
  assert.equal(themeJson.name, "Example Theme");
  assert.equal(themeJson.tokens.accent, "#2a7fff");

  cleanupTempDir(root);
});

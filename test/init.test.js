const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const readline = require("node:readline/promises");
const test = require("node:test");
const path = require("node:path");

const { __private, initUsage, isUsageError, runInitCommand } = require("../lib/init");
const { cleanupTempDir, makeTempDir } = require("./helpers");

async function withMockReadline(answers, run) {
  const originalCreateInterface = readline.createInterface;
  const prompts = [];
  readline.createInterface = () => ({
    async question(prompt) {
      prompts.push(prompt);
      return answers.shift() ?? "";
    },
    close() {},
  });

  try {
    return await run(prompts);
  } finally {
    readline.createInterface = originalCreateInterface;
  }
}

async function withMockSpawnSync(result, run) {
  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = () => result;

  try {
    return await run();
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
}

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
  assert.equal(__private.defaultPluginNameFromId("my-plugin.name"), "My Plugin Name");
  assert.equal(__private.defaultPluginNameFromId("---"), "OpenVCS Plugin");
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

test("runInitCommand rejects when target path is a file", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const targetPath = path.join(root, "plugin");
  fs.writeFileSync(targetPath, "not a directory", "utf8");

  await assert.rejects(
    () =>
      withMockReadline([
        "",
        "module",
        "",
        "",
        "",
        "",
        "n",
      ], () => runInitCommand([targetPath])),
    /target path exists but is not a directory/
  );

  cleanupTempDir(root);
});

test("runInitCommand writes a module template after confirming overwrite", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const targetDir = path.join(root, "plugin");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "README.md"), "keep", "utf8");

  const created = await withMockReadline([
    "",
    "module",
    "",
    "",
    "",
    "",
    "n",
    "y",
  ], () => runInitCommand([targetDir]));

  assert.equal(created, targetDir);
  assert.equal(fs.existsSync(path.join(targetDir, "package.json")), true);
  assert.equal(fs.existsSync(path.join(targetDir, "src", "plugin.ts")), true);
  assert.equal(fs.existsSync(path.join(targetDir, ".gitignore")), true);

  cleanupTempDir(root);
});

test("runInitCommand spawns npm install when requested", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const targetDir = path.join(root, "fresh-plugin");

  await withMockSpawnSync({ status: 0 }, async () => {
    const created = await withMockReadline([
      targetDir,
      "module",
      "fresh.plugin",
      "Fresh Plugin",
      "0.1.0",
      "y",
      "y",
    ], () => runInitCommand([]));

    assert.equal(created, path.resolve(targetDir));
    assert.equal(fs.existsSync(path.join(targetDir, "package.json")), true);
  });

  cleanupTempDir(root);
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

test("collectAnswers handles theme mode, invalid kind, blank defaults, and boolean retries", async () => {
  const prompts = [
    "",
    "bad-kind",
    "t",
    "",
    "",
    "",
  ];
  const booleans = [false, true];
  const messages = [];
  const promptDriver = {
    async promptText(_label, defaultValue) {
      const value = prompts.shift();
      return value === "" ? defaultValue : value;
    },
    async promptBoolean() {
      return booleans.shift();
    },
    close() {
      messages.push("closed");
    },
  };
  const output = { write(message) { messages.push(message); } };

  const answers = await __private.collectAnswers(
    { forceTheme: false, targetHint: "theme-dir" },
    promptDriver,
    output,
  );

  assert.equal(answers.kind, "theme");
  assert.equal(answers.pluginId, "theme-dir");
  assert.equal(answers.pluginName, "Theme Dir");
  assert.equal(answers.pluginVersion, "0.1.0");
  assert.equal(answers.defaultEnabled, false);
  assert.equal(answers.runNpmInstall, true);
  assert.equal(messages.some((message) => String(message).includes("Please choose")), true);
  assert.equal(messages.includes("closed"), true);
});

test("collectAnswers skips kind prompt when theme is forced", async () => {
  const prompts = ["forced-dir", "forced.theme", "Forced Theme", "1.0.0"];
  const labels = [];
  const promptDriver = {
    async promptText(label) {
      labels.push(label);
      return prompts.shift();
    },
    async promptBoolean() {
      return false;
    },
    close() {},
  };

  const answers = await __private.collectAnswers({ forceTheme: true }, promptDriver, { write() {} });

  assert.equal(answers.kind, "theme");
  assert.equal(labels.includes("Template type (module/theme)"), false);
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
